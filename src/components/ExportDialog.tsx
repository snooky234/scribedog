import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { open as openFolderDialog } from "@tauri-apps/plugin-dialog";
import { FolderOpen } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  EXPORT_FORMATS,
  exportFolderNotes,
  exportMultipleNotes,
  exportSingleNote,
  getLastExportDirectory,
  getLastExportFormat,
  type ConflictResolution,
  type ExportFormat,
  type ExportOutcome,
  type ExportProgress,
  type MarkdownReader,
  type MultipleExportEntry
} from "@/lib/export/exporter";

export type ExportDialogTarget =
  | {
      kind: "file";
      sourcePath: string;
      defaultName: string;
    }
  | {
      kind: "folder";
      sourcePath: string;
      defaultName: string;
    }
  | {
      kind: "multiple";
      entries: MultipleExportEntry[];
      defaultName: string;
    };

type ExportDialogProps = {
  target: ExportDialogTarget | null;
  readMarkdown: MarkdownReader;
  onClose: () => void;
};

type PendingConflict = {
  fileName: string;
  resolve: (resolution: ConflictResolution) => void;
};

type DialogPhase = "form" | "exporting" | "done" | "error";

const FORMAT_LABELS: Record<ExportFormat, string> = {
  pdf: "PDF",
  docx: "DOCX (Word)",
  odt: "ODT (OpenDocument)",
  html: "HTML"
};

