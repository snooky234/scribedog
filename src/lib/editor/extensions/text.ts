import BaseText from "@tiptap/extension-text";

// tiptap-markdown's own text node runs every string through escapeHTML(),
// turning "<" into "&lt;" and ">" into "&gt;" on the way back to markdown.
// That default belongs to `html: true`, where the serializer has to keep the
// document's own markup apart from text that merely looks like markup. With
// `html: false` (see index.ts) raw HTML is never parsed: it stays visible
// text, the editor shows it verbatim, and escaping it on save rewrites the
// user's document. It cost every note its raw HTML ("<a class=...>" came back
// as "&lt;a class=...&gt;") and hit ordinary prose just as hard, since a plain
// "a < b" was rewritten too.
//
// The loss was invisible: the escaped form is what the store then held as the
// canonical content, so the note never looked unsaved, and searching the vault
// for "<a class" stopped finding a file the moment it had been opened once.
//
// Markdown escaping is a separate concern and stays on: state.text() still
// backslash-escapes "*", "[" and friends by itself. Only the HTML pass goes.
//
// One exception survives, inside a table cell. There the serializer writes a
// hard break as "<br>" (table.ts) because a cell cannot hold a real newline,
// and the parse side turns every "<br>" in a cell back into one. A "<br>"
// the user typed as text would be indistinguishable from it, so in a cell
// that one tag keeps its entity form. Text is the only place this is
// decidable: here the tag is known to be typed, while by the time the cell
// is assembled both spellings look the same.
const CELL_LINE_BREAK_PATTERN = /<(br\s*\/?)>/gi;

type TextSerializerState = {
  text: (value: string) => void;
  inTable?: boolean;
};

export const Text = BaseText.extend({
  addStorage() {
    return {
      markdown: {
        serialize(state: TextSerializerState, node: { text?: string }) {
          const text = node.text ?? "";

          state.text(state.inTable ? text.replace(CELL_LINE_BREAK_PATTERN, "&lt;$1&gt;") : text);
        },
        parse: {
          // handled by markdown-it
        }
      }
    };
  }
});
