import { useEffect, useRef, type KeyboardEvent } from "react";
import { Check, Pencil, X } from "lucide-react";
import { useTranslation } from "react-i18next";

import { EditorContent, useEditor } from "@tiptap/react";

import { buildPreviewExtensions } from "@/lib/editor/extensions";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";

type AiDiffResultViewProps = {
  resultMarkdown: string;
  isStreaming: boolean;
  onAccept: () => void;
  onDiscard: () => void;
  // Omitted for the chat agent's proposals (see aiSuggestionWidget.ts): those
  // are refined by talking to the agent, so a "continue editing" prompt round
  // would be a second, competing way to do the same thing.
  onContinueEditing?: () => void;
  // Several proposals can be open at once — only the single rewrite diff may
  // pull focus to its accept button.
  autoFocusAccept?: boolean;
};

export function AiDiffResultView({
  resultMarkdown,
  isStreaming,
  onAccept,
  onDiscard,
  onContinueEditing,
  autoFocusAccept = true
}: AiDiffResultViewProps) {
  const { t } = useTranslation();
  const acceptButtonRef = useRef<HTMLButtonElement | null>(null);
  const actionsRef = useRef<HTMLDivElement | null>(null);

  // As soon as streaming finishes and the actions become enabled, move focus
  // to "Accept" so Enter applies the result immediately and Tab/Shift+Tab
  // reach the other actions without touching the mouse.
  useEffect(() => {
    if (!isStreaming && autoFocusAccept) {
      acceptButtonRef.current?.focus();
    }
  }, [isStreaming, autoFocusAccept]);

  const handleActionsKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") {
      return;
    }

    const buttons = Array.from(
      actionsRef.current?.querySelectorAll<HTMLButtonElement>("button:not(:disabled)") ?? []
    );
    const currentIndex = buttons.indexOf(document.activeElement as HTMLButtonElement);

    if (currentIndex === -1) {
      return;
    }

    event.preventDefault();
    const delta = event.key === "ArrowRight" ? 1 : -1;
    const nextIndex = (currentIndex + delta + buttons.length) % buttons.length;
    buttons[nextIndex]?.focus();
  };

  const previewEditor = useEditor(
    {
      // The editor's own content extensions, so the preview parses the proposal
      // through the same schema the document uses — a table, callout or
      // underline missing here would silently degrade to plain text.
      extensions: buildPreviewExtensions(),
      content: resultMarkdown,
      editable: false
    },
    []
  );

  useEffect(() => {
    try {
      // Streamed markdown is by definition incomplete between chunks (e.g. an
      // unterminated code fence) — the parser tolerates that, but this still
      // shouldn't be able to take the whole widget down if it doesn't.
      previewEditor?.commands.setContent(resultMarkdown || "");
    } catch {
      // Next chunk's re-parse of the fuller text recovers.
    }
  }, [previewEditor, resultMarkdown]);

  return (
    <>
      <div className="ai-diff-widget__result">
        <span
          className={cn(
            "ai-diff-widget__result-label",
            isStreaming && "ai-diff-widget__result-label--streaming"
          )}
        >
          {isStreaming
            ? t("editor.aiGenerating")
            : onContinueEditing
              ? t("aiDiffWidget.resultLabel")
              : t("aiDiffWidget.suggestionLabel")}
        </span>
        <EditorContent
          editor={previewEditor}
          className="ai-diff-widget__result-content prose dark:prose-invert max-w-none"
        />
      </div>
      <div className="ai-diff-widget__actions" ref={actionsRef} onKeyDown={handleActionsKeyDown}>
        {onContinueEditing ? (
          <Button type="button" size="sm" variant="outline" onClick={onContinueEditing} disabled={isStreaming}>
            <Pencil aria-hidden="true" />
            {t("aiDiffWidget.continueEditing")}
          </Button>
        ) : null}
        <Button type="button" size="sm" variant="destructive" onClick={onDiscard} disabled={isStreaming}>
          <X aria-hidden="true" />
          {t("aiDiffWidget.discard")}
        </Button>
        <Button
          ref={acceptButtonRef}
          type="button"
          size="sm"
          variant="default"
          onClick={onAccept}
          disabled={isStreaming}
        >
          <Check aria-hidden="true" />
          {t("aiDiffWidget.accept")}
        </Button>
      </div>
    </>
  );
}
