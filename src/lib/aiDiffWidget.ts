import { createElement } from "react";
import { createRoot, type Root } from "react-dom/client";

import { Extension } from "@tiptap/core";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";
import type { Editor } from "@tiptap/react";

import { AiDiffResultView } from "@/components/AiDiffResultView";

// Inline diff shown for an AI rewrite: the original selection stays
// untouched in the document (only tinted red via a range decoration), and
// the AI result is rendered as a widget decoration right after it, together
// with the accept/discard/continue-editing actions. It's shown (with actions
// disabled) as soon as the first chunk streams in and keeps growing with
// each chunk, so the red/green comparison is visible immediately instead of
// only once the whole response is done. It lives entirely in decoration land
// (like aiStreamWidget.ts) so "discard" is just clearing this state —
// nothing was ever removed from the document.
export type AiDiffWidgetState = {
  from: number;
  to: number;
  resultMarkdown: string;
  isStreaming: boolean;
  onAccept: () => void;
  onDiscard: () => void;
  onContinueEditing: () => void;
} | null;

const aiDiffWidgetKey = new PluginKey<AiDiffWidgetState>("aiDiffWidget");

// The widget DOM hosts a real React root (so the result preview can reuse
// the same read-only Tiptap rendering AiRewriteDialog uses). It's kept alive
// across re-renders of the *same* widget state and only unmounted when the
// diff closes or the editor is destroyed, so the inner preview editor isn't
// torn down and rebuilt on every unrelated decoration recompute.
let widgetContainer: HTMLElement | null = null;
let widgetRoot: Root | null = null;
let cachedWidgetRef: AiDiffWidgetState = null;
let cachedDecorationSet: DecorationSet | null = null;

function destroyWidget() {
  if (widgetRoot) {
    widgetRoot.unmount();
  }

  widgetRoot = null;
  widgetContainer = null;
  cachedWidgetRef = null;
  cachedDecorationSet = null;
}

function renderWidget(widget: NonNullable<AiDiffWidgetState>): HTMLElement {
  if (!widgetContainer || !widgetRoot) {
    widgetContainer = document.createElement("div");
    widgetContainer.className = "ai-diff-widget";
    widgetContainer.contentEditable = "false";
    widgetRoot = createRoot(widgetContainer);
  }

  widgetRoot.render(
    createElement(AiDiffResultView, {
      resultMarkdown: widget.resultMarkdown,
      isStreaming: widget.isStreaming,
      onAccept: widget.onAccept,
      onDiscard: widget.onDiscard,
      onContinueEditing: widget.onContinueEditing
    })
  );

  return widgetContainer;
}

export const AiDiffWidget = Extension.create({
  name: "aiDiffWidget",

  addProseMirrorPlugins() {
    return [
      new Plugin<AiDiffWidgetState>({
        key: aiDiffWidgetKey,
        state: {
          init: () => null,
          apply(tr, value) {
            const meta = tr.getMeta(aiDiffWidgetKey) as { state: AiDiffWidgetState } | undefined;
            return meta ? meta.state : value;
          }
        },
        props: {
          decorations(state) {
            const widget = aiDiffWidgetKey.getState(state);

            if (!widget) {
              destroyWidget();
              return null;
            }

            // Only rebuild when the widget state object actually changed —
            // decorations() can be called far more often than our own
            // setMeta dispatches, and rebuilding would remount the inner
            // React tree (and its live Tiptap preview) unnecessarily.
            if (widget === cachedWidgetRef && cachedDecorationSet) {
              return cachedDecorationSet;
            }

            cachedWidgetRef = widget;
            const container = renderWidget(widget);

            cachedDecorationSet = DecorationSet.create(state.doc, [
              Decoration.inline(widget.from, widget.to, { class: "ai-diff-widget__original" }),
              Decoration.widget(widget.to, () => container, { side: 1, ignoreSelection: true })
            ]);

            return cachedDecorationSet;
          }
        },
        view() {
          return {
            destroy: destroyWidget
          };
        }
      })
    ];
  }
});

export function updateAiDiffWidget(editor: Editor, state: AiDiffWidgetState) {
  if (editor.isDestroyed) {
    return;
  }

  editor.view.dispatch(editor.state.tr.setMeta(aiDiffWidgetKey, { state }));
}
