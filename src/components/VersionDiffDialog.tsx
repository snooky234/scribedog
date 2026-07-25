import { useEffect, useMemo, useState } from "react";
import { Columns2, Rows2 } from "lucide-react";
import { useTranslation } from "react-i18next";

import { Button } from "@/components/ui/button";
import type { FileVersion } from "@/lib/fileVersions";
import { readVersionContent } from "@/lib/fileVersions";
import { formatAbsoluteTimestamp, formatRelativeTimestamp } from "@/lib/relativeTime";
import {
  buildDiffHunks,
  countDiffStats,
  diffLines,
  toSideBySideRows,
  type DiffHunk
} from "@/lib/textDiff";

export type VersionDiffTarget = {
  version: FileVersion;
  fileLabel: string;
};

type DiffViewMode = "inline" | "sideBySide";

type VersionDiffDialogProps = {
  target: VersionDiffTarget | null;
  folderPath: string | null;
  /** The file content the version is compared against (what is in the editor now). */
  currentContent: string;
  isRestoring: boolean;
  onRestore: (version: FileVersion) => void;
  onClose: () => void;
};

function SkippedLines({ count }: { count: number }) {
  const { t } = useTranslation();

  if (count === 0) {
    return null;
  }

  return <div className="version-diff__skip">{t("versionDiff.skippedLines", { count })}</div>;
}

function InlineHunk({ hunk }: { hunk: DiffHunk }) {
  return (
    <>
      <SkippedLines count={hunk.skippedLines} />
      {hunk.ops.map((op, index) => (
        <div key={index} className={`version-diff__line version-diff__line--${op.type}`}>
          <span className="version-diff__gutter">{op.oldIndex === null ? "" : op.oldIndex + 1}</span>
          <span className="version-diff__gutter">{op.newIndex === null ? "" : op.newIndex + 1}</span>
          <span className="version-diff__marker" aria-hidden="true">
            {op.type === "add" ? "+" : op.type === "remove" ? "−" : " "}
          </span>
          <span className="version-diff__text">{op.text === "" ? " " : op.text}</span>
        </div>
      ))}
    </>
  );
}

function SideBySideHunk({ hunk }: { hunk: DiffHunk }) {
  const rows = useMemo(() => toSideBySideRows(hunk.ops), [hunk]);

  return (
    <>
      <SkippedLines count={hunk.skippedLines} />
      {rows.map((row, index) => (
        <div key={index} className="version-diff__row">
          <div
            className={`version-diff__side version-diff__side--${
              row.type === "add" ? "empty" : row.type === "equal" ? "equal" : "remove"
            }`}
          >
            <span className="version-diff__gutter">{row.left ? row.left.lineNumber : ""}</span>
            <span className="version-diff__text">
              {row.left ? (row.left.text === "" ? " " : row.left.text) : ""}
            </span>
          </div>
          <div
            className={`version-diff__side version-diff__side--${
              row.type === "remove" ? "empty" : row.type === "equal" ? "equal" : "add"
            }`}
          >
            <span className="version-diff__gutter">{row.right ? row.right.lineNumber : ""}</span>
            <span className="version-diff__text">
              {row.right ? (row.right.text === "" ? " " : row.right.text) : ""}
            </span>
          </div>
        </div>
      ))}
    </>
  );
}

/**
 * Line-based diff between a stored version and the current file content, on
 * the raw markdown source. Inline stacks the two sides, side-by-side puts the
 * old version left and the current content right.
 */
