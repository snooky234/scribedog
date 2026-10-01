import { createDocument, type Editor } from "@tiptap/core";

type MarkdownStorage = { markdown?: { parser?: { parse(markdown: string): string } } };

/**
 * Puts new markdown into the editor by replacing only the part that differs,
 * so the caret and the selection stay where they were in the text around it.
 *
 * TipTap's setContent swaps the whole document, which sends the caret to its
 * end. That is fine when a note is opened, and wrong when the new content
 * comes from a merge with someone else's edit while the user is typing: their
 * change two paragraphs further down must not pull the caret away from the
 * sentence being written. ProseMirror maps the selection through a replace of
 * the differing range by itself.
 *
 * Returns false when the markdown cannot be turned into a document here (no
 * markdown parser registered); the caller falls back to setContent.
 */
export function replaceDocumentKeepingSelection(editor: Editor, markdown: string): boolean {
  const parser = (editor.storage as MarkdownStorage).markdown?.parser;

  if (!parser) {
    return false;
  }

  const nextDoc = createDocument(parser.parse(markdown), editor.schema, editor.options.parseOptions);
  const { doc } = editor.state;
  const start = doc.content.findDiffStart(nextDoc.content);

  if (start === null) {
    return true;
  }

  const end = doc.content.findDiffEnd(nextDoc.content);

  if (!end) {
    return false;
  }

  // Both ends can claim the same characters when the change repeats what is
  // next to it ("aa" -> "aaa"); the end is pushed back past the start then.
  let { a: endA, b: endB } = end;
  const overlap = start - Math.min(endA, endB);

  if (overlap > 0) {
    endA += overlap;
    endB += overlap;
  }

  // The same meta setContent sets with emitUpdate: false; the store already
  // holds this content, so reporting it back as an edit would be an echo.
  editor.view.dispatch(editor.state.tr.replace(start, endA, nextDoc.slice(start, endB)).setMeta("preventUpdate", true));

  return true;
}
