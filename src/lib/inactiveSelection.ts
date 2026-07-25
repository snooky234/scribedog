import { Extension } from "@tiptap/core";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";

// Keeps a selection visible while the editor does not have the focus.
//
// ProseMirror holds on to its selection when focus moves away (which is why the
// chat agent's get_selection/replace_selection still work from the chat panel),
// but the browser only paints the native selection of the *focused* element. So
// clicking into the chat input made a deliberate selection look like it was
// gone. This plugin paints that selection itself — only while the focus is
// elsewhere, so it can never sit on top of the native highlight.

const inactiveSelectionKey = new PluginKey<boolean>("inactiveSelection");

export const InactiveSelection = Extension.create({
  name: "inactiveSelection",

  addProseMirrorPlugins() {
    return [
      new Plugin<boolean>({
        key: inactiveSelectionKey,
        state: {
          init: () => false,
          apply: (tr, isBlurred) => {
            const meta = tr.getMeta(inactiveSelectionKey) as boolean | undefined;

            return typeof meta === "boolean" ? meta : isBlurred;
          }
        },
        props: {
          decorations: (state) => {
            if (!inactiveSelectionKey.getState(state)) {
              return null;
            }

            const { from, to, empty } = state.selection;

            if (empty) {
              return null;
            }

            return DecorationSet.create(state.doc, [
              Decoration.inline(from, to, { class: "pm-inactive-selection" })
            ]);
          },
          // A focus change produces no transaction of its own, and decorations
          // are only rebuilt when one arrives — hence the flag is pushed in as
          // transaction metadata. Both handlers return false: the event still
          // has to reach ProseMirror's own focus bookkeeping.
          handleDOMEvents: {
            blur: (view) => {
              view.dispatch(view.state.tr.setMeta(inactiveSelectionKey, true));
              return false;
            },
            focus: (view) => {
              view.dispatch(view.state.tr.setMeta(inactiveSelectionKey, false));
              return false;
            }
          }
        }
      })
    ];
  }
});
