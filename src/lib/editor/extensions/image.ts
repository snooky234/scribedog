import Image from "@tiptap/extension-image";
import type { Node as ProseMirrorNode } from "@tiptap/pm/model";
import { ReactNodeViewRenderer } from "@tiptap/react";
import type MarkdownIt from "markdown-it";

import { ImageView } from "@/components/ImageView";

import { LIST_ITEM_LEAD_GROUP } from "./listItem";

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

// TipTap's default attribute parser (fromString in @tiptap/core) turns a value
// that looks like a number into a Number and "true"/"false" into booleans. A
// photo from a phone camera is called "1000078813.jpg", so its alt text (the
// file name without extension) came back from the DOM as a Number and
// state.esc(alt) below crashed the whole serializer, and with it every save
// and reload of that note. Parsing these attributes as the raw strings they
// are keeps the markdown round-trip lossless for such names.
const rawStringAttribute = (name: string) => ({
  default: null,
  parseHTML: (element: HTMLElement) => element.getAttribute(name)
});

const attributeAsString = (value: unknown): string =>
  value === null || value === undefined ? "" : String(value);

// With `breaks: true` every newline inside a paragraph becomes a <br>, so
// "![a](a.png)" + newline + "![b](b.png)" arrives as one paragraph holding
// image, softbreak, image. The image node is a block node, so ProseMirror
// splits that paragraph around each image when it parses the HTML — and the softbreak that sat
// between two images is left over as a paragraph containing nothing but a hard
// break. That is the empty line users see between images they never typed.
// A line break directly before or after a block-level image has no visible
// effect anyway (the image already starts its own block), so it is dropped
// here, at the point where the information about its neighbours still exists.
export function imageLineBreakMarkdownItPlugin(markdownit: MarkdownIt): void {
  markdownit.core.ruler.push("scribedog_image_line_break", (state) => {
    for (const token of state.tokens) {
      if (token.type !== "inline" || !token.children) {
        continue;
      }

      token.children = token.children.filter((child, index, children) => {
        if (child.type !== "softbreak" && child.type !== "hardbreak") {
          return true;
        }

        return children[index - 1]?.type !== "image" && children[index + 1]?.type !== "image";
      });
    }
  });
}

export const EditorImage = Image.extend({
  // May open a list item on the marker's line (listItem.ts).
  group: `block ${LIST_ITEM_LEAD_GROUP}`,

  addAttributes() {
    return {
      ...this.parent?.(),
      src: rawStringAttribute("src"),
      alt: rawStringAttribute("alt"),
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
    // trackNodeViewPosition keeps the NodeView's cached position in sync when
    // the document shifts around it. Without it the cache is only refreshed
    // when the node view itself updates, so typing in a paragraph *above* an
    // image left every image below it holding the position it had before the
    // edit. Selection is decided against that cached value, so a click on such
    // an image no longer marked it selected: no outline, no resize handles,
    // and Backspace hit the wrong place. It also feeds the getPos() that
    // ImageView's own touch handler builds its NodeSelection from.
    return ReactNodeViewRenderer(ImageView, { trackNodeViewPosition: true });
  },
  addStorage() {
    return {
      markdown: {
        serialize(state: MarkdownSerializerState, node: ProseMirrorNode) {
          const alt = attributeAsString(node.attrs.alt);
          const src = attributeAsString(node.attrs.src);
          const width = node.attrs.width as number | null;
          const title = width ? `width=${width}` : attributeAsString(node.attrs.title);

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
        parse: {
          setup(markdownit: MarkdownIt) {
            markdownit.use(imageLineBreakMarkdownItPlugin);
          }
        }
      }
    };
  }
});
