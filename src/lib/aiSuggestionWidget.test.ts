// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { Editor } from "@tiptap/core";
import Document from "@tiptap/extension-document";
import Paragraph from "@tiptap/extension-paragraph";
import Text from "@tiptap/extension-text";
import { DecorationSet } from "@tiptap/pm/view";

import {
  acceptAiSuggestion,
  acceptAllAiSuggestions,
  addAiSuggestion,
  AiSuggestionWidget,
  clearAiSuggestions,
  discardAiSuggestion,
  getAiSuggestions,
  setAiSuggestionOverride
} from "./aiSuggestionWidget";

// Whether a proposal is actually *drawn* — the question two rounds of static
// reasoning could not settle. A staged file change opens its review on a
// document that is empty and read-only, which is the one combination the chat
// agent's own proposals never hit, so it is the one worth pinning down.

// jsdom implements no layout, so scrolling a proposal into view is a no-op
// here. Stubbed rather than guarded in the source: the scroll is real behaviour
// the app wants, it just has nothing to scroll in a test.
if (!Element.prototype.scrollIntoView) {
  Element.prototype.scrollIntoView = () => undefined;
}

function createEditor(content: string) {
  const element = document.createElement("div");
  document.body.appendChild(element);

  return new Editor({
    element,
    extensions: [Document, Paragraph, Text, AiSuggestionWidget],
    content
  });
}

let editor: Editor | null = null;

afterEach(() => {
  editor?.destroy();
  editor = null;
  document.body.innerHTML = "";
});

/** The decorations the widget plugin contributes for the current state. */
function widgetCount(current: Editor): number {
  let total = 0;

  for (const plugin of current.state.plugins) {
    const set = plugin.props?.decorations?.call(plugin, current.state) as DecorationSet | null | undefined;

    if (set) {
      total += set.find().length;
    }
  }

  return total;
}

/**
 * The DOM containers the widget plugin hands to prosemirror-view. Identity is
 * the point: a container that comes back as a different element was rebuilt,
 * which means the one on screen had been torn down.
 */
function suggestionContainers(current: Editor): HTMLElement[] {
  const containers: HTMLElement[] = [];

  for (const plugin of current.state.plugins) {
    const set = plugin.props?.decorations?.call(plugin, current.state) as DecorationSet | null | undefined;

    for (const decoration of set?.find() ?? []) {
      const toDOM = (decoration as unknown as { type?: { toDOM?: unknown } }).type?.toDOM;

      if (typeof toDOM === "function") {
        containers.push((toDOM as () => HTMLElement)());
      }
    }
  }

  return containers;
}

