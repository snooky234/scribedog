import { Extension } from "@tiptap/core";
import type { Node as ProseMirrorNode } from "@tiptap/pm/model";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";

import i18n from "@/i18n";

// URLs inside code blocks are plain text (the Link mark is not allowed there),
// so they would never be clickable. This plugin finds them and marks them with
// an inline decoration; the editor's click handler follows the decorated
// span the same way it follows an <a>. Decorations keep the document itself
// untouched — markdown serialization, undo history and the exporters see the
// same plain text as before.
//
// A click opens the URL, so the mouse puts the caret into it with a
// right-click, as on a link outside a code block. The editor says so in a
// tooltip (`editHint`); the read-only reference pane has nothing to edit and
// leaves it out.

export const CODE_LINK_ATTR = "data-code-link";

export type CodeLinkRange = {
  from: number;
  to: number;
  href: string;
};

const URL_PATTERN = /https?:\/\/[^\s<>"'`]+/g;

// Punctuation that typically follows a URL in prose or code rather than being
// part of it: `See https://example.com.` or `("https://example.com")`. A
// closing bracket only stays when the URL opened it (Wikipedia-style paths).
const TRAILING_PUNCTUATION = /[.,;:!?]+$/;

function trimUrl(raw: string): string {
  let url = raw.replace(TRAILING_PUNCTUATION, "");

  for (;;) {
    const last = url[url.length - 1];
    const pair = last === ")" ? "(" : last === "]" ? "[" : last === "}" ? "{" : null;

    if (!pair) {
      break;
    }

    const opened = url.split(pair).length - 1;
    const closed = url.split(last).length - 1;

    if (closed <= opened) {
      break;
    }

    url = url.slice(0, -1).replace(TRAILING_PUNCTUATION, "");
  }

  return url;
}

// Offsets are relative to the start of `text`.
export function findCodeLinks(text: string): CodeLinkRange[] {
  const ranges: CodeLinkRange[] = [];

  for (const match of text.matchAll(URL_PATTERN)) {
    const href = trimUrl(match[0]);

    // Nothing left after the scheme (`https://` alone) is not a link.
    if (!/^https?:\/\/./.test(href)) {
      continue;
    }

    ranges.push({ from: match.index, to: match.index + href.length, href });
  }

  return ranges;
}

function buildDecorations(doc: ProseMirrorNode, editHint: boolean): DecorationSet {
  const decorations: Decoration[] = [];
  const attrs: Record<string, string> = editHint
    ? { class: "code-block-link", title: i18n.t("editor.codeLinkHint") }
    : { class: "code-block-link" };

  doc.descendants((node, pos) => {
    if (!node.isTextblock || node.type.spec.code !== true) {
      return true;
    }

    // Content starts one position after the block's opening token.
    const base = pos + 1;

    for (const range of findCodeLinks(node.textContent)) {
      decorations.push(
        Decoration.inline(base + range.from, base + range.to, {
          ...attrs,
          [CODE_LINK_ATTR]: range.href
        })
      );
    }

    return false;
  });

  return DecorationSet.create(doc, decorations);
}

const codeBlockLinksKey = new PluginKey<DecorationSet>("codeBlockLinks");

export type CodeBlockLinksOptions = {
  editHint: boolean;
};

export const CodeBlockLinks = Extension.create<CodeBlockLinksOptions>({
  name: "codeBlockLinks",

  addOptions() {
    return { editHint: true };
  },

  addProseMirrorPlugins() {
    const { editHint } = this.options;

    return [
      new Plugin<DecorationSet>({
        key: codeBlockLinksKey,
        state: {
          init: (_config, state) => buildDecorations(state.doc, editHint),
          apply: (tr, value) => (tr.docChanged ? buildDecorations(tr.doc, editHint) : value)
        },
        props: {
          decorations(state) {
            return this.getState(state);
          }
        }
      })
    ];
  }
});
