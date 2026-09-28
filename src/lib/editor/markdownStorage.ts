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

const LIST_TYPES = new Set(["bulletList", "orderedList", "taskList"]);

/** The current selection serialized to markdown, or "" if it can't be. */
export function getSelectionMarkdown(editor: TipTapEditor, from: number, to: number): string {
  const storage = editor.storage as MarkdownStorage;
  const serializer = storage.markdown?.serializer;

  if (!serializer) {
    return "";
  }

  try {
    const { doc } = editor.state;
    const content = doc.slice(from, to).content;
    const $from = doc.resolve(from);
    const sharedDepth = $from.sharedDepth(to);
    const shared = $from.node(sharedDepth);

    // A range inside a single block comes back as bare inline nodes, and the
    // serializer applies marks while rendering a *block*: handed the inline
    // nodes straight it writes their text and drops the bold, the link, the
    // code span. Wrapping them in a paragraph inside a document node is what
    // puts them back where the marks are rendered. Block content already
    // arrives as blocks and goes through unchanged.
    const inlineContent = content.firstChild?.isInline === true;
    //
    // A range across several items of one list is cut at the list, so the
    // items come without it and the serializer writes them as bare paragraphs:
    // no "1." or "- ", and a blank line between each. The list goes back
    // around them, an ordered one counting from the first selected item.
    let serializable: unknown = content;

    if (inlineContent) {
      serializable = editor.schema.topNodeType.create(null, editor.schema.nodes.paragraph.create(null, content));
    } else if (LIST_TYPES.has(shared.type.name)) {
      const attrs =
        shared.type.name === "orderedList"
          ? { ...shared.attrs, start: (Number(shared.attrs.start) || 1) + $from.index(sharedDepth) }
          : shared.attrs;
      serializable = editor.schema.topNodeType.create(null, shared.type.create(attrs, content));
    }

    return serializer.serialize(serializable).trim();
  } catch {
    return "";
  }
}
