import { Mic } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

import { Button } from "@/components/ui/button";
import {
  downloadVoiceModel,
  listenToVoiceModelDownloadProgress,
  VOICE_MODEL_SIZE_MB,
  type VoiceModelDownloadProgress
} from "@/lib/voice";

type VoiceModelDownloadDialogProps = {
  open: boolean;
  onClose: () => void;
  onDownloaded: () => void;
};

// Opt-in gate for the one-time whisper model download. The app is
// offline-by-default, so the download never starts without an explicit click
// in this dialog.
export function VoiceModelDownloadDialog({ open, onClose, onDownloaded }: VoiceModelDownloadDialogProps) {
  const { t } = useTranslation();
  const [isDownloading, setIsDownloading] = useState(false);
  const [progress, setProgress] = useState<VoiceModelDownloadProgress | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const unlistenRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    if (!open) {
      setIsDownloading(false);
      setProgress(null);
      setErrorMessage(null);
    }

    return () => {
      unlistenRef.current?.();
      unlistenRef.current = null;
    };
  }, [open]);

  useEffect(() => {
    if (!open) {
      return;
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !isDownloading) {
        event.preventDefault();
        onClose();
      }
    };

    window.addEventListener("keydown", handleKeyDown);

    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [open, isDownloading, onClose]);

  if (!open) {
    return null;
  }

  const startDownload = async () => {
    setIsDownloading(true);
    setErrorMessage(null);

    try {
      unlistenRef.current = await listenToVoiceModelDownloadProgress(setProgress);
      await downloadVoiceModel();
      onDownloaded();
    } catch (error) {
      setErrorMessage(typeof error === "string" ? error : String(error));
      setIsDownloading(false);
    } finally {
      unlistenRef.current?.();
      unlistenRef.current = null;
    }
  };

  const downloadedMb = progress ? Math.round(progress.downloadedBytes / (1024 * 1024)) : 0;
  const totalMb = progress?.totalBytes ? Math.round(progress.totalBytes / (1024 * 1024)) : VOICE_MODEL_SIZE_MB;
  const percent = Math.min(100, Math.round((downloadedMb / totalMb) * 100));

  return (
    <div className="ai-dialog" role="presentation" onClick={() => !isDownloading && onClose()}>
      <div
        className="ai-dialog__panel"
        role="dialog"
        aria-modal="true"
        aria-labelledby="voice-model-title"
        onClick={(event) => event.stopPropagation()}
      >
        <h3 id="voice-model-title" className="ai-dialog__title">
          <Mic className="ai-dialog__title-icon" aria-hidden="true" />
          {t("voice.modelDialog.title")}
        </h3>

        <p className="ai-dialog__description">
          {t("voice.modelDialog.description", { size: VOICE_MODEL_SIZE_MB })}
        </p>

        {isDownloading ? (
          <div className="voice-download">
            <div
              className="voice-download__bar"
              role="progressbar"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={percent}
            >
              <div className="voice-download__bar-fill" style={{ width: `${percent}%` }} />
            </div>
            <p className="voice-download__label">
              {t("voice.modelDialog.progress", { downloaded: downloadedMb, total: totalMb })}
            </p>
          </div>
        ) : null}

        {errorMessage ? (
          <p className="ai-dialog__error">{t("voice.modelDialog.failed", { error: errorMessage })}</p>
        ) : null}

        <div className="ai-dialog__actions">
          <Button type="button" variant="outline" onClick={onClose} disabled={isDownloading}>
            {t("common.cancel")}
          </Button>
          <Button type="button" onClick={() => void startDownload()} disabled={isDownloading}>
            {isDownloading ? t("voice.modelDialog.downloading") : t("voice.modelDialog.download")}
          </Button>
        </div>
      </div>
    </div>
  );
}
