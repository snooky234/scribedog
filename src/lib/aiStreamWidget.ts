import { Extension } from "@tiptap/core";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";
import type { Editor } from "@tiptap/react";

import i18n from "@/i18n";

// Inline widget at the insertion point that shows either the model's
// reasoning trace (preview box) or a loading animation while an AI request
// is running. It lives as a ProseMirror decoration so it sits exactly at the
// text position and automatically follows document changes, without itself
// becoming part of the document (and thus the markdown).
export type AiStreamWidgetState = {
  pos: number;
  kind: "loading" | "thinking";
  thinkingText: string;
} | null;

const aiStreamWidgetKey = new PluginKey<AiStreamWidgetState>("aiStreamWidget");

function buildLoadingDom(): HTMLElement {
  const dots = document.createElement("span");
  dots.className = "ai-stream-widget__dots";

  for (let index = 0; index < 3; index++) {
    const dot = document.createElement("span");
    dot.className = "ai-stream-widget__dot";
    dots.appendChild(dot);
  }

  const label = document.createElement("span");
  label.className = "ai-stream-widget__label";
  label.textContent = i18n.t("editor.aiGenerating");

  const wrap = document.createElement("span");
  wrap.className = "ai-stream-widget ai-stream-widget--loading";
  wrap.append(dots, label);

  return wrap;
}

function buildThinkingDom(thinkingText: string): HTMLElement {
  const pulse = document.createElement("span");
  pulse.className = "ai-stream-widget__pulse";

  const label = document.createElement("span");
  label.className = "ai-stream-widget__label";
  label.textContent = i18n.t("editor.aiThinking");

  const header = document.createElement("span");
  header.className = "ai-stream-widget__header";
  header.append(pulse, label);

  const wrap = document.createElement("span");
  wrap.className = "ai-stream-widget ai-stream-widget--thinking";
  wrap.appendChild(header);

  if (thinkingText) {
    const body = document.createElement("span");
    body.className = "ai-stream-widget__body";
    body.textContent = thinkingText;
    wrap.appendChild(body);

    // The box should behave like a live log and always show the latest
    // thoughts; the DOM is rebuilt per chunk, so scroll to the end after
    // mounting.
    requestAnimationFrame(() => {
      body.scrollTop = body.scrollHeight;
    });
  }

  return wrap;
}

export const AiStreamWidget = Extension.create({
  name: "aiStreamWidget",

  addProseMirrorPlugins() {
    return [
      new Plugin<AiStreamWidgetState>({
        key: aiStreamWidgetKey,
        state: {
          init: () => null,
          apply(tr, value) {
            const meta = tr.getMeta(aiStreamWidgetKey) as { state: AiStreamWidgetState } | undefined;

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
            const widget = aiStreamWidgetKey.getState(state);

            if (!widget) {
              return null;
            }

            return DecorationSet.create(state.doc, [
              Decoration.widget(
                widget.pos,
                () =>
                  widget.kind === "loading" ? buildLoadingDom() : buildThinkingDom(widget.thinkingText),
                { side: 1, ignoreSelection: true }
              )
            ]);
          }
        }
      })
    ];
  }
});

export function updateAiStreamWidget(editor: Editor, state: AiStreamWidgetState) {
  if (editor.isDestroyed) {
    return;
  }

  editor.view.dispatch(editor.state.tr.setMeta(aiStreamWidgetKey, { state }));
}