describe("AiSuggestionWidget", () => {
  it("draws a proposal in a normal document", () => {
    editor = createEditor("<p>Eine Zeile.</p>");

    addAiSuggestion(editor, { id: "a", from: 1, to: 12, replacement: "Eine andere Zeile." });

    expect(getAiSuggestions(editor)).toHaveLength(1);
    expect(widgetCount(editor)).toBeGreaterThan(0);
  });

  // The staged-preview case: a file the agent proposed into existence opens as
  // an empty document, and the whole proposal is one green block.
  it("draws a proposal in an empty document", () => {
    editor = createEditor("");

    addAiSuggestion(editor, { id: "a", from: 1, to: 1, replacement: "# Lavendel\n\nIm Feld, so lila." });

    expect(getAiSuggestions(editor)).toHaveLength(1);
    expect(widgetCount(editor)).toBeGreaterThan(0);
  });

  // The staged preview locks the document while it is on screen, so the
  // proposal has to survive the editor being read-only.
  it("draws a proposal while the editor is read-only", () => {
    editor = createEditor("");
    editor.setEditable(false);

    addAiSuggestion(editor, { id: "a", from: 1, to: 1, replacement: "# Lavendel" });

    expect(getAiSuggestions(editor)).toHaveLength(1);
    expect(widgetCount(editor)).toBeGreaterThan(0);
  });

  // The exact sequence the staged-preview effect runs, in one tick: lock the
  // document, drop whatever was open, then add the proposal.
  it("draws a proposal added right after a clear on a locked empty document", () => {
    editor = createEditor("");
    editor.setEditable(false);
    clearAiSuggestions(editor);

    addAiSuggestion(editor, { id: "a", from: 1, to: 1, replacement: "# Lavendel\n\nIm Feld, so lila." });

    expect(getAiSuggestions(editor)).toHaveLength(1);
    expect(widgetCount(editor)).toBeGreaterThan(0);
  });

  // Opening another file replaces the whole Tiptap editor, and the two
  // instances overlap for a moment: the new one has already drawn its proposal
  // when React tears the old one down. While the widget bookkeeping was shared
  // across instances, that teardown unmounted the *new* editor's widgets — the
  // staged preview flashed up and vanished, with the proposal still in plugin
  // state, so no later pass ever drew it again.
  it("keeps its widgets when another editor instance is destroyed", () => {
    editor = createEditor("");
    addAiSuggestion(editor, { id: "a", from: 1, to: 1, replacement: "# Lavendel" });

    const before = suggestionContainers(editor);
    expect(before).toHaveLength(1);

    const otherInstance = createEditor("<p>Andere Datei.</p>");
    otherInstance.destroy();

    expect(suggestionContainers(editor)[0]).toBe(before[0]);
  });

  // The range 0…content.size was what the staged preview used first: it spans
  // the empty paragraph's boundaries, and prosemirror-view has nowhere to hang
  // an inline decoration that is not inside a textblock.
  it("still draws the widget for a range spanning the whole empty document", () => {
    editor = createEditor("");

    addAiSuggestion(editor, {
      id: "a",
      from: 0,
      to: editor.state.doc.content.size,
      replacement: "# Lavendel"
    });

    expect(widgetCount(editor)).toBeGreaterThan(0);
  });

  // A staged file change is applied through the staging layer, not by writing
  // into the document: doing the latter left the staged entry in place, so the
  // review was rebuilt from it — the proposal landed in the document a second
  // time and the green block never disappeared.
  describe("with a staged-change override", () => {
    it("routes accept to the override and leaves the document alone", () => {
      editor = createEditor("<p>Eine Zeile.</p>");
      const before = editor.getHTML();
      let accepted = 0;

      addAiSuggestion(editor, { id: "a", from: 1, to: 12, replacement: "Eine andere Zeile." });
      setAiSuggestionOverride(editor, { onAccept: () => (accepted += 1), onDiscard: () => undefined });

      acceptAiSuggestion(editor, "a");

      expect(accepted).toBe(1);
      expect(editor.getHTML()).toBe(before);
      expect(getAiSuggestions(editor)).toHaveLength(1);
    });

    it("routes discard to the override", () => {
      editor = createEditor("<p>Eine Zeile.</p>");
      let discarded = 0;

      addAiSuggestion(editor, { id: "a", from: 1, to: 12, replacement: "Eine andere Zeile." });
      setAiSuggestionOverride(editor, { onAccept: () => undefined, onDiscard: () => (discarded += 1) });

      discardAiSuggestion(editor, "a");

      expect(discarded).toBe(1);
      expect(getAiSuggestions(editor)).toHaveLength(1);
    });

    // One whole-file change, however many hunks its review was cut into.
    it("applies once when every proposal is accepted at once", () => {
      editor = createEditor("<p>Eine Zeile.</p><p>Noch eine.</p>");
      let accepted = 0;

      addAiSuggestion(editor, { id: "a", from: 1, to: 12, replacement: "Anders." });
      addAiSuggestion(editor, { id: "b", from: 15, to: 24, replacement: "Auch anders." });
      setAiSuggestionOverride(editor, { onAccept: () => (accepted += 1), onDiscard: () => undefined });

      expect(acceptAllAiSuggestions(editor)).toBe(2);
      expect(accepted).toBe(1);
    });

    it("goes back to editing the document once the override is cleared", () => {
      editor = createEditor("<p>Eine Zeile.</p>");
      let accepted = 0;

      addAiSuggestion(editor, { id: "a", from: 1, to: 12, replacement: "Eine andere Zeile." });
      setAiSuggestionOverride(editor, { onAccept: () => (accepted += 1), onDiscard: () => undefined });
      setAiSuggestionOverride(editor, null);

      acceptAiSuggestion(editor, "a");

      expect(accepted).toBe(0);
      expect(getAiSuggestions(editor)).toHaveLength(0);
      expect(editor.getText()).toContain("Eine andere Zeile.");
    });
  });
});
