import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { open as openFolderDialog } from "@tauri-apps/plugin-dialog";
import { FolderOpen } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  EXPORT_FORMATS,
  MERGED_EXPORT_FORMATS,
  exportFolderNotes,
  exportMergedNotes,
  exportMultipleNotes,
  exportSingleNote,
  getLastExportDirectory,
  getLastExportFormat,
  isMergedOnlyFormat,
  type ConflictResolution,
  type ExportFormat,
  type ExportOutcome,
  type ExportProgress,
  type MarkdownReader,
  type MultipleExportEntry
} from "@/lib/export/exporter";
import {
  DEFAULT_MANUSCRIPT_OPTIONS,
  MERGE_ONLY_OPTIONS,
  normalizeManuscriptOptions,
  type ChapterNumbering,
  type ChapterTitleSource,
  type ManuscriptOptions
} from "@/lib/export/manuscript";
import type { MarkdownFileRecord } from "@/lib/fileSystem";
import { readManuscriptSettings, writeManuscriptSettings } from "@/lib/vaultMeta";
import { useAppStore } from "@/store/useAppStore";
import { useEditorSettingsStore } from "@/store/useEditorSettingsStore";

/**
 * "standard" is the plain export — one file per note, or merged into one via
 * the checkbox. "manuscript" is the book compile: same engine, plus cover page
 * and chapter numbering, and always merged.
 */
export type ExportMode = "standard" | "manuscript";

export type ExportDialogTarget = (
  | { kind: "file"; sourcePath: string }
  | { kind: "folder"; sourcePath: string }
  | { kind: "multiple"; entries: MultipleExportEntry[] }
) & {
  defaultName: string;
  mode: ExportMode;
};

type ExportDialogProps = {
  target: ExportDialogTarget | null;
  readMarkdown: MarkdownReader;
  resolveOrderedRecords: (target: ExportDialogTarget) => MarkdownFileRecord[];
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
  html: "HTML",
  epub: "EPUB"
};

