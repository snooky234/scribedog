import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { CheckCircle2, CircleAlert, CircleSlash, Loader2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  importFiles,
  type ImportItemResult,
  type ImportProgress
} from "@/lib/import/importer";

type ImportDialogProps = {
  // The selected source files; null keeps the dialog closed.
  files: string[] | null;
  vaultRoot: string | null;
  onImported: (createdFilePaths: string[]) => void;
  onClose: () => void;
};

function statusIcon(item: ImportItemResult) {
  if (item.status === "done") {
    return <CheckCircle2 className="import-dialog__icon import-dialog__icon--done" aria-hidden="true" />;
  }

  if (item.status === "error") {
    return <CircleAlert className="import-dialog__icon import-dialog__icon--error" aria-hidden="true" />;
  }

  if (item.status === "cancelled") {
    return <CircleSlash className="import-dialog__icon import-dialog__icon--cancelled" aria-hidden="true" />;
  }

  if (item.status === "converting") {
    return <Loader2 className="import-dialog__icon import-dialog__icon--spinner" aria-hidden="true" />;
  }

  return <span className="import-dialog__icon" aria-hidden="true" />;
}

export function ImportDialog({ files, vaultRoot, onImported, onClose }: ImportDialogProps) {
  const { t } = useTranslation();
  const [progress, setProgress] = useState<ImportProgress | null>(null);
  const [isRunning, setIsRunning] = useState(false);
  const [wasCancelled, setWasCancelled] = useState(false);
  const runIdRef = useRef(0);
  const abortControllerRef = useRef<AbortController | null>(null);

  const isOpen = files !== null && files.length > 0;

  useEffect(() => {
    if (!files || files.length === 0 || !vaultRoot) {
      setProgress(null);
      setIsRunning(false);
      return;
    }

    const runId = runIdRef.current + 1;
    runIdRef.current = runId;
    const abortController = new AbortController();
    abortControllerRef.current = abortController;
    setIsRunning(true);
    setWasCancelled(false);
    setProgress(null);

    void importFiles(
      files,
      vaultRoot,
      (nextProgress) => {
        if (runIdRef.current === runId) {
          setProgress(nextProgress);
        }
      },
      abortController.signal
    ).then((results) => {
      if (runIdRef.current !== runId) {
        return;
      }

      setIsRunning(false);
      onImported(
        results
          .filter((item) => item.status === "done" && item.createdFilePath)
          .map((item) => item.createdFilePath as string)
      );
    });
    // onImported is intentionally excluded: the import must run exactly once
    // per file selection, not restart when the parent re-renders.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [files, vaultRoot]);

  const handleCancel = useCallback(() => {
    if (!isRunning) {
      return;
    }

    setWasCancelled(true);
    abortControllerRef.current?.abort();
  }, [isRunning]);

  const handleClose = useCallback(() => {
    if (isRunning) {
      return;
    }

    onClose();
  }, [isRunning, onClose]);

  useEffect(() => {
    if (!isOpen) {
      return;
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        handleClose();
      }
    };

    window.addEventListener("keydown", handleKeyDown);

    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, handleClose]);

  if (!isOpen) {
    return null;
  }

  const items = progress?.items ?? [];
  const doneCount = items.filter((item) => item.status === "done").length;
  const errorCount = items.filter((item) => item.status === "error").length;
  const cancelledCount = items.filter((item) => item.status === "cancelled").length;

  return (
    <div className="unsaved-dialog" role="presentation" onClick={handleClose}>
      <div
        className="unsaved-dialog__panel export-dialog__panel"
        role="dialog"
        aria-modal="true"
        aria-labelledby="import-dialog-title"
        onClick={(event) => event.stopPropagation()}
      >
        <p className="unsaved-dialog__eyebrow">{t("importDialog.eyebrow")}</p>
        <h3 id="import-dialog-title">{t("importDialog.title")}</h3>

        <p className="unsaved-dialog__description" role="status">
          {isRunning && wasCancelled
            ? t("importDialog.cancelling")
            : isRunning && progress
              ? t("importDialog.progress", {
                  completed: Math.min(progress.completed + 1, progress.total),
                  total: progress.total
                })
              : isRunning
                ? t("importDialog.importing")
                : cancelledCount > 0
                  ? t("importDialog.doneSummaryCancelled", { doneCount, errorCount, cancelledCount })
                  : t("importDialog.doneSummary", { doneCount, errorCount })}
        </p>

        <ul className="import-dialog__list">
          {items.map((item) => (
            <li key={item.sourcePath} className="import-dialog__item">
              {statusIcon(item)}
              <span className="import-dialog__name" title={item.sourcePath}>
                {item.sourceName}
              </span>
              {item.status === "error" && item.errorKey ? (
                <span className="import-dialog__error" role="alert">
                  {t(`importDialog.${item.errorKey}`, { message: item.errorDetail ?? "" })}
                </span>
              ) : null}
            </li>
          ))}
        </ul>

        <div className="unsaved-dialog__actions">
          {isRunning ? (
            <Button
              type="button"
              variant="outline"
              onClick={handleCancel}
              disabled={wasCancelled}
            >
              {t("common.cancel")}
            </Button>
          ) : (
            <Button type="button" onClick={handleClose}>
              {t("common.close")}
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
