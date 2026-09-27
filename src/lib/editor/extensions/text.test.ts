// The text serializer's one guarantee: what the user sees is what the file
// gets. tiptap-markdown escapes "<" and ">" into entities on the way out,
// which with `html: false` (index.ts) rewrites the document: raw HTML and
// ordinary prose alike. Parsing goes through markdown-it and a DOM, hence
// the jsdom environment.
// @vitest-environment jsdom
import { Editor } from "@tiptap/core";
import { describe, expect, it } from "vitest";

import { buildPreviewExtensions } from "@/lib/editor/extensions";
import { EditorImage } from "@/lib/editor/extensions/image";

// One open-and-save cycle: markdown in, markdown back out.
function roundTrip(markdown: string): string {
  const editor = new Editor({
    element: document.createElement("div"),
    extensions: [...buildPreviewExtensions(), EditorImage],
    content: markdown
  });
  const storage = editor.storage as { markdown?: { getMarkdown?: () => string } };
  const result = storage.markdown?.getMarkdown?.() ?? "";
  editor.destroy();

  return result.trim();
}

describe("text serialization", () => {
  it("keeps raw HTML as the user wrote it", () => {
    const note = 'Text mit <a class="x" href="y">Link</a> drin.';
    expect(roundTrip(note)).toBe(note);
  });

  it("keeps raw HTML that stands on its own line", () => {
    expect(roundTrip('<div class="note">Hallo</div>')).toBe('<div class="note">Hallo</div>');
  });

  it("keeps comparison signs in ordinary prose", () => {
    // Nothing to do with HTML: this is what made "a < b" unsafe to write down.
    expect(roundTrip("a < b und c > d")).toBe("a < b und c > d");
  });

  it("leaves an ampersand alone, as it always did", () => {
    expect(roundTrip("Tom & Jerry")).toBe("Tom & Jerry");
  });

  it("is stable across a second open-and-save cycle", () => {
    const note = 'Ein <span class="hl">Wort</span> hier.';
    expect(roundTrip(roundTrip(note))).toBe(note);
  });

  // The override in text.ts replaces tiptap-markdown's own text node, and an
  // upgrade that renames or restructures it would put the escaping back
  // without any other test noticing: every case here still reads naturally,
  // it is only the file on disk that changes. This asserts the entity form
  // never returns, whatever the library does underneath.
  it("never writes HTML entities back into the file", () => {
    for (const note of [
      'Text mit <a class="x" href="y">Link</a> drin.',
      "a < b und c > d",
      "<div>Block</div>"
    ]) {
      const result = roundTrip(note);

      expect(result).not.toContain("&lt;");
      expect(result).not.toContain("&gt;");
    }
  });

  it("still escapes markdown syntax so it survives the round trip", () => {
    // The HTML pass is gone, the markdown one has to stay: a literal asterisk
    // would otherwise come back as emphasis.
    expect(roundTrip("Ein * Stern")).toBe("Ein \\* Stern");
  });

  it("leaves formatting, links and structure untouched", () => {
    expect(roundTrip("Ein **fetter** Text")).toBe("Ein **fetter** Text");
    expect(roundTrip("Ein [Link](http://a.b) hier")).toBe("Ein [Link](http://a.b) hier");
    expect(roundTrip("# Titel\n\nText")).toBe("# Titel\n\nText");
    expect(roundTrip("- eins\n- zwei")).toBe("- eins\n- zwei");
  });

  it("keeps raw HTML in a table cell, escaping only a typed <br>", () => {
    // "<br>" is the cell's own line break syntax (table.ts), so a typed one
    // has to stay distinguishable; every other tag is written as typed.
    const table = '| H |\n| --- |\n| <a class="x">L</a> |';
    expect(roundTrip(table)).toBe(table);
  });

  it("leaves HTML in code untouched, as before", () => {
    expect(roundTrip('Siehe `<a class="x">` hier.')).toBe('Siehe `<a class="x">` hier.');
    expect(roundTrip('```\n<a class="x">L</a>\n```')).toBe('```\n<a class="x">L</a>\n```');
  });
});
