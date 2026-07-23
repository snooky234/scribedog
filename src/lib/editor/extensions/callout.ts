import { mergeAttributes, Node } from "@tiptap/core";
import type { Node as ProseMirrorNode } from "@tiptap/pm/model";
import type MarkdownIt from "markdown-it";

// A "callout" is a colored hint banner (success/info/warning/danger). It stores
// only its variant plus arbitrary block content in the document. On disk it is
// persisted as a GitHub-style admonition blockquote (`> [!SUCCESS]`), which is
// interoperable with GitHub, Obsidian and other markdown tools and degrades
// gracefully to a plain blockquote everywhere else.

export type CalloutVariant = "success" | "info" | "warning" | "danger";

export const CALLOUT_VARIANTS: CalloutVariant[] = ["success", "info", "warning", "danger"];

const DEFAULT_VARIANT: CalloutVariant = "info";

// The uppercase marker written into `> [!MARKER]` per variant.
const CALLOUT_MARKERS: Record<CalloutVariant, string> = {
  success: "SUCCESS",
  info: "INFO",
  warning: "WARNING",
  danger: "DANGER"
};

// Accepts the four canonical markers plus common synonyms from other tools so
// documents written elsewhere still round-trip into the right banner.
const VARIANT_ALIASES: Record<string, CalloutVariant> = {
  success: "success",
  tip: "success",
  check: "success",
  done: "success",
  info: "info",
  note: "info",
  warning: "warning",
  caution: "warning",
  warn: "warning",
  danger: "danger",
  error: "danger",
  important: "danger",
  bug: "danger"
};

function normalizeVariant(value: unknown): CalloutVariant {
  return CALLOUT_VARIANTS.includes(value as CalloutVariant) ? (value as CalloutVariant) : DEFAULT_VARIANT;
}

const CALLOUT_MARKER_PATTERN = /^\s*\[!(\w+)\]\s*/;

// Turns `> [!VARIANT] …` blockquotes into `<div data-callout="variant">` so the
// callout NodeView (parseHTML) picks them up on load instead of a blockquote.
// Exported so the export/print pipeline can reuse it: there the block type stays
// a blockquote, but the `[!VARIANT]` marker line gets stripped so it no longer
// shows up as literal text.
export function calloutMarkdownItPlugin(md: MarkdownIt): void {
  md.core.ruler.after("inline", "scribedog_callout", (state) => {
    const tokens = state.tokens;

    for (let i = 0; i < tokens.length - 2; i++) {
      const open = tokens[i];

      if (open.type !== "blockquote_open") {
        continue;
      }

      const paragraphOpen = tokens[i + 1];
      const inline = tokens[i + 2];

      if (!paragraphOpen || paragraphOpen.type !== "paragraph_open") {
        continue;
      }

      if (!inline || inline.type !== "inline") {
        continue;
      }

      const match = CALLOUT_MARKER_PATTERN.exec(inline.content);

      if (!match) {
        continue;
      }

      const variant = VARIANT_ALIASES[match[1].toLowerCase()];

      if (!variant) {
        continue;
      }

      // Find the matching close, honoring nested blockquotes.
      let depth = 0;
      let closeIndex = -1;

      for (let j = i; j < tokens.length; j++) {
        if (tokens[j].type === "blockquote_open") {
          depth += 1;
        } else if (tokens[j].type === "blockquote_close") {
          depth -= 1;

          if (depth === 0) {
            closeIndex = j;
            break;
          }
        }
      }

      if (closeIndex === -1) {
        continue;
      }

      open.tag = "div";
      open.attrSet("data-callout", variant);
      tokens[closeIndex].tag = "div";

      // Strip the "[!VARIANT]" marker from the first paragraph. markdown-it puts
      // it into the leading text child, followed by a softbreak for the newline.
      inline.content = inline.content.replace(CALLOUT_MARKER_PATTERN, "");

      const children = inline.children ?? [];

      if (children[0] && children[0].type === "text") {
        children[0].content = children[0].content.replace(CALLOUT_MARKER_PATTERN, "");
      }

      while (
        children.length > 0 &&
        ((children[0].type === "text" && children[0].content === "") || children[0].type === "softbreak")
      ) {
        children.shift();
      }

      // If nothing but the marker was on the first line, drop the now-empty
      // paragraph so the banner starts with its real first block.
      if (inline.content.trim() === "" && children.length === 0) {
        tokens.splice(i + 1, 3);
      }
    }
  });
}

type MarkdownSerializerState = {
  write: (content: string) => void;
  wrapBlock: (
    delim: string,
    firstDelim: string | null,
    node: ProseMirrorNode,
    f: () => void
  ) => void;
  renderContent: (node: ProseMirrorNode) => void;
};

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    callout: {
      setCallout: (attributes: { variant: CalloutVariant }) => ReturnType;
      toggleCallout: (attributes: { variant: CalloutVariant }) => ReturnType;
      unsetCallout: () => ReturnType;
    };
  }
}

export const Callout = Node.create({
  name: "callout",
  group: "block",
  content: "block+",
  defining: true,

  addAttributes() {
    return {
      variant: {
        default: DEFAULT_VARIANT,
        parseHTML: (element) => normalizeVariant(element.getAttribute("data-callout")),
        renderHTML: (attributes) => ({ "data-callout": normalizeVariant(attributes.variant) })
      }
    };
  },

  parseHTML() {
    return [{ tag: "div[data-callout]" }];
  },

  renderHTML({ HTMLAttributes, node }) {
    const variant = normalizeVariant(node.attrs.variant);

    return [
      "div",
      mergeAttributes(HTMLAttributes, {
        "data-callout": variant,
        class: `callout callout--${variant}`
      }),
      0
    ];
  },

  addCommands() {
    return {
      setCallout:
        (attributes) =>
        ({ commands }) =>
          commands.wrapIn(this.name, attributes),
      toggleCallout:
        (attributes) =>
        ({ commands }) =>
          commands.toggleWrap(this.name, attributes),
      unsetCallout:
        () =>
        ({ commands }) =>
          commands.lift(this.name)
    };
  },

  addStorage() {
    return {
      markdown: {
        serialize(state: MarkdownSerializerState, node: ProseMirrorNode) {
          const variant = normalizeVariant(node.attrs.variant);
          const marker = CALLOUT_MARKERS[variant];

          state.wrapBlock("> ", `> [!${marker}]\n> `, node, () => state.renderContent(node));
        },
        parse: {
          setup(markdownit: MarkdownIt) {
            markdownit.use(calloutMarkdownItPlugin);
          }
        }
      }
    };
  }
});
