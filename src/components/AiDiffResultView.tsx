import { useEffect } from "react";
import { Check, Pencil, X } from "lucide-react";
import { useTranslation } from "react-i18next";

import { Link } from "@tiptap/extension-link";
import TaskItem from "@tiptap/extension-task-item";
import TaskList from "@tiptap/extension-task-list";
import { EditorContent, useEditor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { Markdown } from "tiptap-markdown";

import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";

type AiDiffResultViewProps = {
  resultMarkdown: string;
  isStreaming: boolean;
  onAccept: () => void;
  onDiscard: () => void;
  onContinueEditing: () => void;
};

export function AiDiffResultView({
  resultMarkdown,
  isStreaming,
  onAccept,
  onDiscard,
  onContinueEditing
}: AiDiffResultViewProps) {
  const { t } = useTranslation();

  const previewEditor = useEditor(
    {
      extensions: [
        StarterKit,
        TaskList,
        TaskItem.configure({ nested: true }),
        Link.configure({ autolink: false, linkOnPaste: false, openOnClick: false }),
        Markdown.configure({ html: false, breaks: true })
      ],
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
          {isStreaming ? t("editor.aiGenerating") : t("aiDiffWidget.resultLabel")}
        </span>
        <EditorContent
          editor={previewEditor}
          className="ai-diff-widget__result-content prose dark:prose-invert max-w-none"
        />
      </div>
      <div className="ai-diff-widget__actions">
        <Button type="button" size="sm" variant="outline" onClick={onContinueEditing} disabled={isStreaming}>
          <Pencil aria-hidden="true" />
          {t("aiDiffWidget.continueEditing")}
        </Button>
        <Button type="button" size="sm" variant="destructive" onClick={onDiscard} disabled={isStreaming}>
          <X aria-hidden="true" />
          {t("aiDiffWidget.discard")}
        </Button>
        <Button type="button" size="sm" variant="default" onClick={onAccept} disabled={isStreaming}>
          <Check aria-hidden="true" />
          {t("aiDiffWidget.accept")}
        </Button>
      </div>
    </>
  );
}
