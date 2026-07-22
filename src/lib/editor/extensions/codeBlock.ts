import { CodeBlockLowlight } from "@tiptap/extension-code-block-lowlight";
import { ReactNodeViewRenderer } from "@tiptap/react";

import { CodeBlockView } from "@/components/CodeBlockView";
import { codeBlockLowlight } from "@/lib/codeLanguages";

// Highlighting is applied as ProseMirror decorations, so the document stays
// plain text — markdown serialization, undo history and the exporters (which
// read the code block's text content) are unaffected.
export const CodeBlock = CodeBlockLowlight.extend({
  addNodeView() {
    return ReactNodeViewRenderer(CodeBlockView);
  }
}).configure({ lowlight: codeBlockLowlight });
