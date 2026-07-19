import { Extension } from "@tiptap/core";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";
import type { Node as ProseMirrorNode } from "@tiptap/pm/model";
import type { Editor } from "@tiptap/react";

import { buildSearchRegex, findMatchesInDoc, type SearchOptions } from "@/lib/textSearch";

// Live highlighting for the find & replace panel. The plugin keeps the query
// itself (not just decorations) in its state so it can recompute the match
// set whenever the document changes while a search is active — mapping stale
// decorations through an edit would keep highlighting text that no longer
// matches.
export type SearchHighlightState = {
  query: string;
  options: SearchOptions;
  activeIndex: number;
} | null;

const searchHighlightKey = new PluginKey<SearchHighlightState>("searchHighlight");

function buildDecorations(doc: ProseMirrorNode, state: SearchHighlightState): DecorationSet {
  if (!state) {
    return DecorationSet.empty;
  }

  const regex = buildSearchRegex(state.query, state.options);

  if (!regex) {
    return DecorationSet.empty;
  }

  const decorations = findMatchesInDoc(doc, regex).map((match, index) =>
    Decoration.inline(match.from, match.to, {
      class: index === state.activeIndex ? "search-match search-match--active" : "search-match"
    })
  );

  return DecorationSet.create(doc, decorations);
}

export const SearchHighlight = Extension.create({
  name: "searchHighlight",

  addProseMirrorPlugins() {
    return [
      new Plugin<{ config: SearchHighlightState; decorations: DecorationSet }>({
        key: searchHighlightKey as PluginKey,
        state: {
          init: () => ({ config: null, decorations: DecorationSet.empty }),
          apply(tr, value) {
            const meta = tr.getMeta(searchHighlightKey) as { state: SearchHighlightState } | undefined;

            if (meta) {
              return { config: meta.state, decorations: buildDecorations(tr.doc, meta.state) };
            }

            if (!value.config) {
              return value;
            }

            if (tr.docChanged) {
              return { ...value, decorations: buildDecorations(tr.doc, value.config) };
            }

            return value;
          }
        },
        props: {
          decorations(state) {
            return (
              (searchHighlightKey.getState(state) as unknown as { decorations: DecorationSet } | undefined)
                ?.decorations ?? null
            );
          }
        }
      })
    ];
  }
});

export function updateSearchHighlight(editor: Editor, state: SearchHighlightState) {
  if (editor.isDestroyed) {
    return;
  }

  editor.view.dispatch(editor.state.tr.setMeta(searchHighlightKey, { state }));
}
