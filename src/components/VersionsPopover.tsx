import { useRef, useState } from "react";
import { createPortal } from "react-dom";

import { GitCompareArrows, History, RotateCcw } from "lucide-react";
import { useTranslation } from "react-i18next";

import { Button } from "@/components/ui/button";
import { getRelativeDisplayPath } from "@/lib/fileSystem";
import { listFileVersions, type FileVersion } from "@/lib/fileVersions";
import { formatAbsoluteTimestamp, formatRelativeTimestamp } from "@/lib/relativeTime";
import { useDismissablePopover } from "@/lib/useDismissablePopover";
import { usePopoverOverflowAlign } from "@/lib/usePopoverOverflowAlign";

type VersionsPopoverProps = {
  folderPath: string | null;
  selectedFilePath: string | null;
  onDiffRequest: (version: FileVersion) => void;
  onRestoreRequest: (version: FileVersion) => void;
};

/**
 * Lists the version history of the currently open file, newest first. The
 * list is read fresh every time the popover opens — saves create versions in
 * the background, so a cached list would go stale immediately.
 */
export function VersionsPopover({
  folderPath,
  selectedFilePath,
  onDiffRequest,
  onRestoreRequest
}: VersionsPopoverProps) {
  const { t, i18n } = useTranslation();
  const [anchor, setAnchor] = useState<{ top: number; left: number; right: number } | null>(null);
  const [align, setAlign] = useState<"left" | "right">("left");
  const [versions, setVersions] = useState<FileVersion[] | null>(null);
  const popoverRef = useRef<HTMLDivElement>(null);
  const requestIdRef = useRef(0);

  const isOpen = anchor !== null;
  const language = i18n.resolvedLanguage ?? i18n.language;

  const close = () => {
    requestIdRef.current += 1;
    setAnchor(null);
    setVersions(null);
  };

  useDismissablePopover(isOpen, close);
  usePopoverOverflowAlign(anchor, popoverRef, setAlign);

  const loadVersions = async () => {
    if (!folderPath || !selectedFilePath) {
      setVersions([]);
      return;
    }

    const requestId = ++requestIdRef.current;
    const loaded = await listFileVersions(
      folderPath,
      getRelativeDisplayPath(folderPath, selectedFilePath)
    ).catch(() => [] as FileVersion[]);

    if (requestIdRef.current === requestId) {
      setVersions(loaded);
    }
  };

  return (
    <>
      <Button
        type="button"
        variant="outline"
        size="sm"
        disabled={selectedFilePath === null}
        aria-label={t("versions.buttonLabel")}
        aria-expanded={isOpen}
        title={t("versions.buttonLabel")}
        onClick={(event) => {
          // Prevents the opening click from immediately reaching the window
          // listener in useDismissablePopover and closing the popover again.
          event.stopPropagation();

          if (isOpen) {
            close();
            return;
          }

          const rect = event.currentTarget.getBoundingClientRect();
          setAlign("left");
          setVersions(null);
          setAnchor({ top: rect.bottom + 6, left: rect.left, right: window.innerWidth - rect.right });
          void loadVersions();
        }}
      >
        <History />
      </Button>

      {anchor
        ? createPortal(
            <div
              ref={popoverRef}
              className="editor-popover versions-popover"
              role="dialog"
              aria-label={t("versions.popoverLabel")}
              style={
                align === "right"
                  ? { top: anchor.top, right: anchor.right }
                  : { top: anchor.top, left: anchor.left }
              }
              onClick={(event) => event.stopPropagation()}
            >
              <p className="versions-popover__title">{t("versions.popoverTitle")}</p>

              {versions === null ? (
                <p className="versions-popover__empty">{t("versions.loading")}</p>
              ) : versions.length === 0 ? (
                <p className="versions-popover__empty">{t("versions.empty")}</p>
              ) : (
                <ul className="versions-popover__list">
                  {versions.map((version) => (
                    <li key={version.id} className="versions-popover__item">
                      <span
                        className="versions-popover__timestamp"
                        title={formatAbsoluteTimestamp(version.createdAt, language)}
                      >
                        {formatRelativeTimestamp(version.createdAt, language)}
                      </span>
                      <span className="versions-popover__item-actions">
                        <button
                          type="button"
                          className="versions-popover__action"
                          aria-label={t("versions.showDiff")}
                          title={t("versions.showDiff")}
                          onClick={() => {
                            close();
                            onDiffRequest(version);
                          }}
                        >
                          <GitCompareArrows size={14} />
                        </button>
                        <button
                          type="button"
                          className="versions-popover__action"
                          aria-label={t("versions.restore")}
                          title={t("versions.restore")}
                          onClick={() => {
                            close();
                            onRestoreRequest(version);
                          }}
                        >
                          <RotateCcw size={14} />
                        </button>
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </div>,
            document.body
          )
        : null}
    </>
  );
}
