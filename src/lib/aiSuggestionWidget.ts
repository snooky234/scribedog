import { createElement } from "react";
import { createRoot, type Root } from "react-dom/client";

import { Extension } from "@tiptap/core";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";
import type { Editor } from "@tiptap/react";

import { AiDiffResultView } from "@/components/AiDiffResultView";
import { completeMarkdownForContext, insertMarkdownStructured } from "@/lib/editor/structuredInsert";

// Pending edits proposed by the chat agent. Same visual language as the
// rewrite diff (aiDiffWidget.ts): the original passage stays in the document
// tinted red, the proposed text renders as a green widget right after it with
// accept/discard actions — but here several proposals can be open at once
// (one agent turn may touch several passages), so this plugin keeps a list
// instead of a single widget state, and the editor stays editable throughout.
//
// Positions are remapped through every transaction, so accepting one proposal
// (or the user typing) keeps the remaining ones anchored to the right text.
export type AiSuggestion = {
  id: string;
  // Range of the original passage. from === to means "pure insertion" — there
  // is nothing to tint red, only the proposed text is shown.
  from: number;
  to: number;
  replacement: string;
};

type SuggestionMeta =
  | { type: "add"; suggestion: AiSuggestion }
  | { type: "remove"; id: string }
  | { type: "clear" };

const aiSuggestionKey = new PluginKey<AiSuggestion[]>("aiSuggestionWidget");

// One React root per proposal, keyed by id and kept alive while that proposal
// is on screen — decorations() runs far more often than the proposals change,
// and remounting would tear down the inner Tiptap preview every time.
type WidgetEntry = { container: HTMLElement; root: Root; renderedMarkdown: string | null };

// The preview renders the proposal on its own, with no idea what it targets —
// so a bare table row would show up as literal pipe text there just like it
// used to in the document. Completing it against the target table first keeps
// the preview showing what accepting will actually produce. The suggestion
// itself keeps the model's original Markdown: the insert path has to be able
// to tell a synthesized header row from one the model really proposed.
function previewMarkdown(editor: Editor, suggestion: AiSuggestion): string {
  return completeMarkdownForContext(editor, suggestion.from, suggestion.replacement);
}

const widgets = new Map<string, WidgetEntry>();
let cachedSuggestions: AiSuggestion[] | null = null;
let cachedDecorationSet: DecorationSet | null = null;

function destroyWidget(id: string) {
  const entry = widgets.get(id);

  if (entry) {
    entry.root.unmount();
    widgets.delete(id);
  }
}

function destroyAllWidgets() {
  for (const id of Array.from(widgets.keys())) {
    destroyWidget(id);
  }

  cachedSuggestions = null;
  cachedDecorationSet = null;
}

function renderWidget(editor: Editor, suggestion: AiSuggestion): HTMLElement {
  let entry = widgets.get(suggestion.id);

  if (!entry) {
    const container = document.createElement("div");
    container.className = "ai-diff-widget ai-diff-widget--suggestion";
    container.contentEditable = "false";
    entry = { container, root: createRoot(container), renderedMarkdown: null };
    widgets.set(suggestion.id, entry);
  }

  const markdown = previewMarkdown(editor, suggestion);

  // Only the proposed markdown drives the rendered output — position changes
  // (the common case) must not trigger a re-render of the preview editor.
  if (entry.renderedMarkdown !== markdown) {
    entry.renderedMarkdown = markdown;
    entry.root.render(
      createElement(AiDiffResultView, {
        resultMarkdown: markdown,
        isStreaming: false,
        // Several proposals can be open at once, so none of them may grab
        // focus on mount — that would yank the caret away from wherever the
        // user is working.
        autoFocusAccept: false,
        onAccept: () => acceptAiSuggestion(editor, suggestion.id),
        onDiscard: () => removeAiSuggestion(editor, suggestion.id)
      })
    );
  }

  return entry.container;
}

