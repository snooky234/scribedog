import { Slice } from "@tiptap/pm/model";
import type { Editor } from "@tiptap/react";

import { parseMarkdownBlocks } from "@/lib/editor/structuredInsert";

// Plain text from the clipboard used to land in the document character for
// character, so a note copied out of a chat window or another editor showed
// its "#" and "**" instead of the heading and the bold word they mean. In a
// Markdown editor the rendered form is what the paste almost always intends,
// and the browser's "paste as plain text" combo (Ctrl+Shift+V) covers the
// rare case where the markers themselves are wanted.
//
// The conversion is only offered for text that actually looks like Markdown:
// a lone sentence with an underscore in a file name or a "*" in a formula
// must stay exactly what it was, because an unexpected italic in the middle
// of a paste is much harder to notice than a raw "#".

// One marker at the start of a line is enough — it is the shape a copied list,
// heading, quote, table or fenced block always has and ordinary prose never.
const BLOCK_MARKER_LINE = /^\s{0,3}(?:#{1,6}\s|[-*+]\s|\d{1,9}[.)]\s|>\s?|```|~~~|\|.*\|\s*$|(?:[-*_]\s*){3,}$)/;

// Inline pairs are demanded in full so a stray "*" or "_" does not count.
const INLINE_MARKERS = [
  /\*\*[^*\n]+\*\*/, // bold
  /__[^_\n]+__/, // bold (underscore)
  /(?<![\w*])\*[^*\s][^*\n]*\*(?![\w*])/, // italic
  /(?<![\w_])_[^_\s][^_\n]*_(?![\w_])/, // italic (underscore)
  /~~[^~\n]+~~/, // strikethrough
  /`[^`\n]+`/, // inline code
  /!?\[[^\]\n]+\]\([^)\n]+\)/ // link / image
];

/**
 * Whether pasted plain text carries Markdown that is worth converting. A
 * block marker on any line settles it; otherwise at least one complete inline
 * construct has to be present.
 */
export function looksLikeMarkdown(text: string): boolean {
  if (!text.trim()) {
    return false;
  }

  const lines = text.split(/\r?\n/);

  if (lines.some((line) => BLOCK_MARKER_LINE.test(line))) {
    return true;
  }

  return INLINE_MARKERS.some((pattern) => pattern.test(text));
}

/**
 * Replaces the selection with the parsed form of `markdown`. Returns false
 * when the text could not be parsed, so the caller can leave the paste to
 * ProseMirror's default handling.
 */
export function pasteMarkdown(
  editor: Editor,
  markdown: string,
  transformSlice: (slice: Slice) => Slice = (slice) => slice
): boolean {
  const fragment = parseMarkdownBlocks(editor, markdown);

  if (!fragment) {
    return false;
  }

  // maxOpen is what ProseMirror's own paste uses: a single pasted paragraph
  // merges into the one the cursor is in, several paragraphs split it.
  const slice = transformSlice(Slice.maxOpen(fragment));
  const { state, dispatch } = editor.view;

  dispatch(state.tr.replaceSelection(slice).scrollIntoView().setMeta("paste", true).setMeta("uiEvent", "paste"));

  return true;
}