export function VersionDiffDialog({
  target,
  folderPath,
  currentContent,
  isRestoring,
  onRestore,
  onClose
}: VersionDiffDialogProps) {
  const { t, i18n } = useTranslation();
  const [viewMode, setViewMode] = useState<DiffViewMode>("inline");
  const [versionContent, setVersionContent] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  const language = i18n.resolvedLanguage ?? i18n.language;

  useEffect(() => {
    if (!target || !folderPath) {
      return;
    }

    let isCurrent = true;
    setVersionContent(null);
    setLoadError(null);

    void readVersionContent(folderPath, target.version.id)
      .then((content) => {
        if (isCurrent) {
          setVersionContent(content);
        }
      })
      .catch(() => {
        if (isCurrent) {
          setLoadError(t("versionDiff.loadError"));
        }
      });

    return () => {
      isCurrent = false;
    };
  }, [target, folderPath, t]);

  useEffect(() => {
    if (!target) {
      return;
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
      }
    };

    window.addEventListener("keydown", handleKeyDown);

    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [target, onClose]);

  const ops = useMemo(
    () => (versionContent === null ? [] : diffLines(versionContent, currentContent)),
    [versionContent, currentContent]
  );
  const hunks = useMemo(() => buildDiffHunks(ops), [ops]);
  const stats = useMemo(() => countDiffStats(ops), [ops]);

  if (!target) {
    return null;
  }

  return (
    <div className="ai-dialog" role="presentation" onClick={onClose}>
      <div
        className="ai-dialog__panel ai-dialog__panel--wide version-diff"
        role="dialog"
        aria-modal="true"
        aria-labelledby="version-diff-title"
        onClick={(event) => event.stopPropagation()}
      >
        <h3 id="version-diff-title">{t("versionDiff.title")}</h3>

        <div className="version-diff__header">
          <div className="version-diff__meta">
            <span className="version-diff__file">{target.fileLabel}</span>
            <span
              className="version-diff__timestamp"
              title={formatAbsoluteTimestamp(target.version.createdAt, language)}
            >
              {t("versionDiff.comparedWith", {
                timestamp: formatRelativeTimestamp(target.version.createdAt, language)
              })}
            </span>
            {versionContent !== null ? (
              <span className="version-diff__stats">
                <span className="version-diff__stat version-diff__stat--add">+{stats.added}</span>
                <span className="version-diff__stat version-diff__stat--remove">−{stats.removed}</span>
              </span>
            ) : null}
          </div>

          <div className="version-diff__modes" role="group" aria-label={t("versionDiff.viewMode")}>
            <button
              type="button"
              className={
                viewMode === "inline"
                  ? "version-diff__mode version-diff__mode--active"
                  : "version-diff__mode"
              }
              aria-pressed={viewMode === "inline"}
              onClick={() => setViewMode("inline")}
            >
              <Rows2 size={14} aria-hidden="true" />
              {t("versionDiff.inline")}
            </button>
            <button
              type="button"
              className={
                viewMode === "sideBySide"
                  ? "version-diff__mode version-diff__mode--active"
                  : "version-diff__mode"
              }
              aria-pressed={viewMode === "sideBySide"}
              onClick={() => setViewMode("sideBySide")}
            >
              <Columns2 size={14} aria-hidden="true" />
              {t("versionDiff.sideBySide")}
            </button>
          </div>
        </div>

        {viewMode === "sideBySide" && versionContent !== null && hunks.length > 0 ? (
          <div className="version-diff__legend">
            <span>{t("versionDiff.legendOld")}</span>
            <span>{t("versionDiff.legendCurrent")}</span>
          </div>
        ) : null}

        <div className={`version-diff__body version-diff__body--${viewMode}`}>
          {loadError ? (
            <p className="version-diff__message version-diff__message--error">{loadError}</p>
          ) : versionContent === null ? (
            <p className="version-diff__message">{t("versionDiff.loading")}</p>
          ) : hunks.length === 0 ? (
            <p className="version-diff__message">{t("versionDiff.identical")}</p>
          ) : viewMode === "inline" ? (
            hunks.map((hunk, index) => <InlineHunk key={index} hunk={hunk} />)
          ) : (
            hunks.map((hunk, index) => <SideBySideHunk key={index} hunk={hunk} />)
          )}
        </div>

        <div className="ai-dialog__actions">
          <Button type="button" variant="outline" onClick={onClose}>
            {t("common.close")}
          </Button>
          <Button
            type="button"
            disabled={isRestoring || versionContent === null}
            onClick={() => onRestore(target.version)}
          >
            {isRestoring ? t("versions.restoring") : t("versions.restore")}
          </Button>
        </div>
      </div>
    </div>
  );
}
