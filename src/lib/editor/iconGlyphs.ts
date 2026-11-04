import { Extension } from "@tiptap/core";
import type { Node as ProseMirrorNode } from "@tiptap/pm/model";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";

// A glyph of an icon font is drawn wider than the space its font reserves for
// it (a Nerd Font icon runs up to a full em on a 0.6em advance), so it would
// sit on the next letter. The characters are marked with an inline decoration
// and styled with some room to their right (editor-content.css). Decorations
// leave the document alone: the markdown, undo history and exports see the
// same plain text as before.

export const ICON_GLYPH_CLASS = "icon-glyph";
/** The glyph is followed by a space, which already gives it some of the room it needs. */
export const ICON_GLYPH_SPACED_CLASS = "icon-glyph--spaced";

const PRIVATE_USE_PATTERN = /[\uE000-\uF8FF\u{F0000}-\u{10FFFD}]/gu;

export function findIconGlyphs(text: string): { from: number; to: number; spaceAfter: boolean }[] {
  return [...text.matchAll(PRIVATE_USE_PATTERN)].map((match) => {
    const to = match.index + match[0].length;

    return { from: match.index, to, spaceAfter: /^\s/.test(text.slice(to, to + 1)) };
  });
}

function buildDecorations(doc: ProseMirrorNode): DecorationSet {
  const decorations: Decoration[] = [];

  doc.descendants((node, pos) => {
    if (node.isText && node.text) {
      for (const range of findIconGlyphs(node.text)) {
        decorations.push(Decoration.inline(pos + range.from, pos + range.to, {
            class: range.spaceAfter ? `${ICON_GLYPH_CLASS} ${ICON_GLYPH_SPACED_CLASS}` : ICON_GLYPH_CLASS
          }));
      }
    }

    return true;
  });

  return DecorationSet.create(doc, decorations);
}

const iconGlyphsKey = new PluginKey<DecorationSet>("iconGlyphs");

export const IconGlyphs = Extension.create({
  name: "iconGlyphs",

  addProseMirrorPlugins() {
    return [
      new Plugin<DecorationSet>({
        key: iconGlyphsKey,
        state: {
          init: (_config, state) => buildDecorations(state.doc),
          apply: (tr, value) => (tr.docChanged ? buildDecorations(tr.doc) : value)
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
