import Image from "@tiptap/extension-image";
import type { Node as ProseMirrorNode } from "@tiptap/pm/model";
import { ReactNodeViewRenderer } from "@tiptap/react";

import { ImageView } from "@/components/ImageView";

// Images are referenced in markdown relative to the file (e.g. "images/foto.png"
// or "../images/foto.png"), but the browser can't load that path directly — the
// NodeView resolves it at runtime via the filesystem into a blob URL, without
// changing the stored markdown path.
// CommonMark has no image-width syntax. To keep a width changed via drag across
// save/reload, it's encoded in the title part of the standard image syntax
// (e.g. `![alt](src "width=300")`). The "title" attribute isn't used anywhere
// else in the app, so this trick is lossless and stays valid CommonMark.
const IMAGE_WIDTH_TITLE_PATTERN = /^width=(\d+)$/;

type MarkdownSerializerState = {
  esc: (str: string) => string;
  write: (content: string) => void;
  closeBlock: (node: ProseMirrorNode) => void;
};

export const EditorImage = Image.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      width: {
        default: null,
        parseHTML: (element) => {
          const attrWidth = element.getAttribute("width");

          if (attrWidth) {
            return Number.parseInt(attrWidth, 10);
          }

          const match = element.getAttribute("title")?.match(IMAGE_WIDTH_TITLE_PATTERN);
          return match ? Number.parseInt(match[1], 10) : null;
        },
        renderHTML: (attributes) => (attributes.width ? { width: attributes.width } : {})
      },
      title: {
        ...(this.parent?.() as { title?: object } | undefined)?.title,
        parseHTML: (element) => {
          const title = element.getAttribute("title");
          return title && IMAGE_WIDTH_TITLE_PATTERN.test(title) ? null : title;
        }
      }
    };
  },
  addNodeView() {
    return ReactNodeViewRenderer(ImageView);
  },
  addStorage() {
    return {
      markdown: {
        serialize(state: MarkdownSerializerState, node: ProseMirrorNode) {
          const alt = (node.attrs.alt as string | null) ?? "";
          const src = (node.attrs.src as string | null) ?? "";
          const width = node.attrs.width as number | null;
          const title = width ? `width=${width}` : (node.attrs.title as string | null);

          state.write(
            `![${state.esc(alt)}](${src.replace(/[()]/g, "\\$&")}${
              title ? ` "${title.replace(/"/g, '\\"')}"` : ""
            })`
          );
          // Without this, the serializer never marks the block as closed, so
          // a following block (e.g. a heading) gets written directly onto
          // the same line with no separating newline — see closeBlock/
          // flushClose in prosemirror-markdown's to_markdown.ts.
          state.closeBlock(node);
        },
        parse: {}
      }
    };
  }
});