export const AiSuggestionWidget = Extension.create({
  name: "aiSuggestionWidget",

  addProseMirrorPlugins() {
    const editor = this.editor as Editor;

    return [
      new Plugin<AiSuggestion[]>({
        key: aiSuggestionKey,
        state: {
          init: () => [],
          apply(tr, value) {
            const meta = tr.getMeta(aiSuggestionKey) as SuggestionMeta | undefined;

            // Map first, then apply the meta action: the positions carried by
            // an "add" were computed against the document this transaction
            // starts from, so they must not be mapped through it.
            const mapped = tr.docChanged
              ? value.map((suggestion) => ({
                  ...suggestion,
                  from: tr.mapping.map(suggestion.from, -1),
                  to: tr.mapping.map(suggestion.to, 1)
                }))
              : value;

            if (!meta) {
              return mapped;
            }

            if (meta.type === "clear") {
              return [];
            }

            if (meta.type === "remove") {
              return mapped.filter((suggestion) => suggestion.id !== meta.id);
            }

            return [...mapped, meta.suggestion];
          }
        },
        props: {
          decorations(state) {
            const suggestions = aiSuggestionKey.getState(state) ?? [];

            if (suggestions.length === 0) {
              if (widgets.size > 0) {
                destroyAllWidgets();
              }

              return null;
            }

            if (suggestions === cachedSuggestions && cachedDecorationSet) {
              return cachedDecorationSet;
            }

            const live = new Set(suggestions.map((suggestion) => suggestion.id));

            for (const id of Array.from(widgets.keys())) {
              if (!live.has(id)) {
                destroyWidget(id);
              }
            }

            const decorations: Decoration[] = [];

            for (const suggestion of suggestions) {
              const container = renderWidget(editor, suggestion);

              if (suggestion.to > suggestion.from) {
                decorations.push(
                  Decoration.inline(suggestion.from, suggestion.to, {
                    class: "ai-diff-widget__original"
                  })
                );
              }

              decorations.push(
                Decoration.widget(suggestion.to, () => container, { side: 1, ignoreSelection: true })
              );
            }

            cachedSuggestions = suggestions;
            cachedDecorationSet = DecorationSet.create(state.doc, decorations);

            return cachedDecorationSet;
          }
        },
        view() {
          return {
            destroy: destroyAllWidgets
          };
        }
      })
    ];
  }
});

function dispatchMeta(editor: Editor, meta: SuggestionMeta) {
  if (editor.isDestroyed) {
    return;
  }

  editor.view.dispatch(editor.state.tr.setMeta(aiSuggestionKey, meta));
}

export function getAiSuggestions(editor: Editor): AiSuggestion[] {
  if (editor.isDestroyed) {
    return [];
  }

  return aiSuggestionKey.getState(editor.state) ?? [];
}

export function addAiSuggestion(editor: Editor, suggestion: AiSuggestion): void {
  dispatchMeta(editor, { type: "add", suggestion });

  // A proposal the user has to scroll to find might as well not exist — but
  // only the first one of a turn scrolls, otherwise a multi-passage answer
  // would drag the view around several times. The widget's DOM exists by now:
  // the dispatch above already ran the decoration pass. Focus stays where it
  // is (typically the chat input).
  if (getAiSuggestions(editor).length === 1) {
    widgets.get(suggestion.id)?.container.scrollIntoView({ block: "center", behavior: "smooth" });
  }
}

export function removeAiSuggestion(editor: Editor, id: string): void {
  dispatchMeta(editor, { type: "remove", id });
}

export function clearAiSuggestions(editor: Editor): void {
  dispatchMeta(editor, { type: "clear" });
}

/**
 * Accepts every open proposal and returns how many that was. Backs the chat's
 * accept_proposals tool, where the user says "apply that" instead of clicking
 * each widget's button.
 *
 * Back to front: accepting one proposal rewrites a range of the document, and
 * while the plugin maps the remaining proposals through that change anyway,
 * starting with the last one leaves the earlier ranges untouched to begin with.
 * Each proposal stays its own undo step, exactly as when clicked.
 */
export function acceptAllAiSuggestions(editor: Editor): number {
  const ids = [...getAiSuggestions(editor)]
    .sort((a, b) => b.from - a.from)
    .map((suggestion) => suggestion.id);

  for (const id of ids) {
    acceptAiSuggestion(editor, id);
  }

  return ids.length;
}

export function acceptAiSuggestion(editor: Editor, id: string): void {
  if (editor.isDestroyed) {
    return;
  }

  const suggestion = getAiSuggestions(editor).find((entry) => entry.id === id);

  if (!suggestion) {
    return;
  }

  // Drop the proposal before touching the document: its decoration range is
  // about to be replaced, and clearing it afterwards would leave the widget
  // pointing at stale positions for one dispatch. The removal itself doesn't
  // change the document, so the range stays valid for the edit below and the
  // replacement remains a single undo step.
  removeAiSuggestion(editor, id);
  // Not a plain insertContentAt: a proposal that describes table rows or list
  // items has to replace those rows/items, not the text range inside the one
  // cell or item it happened to be located in (see structuredInsert.ts).
  insertMarkdownStructured(editor, suggestion.from, suggestion.to, suggestion.replacement);
}
