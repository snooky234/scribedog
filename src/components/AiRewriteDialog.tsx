import { PawPrint } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

import { Link } from "@tiptap/extension-link";
import TaskItem from "@tiptap/extension-task-item";
import TaskList from "@tiptap/extension-task-list";
import { EditorContent, useEditor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { Markdown } from "tiptap-markdown";

import { Button } from "@/components/ui/button";
import { type AiActionMode } from "@/lib/aiClient";

type AiRewriteDialogProps = {
  open: boolean;
  mode: AiActionMode;
  selectedText: string;
  selectedMarkdown: string;
  isLoading: boolean;
  onSubmit: (prompt: string, includeDocument: boolean, preserveFormatting: boolean) => void;
  onCancel: () => void;
};

export function AiRewriteDialog({
  open,
  mode,
  selectedText,
  selectedMarkdown,
  isLoading,
  onSubmit,
  onCancel
}: AiRewriteDialogProps) {
  const { t } = useTranslation();
  const [prompt, setPrompt] = useState("");
  const [includeDocument, setIncludeDocument] = useState(false);
  const [preserveFormatting, setPreserveFormatting] = useState(true);
  const promptRef = useRef<HTMLTextAreaElement | null>(null);

  const previewMarkdown = selectedMarkdown || selectedText;

  const previewEditor = useEditor(
    {
      extensions: [
        StarterKit,
        TaskList,
        TaskItem.configure({ nested: true }),
        Link.configure({ autolink: false, linkOnPaste: false, openOnClick: false }),
        Markdown.configure({ html: false, breaks: true })
      ],
      content: previewMarkdown,
      editable: false
    },
    []
  );

  useEffect(() => {
    previewEditor?.commands.setContent(previewMarkdown || "");
  }, [previewEditor, previewMarkdown]);

  useEffect(() => {
    if (!open) {
      return;
    }

    setPrompt("");
    setIncludeDocument(false);
    setPreserveFormatting(true);
    promptRef.current?.focus();
  }, [open]);

  useEffect(() => {
    if (!open) {
      return;
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !isLoading) {
        event.preventDefault();
        onCancel();
        return;
      }

      if ((event.ctrlKey || event.metaKey) && event.key === "Enter") {
        event.preventDefault();

        if (!isLoading && prompt.trim()) {
          onSubmit(prompt, includeDocument, preserveFormatting);
        }
      }
    };

    window.addEventListener("keydown", handleKeyDown);

    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [open, isLoading, onCancel, onSubmit, prompt, includeDocument, preserveFormatting]);

  if (!open) {
    return null;
  }

  const title = mode === "insert" ? t("aiRewriteDialog.insertTitle") : t("aiRewriteDialog.rewriteTitle");

  return (
    <div className="ai-dialog" role="presentation" onClick={() => !isLoading && onCancel()}>
      <div
        className="ai-dialog__panel ai-dialog__panel--rewrite"
        role="dialog"
        aria-modal="true"
        aria-labelledby="ai-rewrite-title"
        onClick={(event) => event.stopPropagation()}
      >
        <p className="ai-dialog__eyebrow">{t("aiRewriteDialog.eyebrow")}</p>
        <h3 id="ai-rewrite-title" className="ai-dialog__title">
          <PawPrint className="ai-dialog__title-icon" aria-hidden="true" />
          {title}
        </h3>

        <label className="ai-dialog__field ai-dialog__field--full">
          <textarea
            ref={promptRef}
            rows={5}
            value={prompt}
            onChange={(event) => setPrompt(event.target.value)}
            placeholder={t("aiRewriteDialog.promptPlaceholder")}
            spellCheck={false}
          />
        </label>

        <label className="ai-dialog__switch">
          <input
            type="checkbox"
            checked={includeDocument}
            onChange={(event) => setIncludeDocument(event.target.checked)}
          />
          <span>{t("aiRewriteDialog.includeDocument")}</span>
        </label>

        {mode === "rewrite" && (
          <label className="ai-dialog__switch">
            <input
              type="checkbox"
              checked={preserveFormatting}
              onChange={(event) => setPreserveFormatting(event.target.checked)}
            />
            <span>{t("aiRewriteDialog.preserveFormatting")}</span>
          </label>
        )}

        <div className="ai-dialog__preview">
          <span>{mode === "insert" ? t("aiRewriteDialog.cursorContext") : t("aiRewriteDialog.selectedText")}</span>
          {previewMarkdown ? (
            <EditorContent
              editor={previewEditor}
              className="ai-dialog__preview-content prose prose-invert max-w-none"
            />
          ) : (
            <p className="ai-dialog__preview-empty">{t("aiRewriteDialog.noText")}</p>
          )}
        </div>

        <div className="ai-dialog__actions">
          <Button type="button" variant="outline" onClick={onCancel} disabled={isLoading}>
            {t("common.cancel")}
          </Button>
          <Button
            type="button"
            onClick={() => onSubmit(prompt, includeDocument, preserveFormatting)}
            disabled={isLoading || !prompt.trim()}
          >
            {isLoading ? t("aiRewriteDialog.processing") : t("aiRewriteDialog.run")}
          </Button>
        </div>
      </div>
    </div>
  );
}