export function ExportDialog({
  target,
  readMarkdown,
  resolveOrderedRecords,
  onClose
}: ExportDialogProps) {
  const { t, i18n } = useTranslation();
  const folderPath = useAppStore((state) => state.folderPath);
  const fontId = useEditorSettingsStore((state) => state.fontId);
  const fontSizePt = useEditorSettingsStore((state) => state.fontSizePt);

  const [format, setFormat] = useState<ExportFormat>("pdf");
  const [name, setName] = useState("");
  const [targetDirectory, setTargetDirectory] = useState<string | null>(null);
  const [mergeIntoOneFile, setMergeIntoOneFile] = useState(false);
  const [manuscriptOptions, setManuscriptOptions] = useState<ManuscriptOptions>(
    DEFAULT_MANUSCRIPT_OPTIONS
  );
  const [phase, setPhase] = useState<DialogPhase>("form");
  const [progress, setProgress] = useState<ExportProgress | null>(null);
  const [conflict, setConflict] = useState<PendingConflict | null>(null);
  const [applyToAll, setApplyToAll] = useState(false);
  const [outcome, setOutcome] = useState<ExportOutcome | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const nameInputRef = useRef<HTMLInputElement>(null);

  const isOpen = target !== null;
  const isExporting = phase === "exporting";
  const isManuscript = target?.mode === "manuscript";
  const isFolder = target?.kind === "folder";
  const isMultiple = target?.kind === "multiple";
  const hasMultipleFiles = isFolder || isMultiple;
  // A manuscript is a book: always one file, no checkbox to get that wrong.
  const producesOneFile = isManuscript || mergeIntoOneFile || target?.kind === "file";
  const availableFormats = producesOneFile ? MERGED_EXPORT_FORMATS : EXPORT_FORMATS;

  // Re-initialize the form whenever the dialog opens for a new target.
  useEffect(() => {
    if (!target) {
      return;
    }

    const lastFormat = getLastExportFormat();
    const startsMerged = target.mode === "manuscript";

    setFormat(!startsMerged && isMergedOnlyFormat(lastFormat) ? "pdf" : lastFormat);
    setName(target.defaultName);
    setTargetDirectory(getLastExportDirectory());
    setMergeIntoOneFile(false);
    setPhase("form");
    setProgress(null);
    setConflict(null);
    setApplyToAll(false);
    setOutcome(null);
    setErrorMessage(null);

    const defaults: ManuscriptOptions = {
      ...DEFAULT_MANUSCRIPT_OPTIONS,
      // Translated here so the compiler itself stays free of i18n.
      chapterLabelTemplate: t("manuscript.chapterLabelTemplate"),
      title: target.defaultName
    };

    setManuscriptOptions(defaults);

    if (target.mode !== "manuscript" || !folderPath) {
      return;
    }

    let cancelled = false;

    void readManuscriptSettings(folderPath).then((stored) => {
      if (!cancelled) {
        setManuscriptOptions(normalizeManuscriptOptions(stored, defaults));
      }
    });

    return () => {
      cancelled = true;
    };
  }, [target, folderPath, t]);

  // Leaving merged mode strands EPUB, which only exists for a single document.
  useEffect(() => {
    if (!producesOneFile && isMergedOnlyFormat(format)) {
      setFormat("pdf");
    }
  }, [producesOneFile, format]);

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

  const updateManuscript = <Key extends keyof ManuscriptOptions>(
    key: Key,
    value: ManuscriptOptions[Key]
  ) => {
    setManuscriptOptions((current) => ({ ...current, [key]: value }));
  };

  const runExport = async (): Promise<ExportOutcome> => {
    if (!target || !targetDirectory) {
      return { exportedCount: 0, skippedCount: 0, cancelled: true };
    }

    const baseName = name.trim();

    // One document out: the manuscript compiler drives it either way. The
    // plain merge is the same call with every manuscript option switched off.
    if (producesOneFile && target.kind !== "file") {
      const records = resolveOrderedRecords(target);

      const result = await exportMergedNotes({
        records,
        format,
        targetDirectory,
        baseName,
        readMarkdown,
        onConflict: resolveConflict,
        onProgress: setProgress,
        manuscriptOptions: isManuscript
          ? manuscriptOptions
          : { ...MERGE_ONLY_OPTIONS, title: baseName },
        style: { fontId, fontSizePt },
        language: i18n.resolvedLanguage ?? i18n.language
      });

      if (isManuscript && folderPath && !result.cancelled) {
        void writeManuscriptSettings(folderPath, manuscriptOptions);
      }

      return result;
    }

    if (target.kind === "file") {
      // A single note is already one document; only the manuscript mode has
      // anything to add (cover page, chapter heading), and EPUB needs it.
      if (isManuscript || isMergedOnlyFormat(format)) {
        const records = resolveOrderedRecords(target);

        const result = await exportMergedNotes({
          records,
          format,
          targetDirectory,
          baseName,
          readMarkdown,
          onConflict: resolveConflict,
          onProgress: setProgress,
          manuscriptOptions: isManuscript
            ? manuscriptOptions
            : { ...MERGE_ONLY_OPTIONS, title: baseName },
          style: { fontId, fontSizePt },
          language: i18n.resolvedLanguage ?? i18n.language
        });

        if (isManuscript && folderPath && !result.cancelled) {
          void writeManuscriptSettings(folderPath, manuscriptOptions);
        }

        return result;
      }

      return exportSingleNote({
        markdownFilePath: target.sourcePath,
        format,
        targetDirectory,
        baseName,
        readMarkdown,
        onConflict: resolveConflict,
        style: { fontId, fontSizePt }
      });
    }

    if (target.kind === "folder") {
      return exportFolderNotes({
        sourceFolderPath: target.sourcePath,
        format,
        targetDirectory,
        folderName: baseName,
        readMarkdown,
        onConflict: resolveConflict,
        onProgress: setProgress,
        style: { fontId, fontSizePt }
      });
    }

    return exportMultipleNotes({
      entries: target.entries,
      format,
      targetDirectory,
      folderName: baseName,
      readMarkdown,
      onConflict: resolveConflict,
      onProgress: setProgress,
      style: { fontId, fontSizePt }
    });
  };

  const startExport = async () => {
    if (!target || !targetDirectory || !name.trim()) {
      return;
    }

    setPhase("exporting");
    setErrorMessage(null);

    try {
      const result = await runExport();

      if (result.cancelled) {
        onClose();
        return;
      }

      // A quiet single-file export needs no summary screen; multi-note exports
      // (and skipped files) get one so the user sees what happened.
      if ((target.kind === "file" || producesOneFile) && result.skippedCount === 0) {
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

  const canExport = Boolean(targetDirectory) && name.trim().length > 0;

  return (
    <div className="unsaved-dialog" role="presentation" onClick={handleClose}>
      <div
        className={`unsaved-dialog__panel export-dialog__panel${isManuscript ? " export-dialog__panel--wide" : ""}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby="export-dialog-title"
        onClick={(event) => event.stopPropagation()}
      >
        <p className="unsaved-dialog__eyebrow">
          {t(
            isManuscript
              ? "exportDialog.eyebrowManuscript"
              : isMultiple
                ? "exportDialog.eyebrowMultiple"
                : isFolder
                  ? "exportDialog.eyebrowFolder"
                  : "exportDialog.eyebrowFile"
          )}
        </p>
        <h3 id="export-dialog-title">
          {t(
            isManuscript
              ? "exportDialog.titleManuscript"
              : isMultiple
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

            {hasMultipleFiles && !producesOneFile ? (
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
              {hasMultipleFiles && !producesOneFile ? (
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
                isManuscript
                  ? "exportDialog.descriptionManuscript"
                  : isMultiple
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
                  {availableFormats.map((formatOption) => (
                    <option key={formatOption} value={formatOption}>
                      {FORMAT_LABELS[formatOption]}
                    </option>
                  ))}
                </select>
              </label>

              <label className="export-dialog__field">
                <span>
                  {t(
                    producesOneFile || !hasMultipleFiles
                      ? "exportDialog.fileNameLabel"
                      : "exportDialog.folderNameLabel"
                  )}
                </span>
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

              {hasMultipleFiles && !isManuscript ? (
                <label className="export-dialog__switch export-dialog__field--full">
                  <input
                    type="checkbox"
                    checked={mergeIntoOneFile}
                    disabled={isExporting}
                    onChange={(event) => setMergeIntoOneFile(event.target.checked)}
                  />
                  <span>
                    {t("exportDialog.mergeIntoOneFile")}
                    <span className="export-dialog__hint">{t("exportDialog.mergeHint")}</span>
                  </span>
                </label>
              ) : null}
            </div>

            {isManuscript ? (
              <ManuscriptFields
                options={manuscriptOptions}
                disabled={isExporting}
                onChange={updateManuscript}
              />
            ) : null}

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

type ManuscriptFieldsProps = {
  options: ManuscriptOptions;
  disabled: boolean;
  onChange: <Key extends keyof ManuscriptOptions>(key: Key, value: ManuscriptOptions[Key]) => void;
};

function ManuscriptFields({ options, disabled, onChange }: ManuscriptFieldsProps) {
  const { t } = useTranslation();

  return (
    <div className="export-dialog__manuscript">
      <h4 className="export-dialog__section-title">{t("manuscript.coverSection")}</h4>

      <div className="export-dialog__form export-dialog__form--grid">
        <label className="export-dialog__field export-dialog__field--full">
          <span>{t("manuscript.bookTitle")}</span>
          <input
            type="text"
            value={options.title}
            disabled={disabled}
            onChange={(event) => onChange("title", event.target.value)}
          />
        </label>

        <label className="export-dialog__field">
          <span>{t("manuscript.subtitle")}</span>
          <input
            type="text"
            value={options.subtitle}
            disabled={disabled}
            onChange={(event) => onChange("subtitle", event.target.value)}
          />
        </label>

        <label className="export-dialog__field">
          <span>{t("manuscript.author")}</span>
          <input
            type="text"
            value={options.author}
            disabled={disabled}
            onChange={(event) => onChange("author", event.target.value)}
          />
        </label>

        <label className="export-dialog__switch export-dialog__field--full">
          <input
            type="checkbox"
            checked={options.includeTitlePage}
            disabled={disabled}
            onChange={(event) => onChange("includeTitlePage", event.target.checked)}
          />
          <span>{t("manuscript.includeTitlePage")}</span>
        </label>
      </div>

      <h4 className="export-dialog__section-title">{t("manuscript.chaptersSection")}</h4>

      <div className="export-dialog__form export-dialog__form--grid">
        <label className="export-dialog__field">
          <span>{t("manuscript.numbering")}</span>
          <select
            value={options.numbering}
            disabled={disabled}
            onChange={(event) => onChange("numbering", event.target.value as ChapterNumbering)}
          >
            <option value="none">{t("manuscript.numberingNone")}</option>
            <option value="number">{t("manuscript.numberingNumber")}</option>
            <option value="label">{t("manuscript.numberingLabel")}</option>
          </select>
        </label>

        <label className="export-dialog__field">
          <span>{t("manuscript.titleSource")}</span>
          <select
            value={options.chapterTitleSource}
            disabled={disabled}
            onChange={(event) =>
              onChange("chapterTitleSource", event.target.value as ChapterTitleSource)
            }
          >
            <option value="heading">{t("manuscript.titleSourceHeading")}</option>
            <option value="fileName">{t("manuscript.titleSourceFileName")}</option>
          </select>
        </label>

        {options.numbering === "label" ? (
          <label className="export-dialog__field export-dialog__field--full">
            <span>{t("manuscript.labelTemplate")}</span>
            <input
              type="text"
              value={options.chapterLabelTemplate}
              disabled={disabled}
              onChange={(event) => onChange("chapterLabelTemplate", event.target.value)}
            />
            <span className="export-dialog__hint">{t("manuscript.labelTemplateHint")}</span>
          </label>
        ) : null}

        <label className="export-dialog__switch export-dialog__field--full">
          <input
            type="checkbox"
            checked={options.includeChapterHeadings}
            disabled={disabled}
            onChange={(event) => onChange("includeChapterHeadings", event.target.checked)}
          />
          <span>{t("manuscript.includeChapterHeadings")}</span>
        </label>

        <label className="export-dialog__switch export-dialog__field--full">
          <input
            type="checkbox"
            checked={options.pageBreakBetweenChapters}
            disabled={disabled}
            onChange={(event) => onChange("pageBreakBetweenChapters", event.target.checked)}
          />
          <span>{t("manuscript.pageBreakBetweenChapters")}</span>
        </label>
      </div>
    </div>
  );
}
