import { Extension } from "@tiptap/core";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";
import type { Editor } from "@tiptap/react";

// Marker at the position where a dictation transcript will be inserted.
// While recording the editor is non-editable and shows no caret, so this
// widget is the only visual anchor for "the text will land here". Like the
// AI stream widget it's a decoration: it tracks the position through any
// document changes without becoming part of the markdown.
export type VoiceInsertWidgetState = {
  pos: number;
} | null;

const voiceInsertWidgetKey = new PluginKey<VoiceInsertWidgetState>("voiceInsertWidget");

function buildMarkerDom(): HTMLElement {
  const marker = document.createElement("span");
  marker.className = "voice-insert-widget";
  marker.textContent = "❯ …";
  return marker;
}

export const VoiceInsertWidget = Extension.create({
  name: "voiceInsertWidget",

  addProseMirrorPlugins() {
    return [
      new Plugin<VoiceInsertWidgetState>({
        key: voiceInsertWidgetKey,
        state: {
          init: () => null,
          apply(tr, value) {
            const meta = tr.getMeta(voiceInsertWidgetKey) as { state: VoiceInsertWidgetState } | undefined;

            if (meta) {
              return meta.state;
            }

            if (!value) {
              return null;
            }

            return { ...value, pos: tr.mapping.map(value.pos) };
          }
        },
        props: {
          decorations(state) {
            const widget = voiceInsertWidgetKey.getState(state);

            if (!widget) {
              return null;
            }

            return DecorationSet.create(state.doc, [
              Decoration.widget(widget.pos, buildMarkerDom, {
                side: 1,
                ignoreSelection: true
              })
            ]);
          }
        }
      })
    ];
  }
});

export function updateVoiceInsertWidget(editor: Editor, state: VoiceInsertWidgetState) {
  if (editor.isDestroyed) {
    return;
  }

  editor.view.dispatch(editor.state.tr.setMeta(voiceInsertWidgetKey, { state }));
}