export function ExportDialog({ target, readMarkdown, onClose }: ExportDialogProps) {
  const { t } = useTranslation();
  const [format, setFormat] = useState<ExportFormat>("pdf");
  const [name, setName] = useState("");
  const [targetDirectory, setTargetDirectory] = useState<string | null>(null);
  const [phase, setPhase] = useState<DialogPhase>("form");
  const [progress, setProgress] = useState<ExportProgress | null>(null);
  const [conflict, setConflict] = useState<PendingConflict | null>(null);
  const [applyToAll, setApplyToAll] = useState(false);
  const [outcome, setOutcome] = useState<ExportOutcome | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const nameInputRef = useRef<HTMLInputElement>(null);

  const isOpen = target !== null;
  const isExporting = phase === "exporting";

  // Re-initialize the form whenever the dialog opens for a new target.
  useEffect(() => {
    if (!target) {
      return;
    }

    setFormat(getLastExportFormat());
    setName(target.defaultName);
    setTargetDirectory(getLastExportDirectory());
    setPhase("form");
    setProgress(null);
    setConflict(null);
    setApplyToAll(false);
    setOutcome(null);
    setErrorMessage(null);
  }, [target]);

  useEffect(() => {
    if (isOpen && phase === "form") {
      nameInputRef.current?.focus();
    }
  }, [isOpen, phase]);

  const handleClose = useCallback(() => {
    if (isExporting && !conflict) {
      return;
    }

    // Closing during a conflict prompt cancels the remaining export.
    conflict?.resolve({ decision: "cancel", applyToAll: false });
    setConflict(null);
    onClose();
  }, [isExporting, conflict, onClose]);

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

  const chooseTargetDirectory = async () => {
    const selected = await openFolderDialog({
      directory: true,
      recursive: true,
      defaultPath: targetDirectory ?? undefined,
      title: t("exportDialog.chooseFolderTitle")
    });

    if (typeof selected === "string") {
      setTargetDirectory(selected);
    }
  };

  const resolveConflict = (fileName: string): Promise<ConflictResolution> =>
    new Promise((resolve) => {
      setApplyToAll(false);
      setConflict({ fileName, resolve });
    });

  const answerConflict = (decision: ConflictResolution["decision"]) => {
    conflict?.resolve({ decision, applyToAll });
    setConflict(null);
  };

  const startExport = async () => {
    if (!target || !targetDirectory || !name.trim()) {
      return;
    }

    setPhase("exporting");
    setErrorMessage(null);

    try {
      const result =
        target.kind === "file"
          ? await exportSingleNote({
              markdownFilePath: target.sourcePath,
              format,
              targetDirectory,
              baseName: name.trim(),
              readMarkdown,
              onConflict: resolveConflict
            })
          : target.kind === "folder"
            ? await exportFolderNotes({
                sourceFolderPath: target.sourcePath,
                format,
                targetDirectory,
                folderName: name.trim(),
                readMarkdown,
                onConflict: resolveConflict,
                onProgress: setProgress
              })
            : await exportMultipleNotes({
                entries: target.entries,
                format,
                targetDirectory,
                folderName: name.trim(),
                readMarkdown,
                onConflict: resolveConflict,
                onProgress: setProgress
              });

      if (result.cancelled) {
        onClose();
        return;
      }

      // A quiet single-file export needs no summary screen; folder exports
      // (and skipped files) get one so the user sees what happened.
      if (target.kind === "file" && result.skippedCount === 0) {
        onClose();
        return;
      }

      setOutcome(result);
      setPhase("done");
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : String(error));
      setPhase("error");
    } finally {
      setProgress(null);
      setConflict(null);
    }
  };

  if (!target) {
    return null;
  }

  const isFolder = target.kind === "folder";
  const isMultiple = target.kind === "multiple";
  const hasMultipleFiles = isFolder || isMultiple;
  const canExport = Boolean(targetDirectory) && name.trim().length > 0;

  return (
    <div className="unsaved-dialog" role="presentation" onClick={handleClose}>
      <div
        className="unsaved-dialog__panel export-dialog__panel"
        role="dialog"
        aria-modal="true"
        aria-labelledby="export-dialog-title"
        onClick={(event) => event.stopPropagation()}
      >
        <p className="unsaved-dialog__eyebrow">
          {t(
            isMultiple
              ? "exportDialog.eyebrowMultiple"
              : isFolder
                ? "exportDialog.eyebrowFolder"
                : "exportDialog.eyebrowFile"
          )}
        </p>
        <h3 id="export-dialog-title">
          {t(
            isMultiple
              ? "exportDialog.titleMultiple"
              : isFolder
                ? "exportDialog.titleFolder"
                : "exportDialog.titleFile"
          )}
        </h3>

        {conflict ? (
          <>
            <p className="unsaved-dialog__description">
              {t("exportDialog.conflictDescription", { fileName: conflict.fileName })}
            </p>

            {hasMultipleFiles ? (
              <label className="export-dialog__apply-all">
                <input
                  type="checkbox"
                  checked={applyToAll}
                  onChange={(event) => setApplyToAll(event.target.checked)}
                />
                {t("exportDialog.conflictApplyToAll")}
              </label>
            ) : null}

            <div className="unsaved-dialog__actions">
              <Button type="button" variant="outline" onClick={handleClose}>
                {t("common.cancel")}
              </Button>
              {hasMultipleFiles ? (
                <Button type="button" variant="outline" onClick={() => answerConflict("skip")}>
                  {t("exportDialog.conflictSkip")}
                </Button>
              ) : null}
              <Button type="button" variant="destructive" onClick={() => answerConflict("overwrite")}>
                {t("exportDialog.conflictOverwrite")}
              </Button>
            </div>
          </>
        ) : phase === "done" ? (
          <>
            <p className="unsaved-dialog__description">
              {t("exportDialog.doneSummary", {
                exportedCount: outcome?.exportedCount ?? 0,
                skippedCount: outcome?.skippedCount ?? 0
              })}
            </p>

            <div className="unsaved-dialog__actions">
              <Button type="button" onClick={onClose}>
                {t("common.close")}
              </Button>
            </div>
          </>
        ) : (
          <>
            <p className="unsaved-dialog__description">
              {t(
                isMultiple
                  ? "exportDialog.descriptionMultiple"
                  : isFolder
                    ? "exportDialog.descriptionFolder"
                    : "exportDialog.descriptionFile"
              )}
            </p>

            <div className="export-dialog__form">
              <label className="export-dialog__field">
                <span>{t("exportDialog.formatLabel")}</span>
                <select
                  value={format}
                  disabled={isExporting}
                  onChange={(event) => setFormat(event.target.value as ExportFormat)}
                >
                  {EXPORT_FORMATS.map((formatOption) => (
                    <option key={formatOption} value={formatOption}>
                      {FORMAT_LABELS[formatOption]}
                    </option>
                  ))}
                </select>
              </label>

              <label className="export-dialog__field">
                <span>{t(hasMultipleFiles ? "exportDialog.folderNameLabel" : "exportDialog.fileNameLabel")}</span>
                <input
                  ref={nameInputRef}
                  type="text"
                  value={name}
                  disabled={isExporting}
                  spellCheck={false}
                  onChange={(event) => setName(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" && canExport && !isExporting) {
                      event.preventDefault();
                      void startExport();
                    }
                  }}
                />
              </label>

              <div className="export-dialog__field">
                <span>{t("exportDialog.destinationLabel")}</span>
                <div className="export-dialog__destination">
                  <span
                    className="export-dialog__destination-path"
                    title={targetDirectory ?? undefined}
                  >
                    {targetDirectory ?? t("exportDialog.noDestination")}
                  </span>
                  <Button
                    type="button"
                    variant="outline"
                    disabled={isExporting}
                    onClick={() => void chooseTargetDirectory()}
                  >
                    <FolderOpen aria-hidden="true" />
                    {t("exportDialog.chooseFolder")}
                  </Button>
                </div>
              </div>
            </div>

            {phase === "error" && errorMessage ? (
              <p className="export-dialog__error" role="alert">
                {t("exportDialog.errorMessage", { message: errorMessage })}
              </p>
            ) : null}

            {isExporting ? (
              <p className="export-dialog__progress" role="status">
                {progress && progress.total > 0
                  ? t("exportDialog.progress", {
                      completed: Math.min(progress.completed + 1, progress.total),
                      total: progress.total,
                      fileName: progress.currentFileName
                    })
                  : t("exportDialog.exporting")}
              </p>
            ) : null}

            <div className="unsaved-dialog__actions">
              <Button type="button" variant="outline" onClick={handleClose} disabled={isExporting}>
                {t("common.cancel")}
              </Button>
              <Button
                type="button"
                onClick={() => void startExport()}
                disabled={!canExport || isExporting}
              >
                {isExporting ? t("exportDialog.exporting") : t("exportDialog.exportAction")}
              </Button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
