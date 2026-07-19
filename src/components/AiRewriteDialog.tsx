import { Loader2, Mic, PawPrint } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

import { Link } from "@tiptap/extension-link";
import TaskItem from "@tiptap/extension-task-item";
import TaskList from "@tiptap/extension-task-list";
import { EditorContent, useEditor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { Markdown } from "tiptap-markdown";

import { Button } from "@/components/ui/button";
import { VoiceModelDownloadDialog } from "@/components/VoiceModelDownloadDialog";
import { VoiceRecordingBanner } from "@/components/VoiceRecordingBanner";
import { useVoiceInput } from "@/hooks/useVoiceInput";
import { type AiActionMode } from "@/lib/aiClient";

type AiRewriteDialogProps = {
  open: boolean;
  mode: AiActionMode;
  selectedText: string;
  selectedMarkdown: string;
  isLoading: boolean;
  // Increments each time the dialog is opened via the voice shortcut
  // (Ctrl+Shift+E) — recording then starts without a further click.
  voiceStartRequestId: number;
  onSubmit: (prompt: string, includeDocument: boolean, preserveFormatting: boolean) => void;
  onCancel: () => void;
};

export function AiRewriteDialog({
  open,
  mode,
  selectedText,
  selectedMarkdown,
  isLoading,
  voiceStartRequestId,
  onSubmit,
  onCancel
}: AiRewriteDialogProps) {
  const { t } = useTranslation();
  const [prompt, setPrompt] = useState("");
  const [includeDocument, setIncludeDocument] = useState(false);
  const [preserveFormatting, setPreserveFormatting] = useState(true);
  const [voiceError, setVoiceError] = useState<string | null>(null);
  const promptRef = useRef<HTMLTextAreaElement | null>(null);

  const voice = useVoiceInput({
    onTranscript: (text) => {
      setPrompt((previous) => {
        const next = previous.trim() ? `${previous.trimEnd()} ${text}` : text;

        // The textarea is disabled during recording/transcription — re-focus
        // it with the caret at the end of the inserted text once the new
        // value (and the re-enabled field) has rendered.
        requestAnimationFrame(() => {
          const element = promptRef.current;

          if (element) {
            element.focus();
            element.setSelectionRange(next.length, next.length);
          }
        });

        return next;
      });
    },
    onError: (message) => setVoiceError(message)
  });

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
    setVoiceError(null);
    promptRef.current?.focus();
  }, [open]);

  const voiceRef = useRef(voice);
  voiceRef.current = voice;
  const lastVoiceStartRef = useRef(voiceStartRequestId);

  useEffect(() => {
    if (!open || lastVoiceStartRef.current === voiceStartRequestId) {
      lastVoiceStartRef.current = voiceStartRequestId;
      return;
    }

    lastVoiceStartRef.current = voiceStartRequestId;
    voiceRef.current.toggle();
  }, [open, voiceStartRequestId]);

  // Closing the dialog (Esc, backdrop, cancel button) while the mic is open
  // must not leave a recording running in the background.
  useEffect(() => {
    if (!open) {
      voiceRef.current.cancel();
    }
  }, [open]);

  useEffect(() => {
    if (!open) {
      return;
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !isLoading) {
        event.preventDefault();

        if (voiceRef.current.isModelDialogOpen) {
          return;
        }

        // Esc aborts: closing the dialog discards a running recording (see
        // the cancel-on-close effect above). Stopping + transcribing is
        // Enter or Ctrl+Shift+W.
        onCancel();
        return;
      }

      if (
        event.key === "Enter" &&
        !event.ctrlKey &&
        !event.metaKey &&
        !event.shiftKey &&
        voiceRef.current.status === "recording"
      ) {
        event.preventDefault();
        void voiceRef.current.stop();
        return;
      }

      // Ctrl+Shift+W starts a recording here too, mirroring the editor
      // dictation shortcut. Stopping is Enter only.
      if ((event.ctrlKey || event.metaKey) && event.shiftKey && event.key.toLowerCase() === "w") {
        event.preventDefault();

        if (!isLoading && voiceRef.current.status === "idle") {
          voiceRef.current.toggle();
        }

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
  const isRecording = voice.status === "recording";
  const isTranscribing = voice.status === "transcribing";

  return (
    <div className="ai-dialog" role="presentation" onClick={() => !isLoading && onCancel()}>
      <div
        className="ai-dialog__panel ai-dialog__panel--rewrite"
        role="dialog"
        aria-modal="true"
        aria-labelledby="ai-rewrite-title"
        onClick={(event) => event.stopPropagation()}
      >
        <h3 id="ai-rewrite-title" className="ai-dialog__title">
          <PawPrint className="ai-dialog__title-icon" aria-hidden="true" />
          {title}
          {/* While recording there is no stop button — the banner below
              advertises the stop shortcuts (Ctrl+Shift+W / Esc) instead. */}
          {!isRecording ? (
            <button
              type="button"
              className="voice-mic-button"
              onClick={() => {
                setVoiceError(null);
                voice.toggle();
              }}
              disabled={isLoading || isTranscribing || voice.status === "starting"}
              title={t("voice.micStart")}
              aria-label={t("voice.micStart")}
            >
              {isTranscribing ? (
                <Loader2 className="voice-mic-button__icon voice-mic-button__icon--spinning" aria-hidden="true" />
              ) : (
                <Mic className="voice-mic-button__icon" aria-hidden="true" />
              )}
            </button>
          ) : null}
        </h3>

        {isRecording ? (
          <VoiceRecordingBanner
            level={voice.level}
            isRecording
            message={t("voice.dialogRecordingHint")}
            className="editor-view__feedback--dialog"
          />
        ) : null}

        <label className="ai-dialog__field ai-dialog__field--full">
          <textarea
            ref={promptRef}
            rows={5}
            value={prompt}
            onChange={(event) => setPrompt(event.target.value)}
            placeholder={t("aiRewriteDialog.promptPlaceholder")}
            spellCheck={false}
            // No caret and no typing while the microphone is open — disabling
            // also blurs the field; focus comes back after transcription.
            disabled={isRecording || isTranscribing}
          />
        </label>

        {isTranscribing ? <p className="voice-status">{t("voice.transcribing")}</p> : null}
        {voiceError ? <p className="voice-status voice-status--error">{t("voice.error", { error: voiceError })}</p> : null}

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

      <VoiceModelDownloadDialog
        open={voice.isModelDialogOpen}
        onClose={voice.closeModelDialog}
        onDownloaded={voice.handleModelDownloaded}
      />
    </div>
  );
}
