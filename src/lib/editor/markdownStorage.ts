import type { Editor as TipTapEditor } from "@tiptap/react";

// tiptap-markdown attaches its serializer to editor.storage.markdown but does
// not type it, so these two helpers wrap the cast in one place instead of
// repeating it at every call site.
type MarkdownStorage = {
  markdown?: {
    getMarkdown?: () => string;
    serializer?: { serialize: (content: unknown) => string };
  };
};

/** The full document serialized to markdown, or `fallback` if unavailable. */
export function getEditorMarkdown(editor: TipTapEditor, fallback: string): string {
  const storage = editor.storage as MarkdownStorage;
  return storage.markdown?.getMarkdown?.() ?? fallback;
}

/** The current selection serialized to markdown, or "" if it can't be. */
export function getSelectionMarkdown(editor: TipTapEditor, from: number, to: number): string {
  const storage = editor.storage as MarkdownStorage;
  const serializer = storage.markdown?.serializer;

  if (!serializer) {
    return "";
  }

  try {
    return serializer.serialize(editor.state.doc.slice(from, to).content).trim();
  } catch {
    return "";
  }
}
