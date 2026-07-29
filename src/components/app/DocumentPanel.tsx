import type { RefObject } from "react";
import { ArrowLeft, ArrowRight, Pencil, Square } from "lucide-react";
import { useTranslation } from "react-i18next";

import { Button } from "@/components/ui/button";
import { Editor, type EditorHandle } from "@/components/Editor";
import { FindReplacePanel } from "@/components/FindReplacePanel";
import { VersionsPopover } from "@/components/VersionsPopover";
import type { FileVersion } from "@/lib/fileVersions";
import { cn } from "@/lib/utils";
import { useSearchStore } from "@/store/useSearchStore";
import { useVersioningSettingsStore } from "@/store/useVersioningSettingsStore";

type DocumentPanelProps = {
  selectedFilePath: string | null;
  selectedFileLabel: string | null;
  selectedFileDirectoryLabel: string;
  folderPath: string | null;
  selectedFileContent: string | null;
  appVersion: string | null;

  /** Vault-relative label of the note a back/forward step opens, null when there is none. */
  backTargetLabel: string | null;
  forwardTargetLabel: string | null;
  onNavigateBack: () => void;
  onNavigateForward: () => void;

  isRenamingTitle: boolean;
  titleDraft: string;
  titleInputRef: RefObject<HTMLInputElement | null>;
  onTitleDraftChange: (value: string) => void;
  onCommitTitleRename: () => void;
  onCancelTitleRename: () => void;
  onStartTitleRename: () => void;

  isAiLoading: boolean;
  isSaving: boolean;
  isDirty: boolean;
  isSelectedFileMissing: boolean;
  isFileLoading: boolean;
  fileError: string | null;
  saveError: string | null;

  editorHandleRef: RefObject<EditorHandle | null>;
  editorFocusRequestId: number;
  onMarkdownChange: (markdown: string) => void;
  onCanonicalMarkdown: (filePath: string, markdown: string) => void;
  onRequestSidebarFocus: () => void;
  onRequestFileOpen: (targetFilePath: string) => void;
  onAiLoadingChange: (isLoading: boolean) => void;
  onAiPendingChange: (isPending: boolean) => void;
  onAiSettingsRequest: () => void;
  onZenModeRequest: () => void;
  onVersionDiffRequest: (version: FileVersion) => void;
  onVersionRestoreRequest: (version: FileVersion) => void;
};

export function DocumentPanel({
  selectedFilePath,
  selectedFileLabel,
  selectedFileDirectoryLabel,
  folderPath,
  selectedFileContent,
  appVersion,
  backTargetLabel,
  forwardTargetLabel,
  onNavigateBack,
  onNavigateForward,
  isRenamingTitle,
  titleDraft,
  titleInputRef,
  onTitleDraftChange,
  onCommitTitleRename,
  onCancelTitleRename,
  onStartTitleRename,
  isAiLoading,
  isSaving,
  isDirty,
  isSelectedFileMissing,
  isFileLoading,
  fileError,
  saveError,
  editorHandleRef,
  editorFocusRequestId,
  onMarkdownChange,
  onCanonicalMarkdown,
  onRequestSidebarFocus,
  onRequestFileOpen,
  onAiLoadingChange,
  onAiPendingChange,
  onAiSettingsRequest,
  onZenModeRequest,
  onVersionDiffRequest,
  onVersionRestoreRequest
}: DocumentPanelProps) {
  const { t } = useTranslation();
  const versioningEnabled = useVersioningSettingsStore((state) => state.versioningEnabled);

  return (
    <section className="detail-panel" aria-label={t("app.documentAreaLabel")}>
      {selectedFilePath ? (
        <div className="detail-panel__card detail-panel__card--document">
          <div className="detail-panel__header">
            <div className="detail-panel__title">
              {/* Navigation across notes belongs to the document as a whole, so
                  it sits with the file name rather than in the format toolbar. */}
              <div className="detail-panel__history">
                <Button
                  type="button"
                  size="icon-sm"
                  variant="ghost"
                  disabled={backTargetLabel === null}
                  aria-label={t("app.navigateBack")}
                  title={
                    backTargetLabel
                      ? t("app.navigateBackTo", { fileLabel: backTargetLabel })
                      : t("app.navigateBack")
                  }
                  onClick={onNavigateBack}
                >
                  <ArrowLeft />
                </Button>
                <Button
                  type="button"
                  size="icon-sm"
                  variant="ghost"
                  disabled={forwardTargetLabel === null}
                  aria-label={t("app.navigateForward")}
                  title={
                    forwardTargetLabel
                      ? t("app.navigateForwardTo", { fileLabel: forwardTargetLabel })
                      : t("app.navigateForward")
                  }
                  onClick={onNavigateForward}
                >
                  <ArrowRight />
                </Button>
              </div>

              {isRenamingTitle ? (
                <h2 className="detail-panel__title-edit">
                  {selectedFileDirectoryLabel ? (
                    <span className="detail-panel__title-prefix">
                      {selectedFileDirectoryLabel}
                    </span>
                  ) : null}
                  <input
                    ref={titleInputRef}
                    className="detail-panel__title-input"
                    value={titleDraft}
                    onChange={(event) => onTitleDraftChange(event.target.value)}
                    onBlur={() => onCommitTitleRename()}
                    onKeyDown={(event) => {
                      if (event.key === "Enter") {
                        event.preventDefault();
                        onCommitTitleRename();
                      } else if (event.key === "Escape") {
                        event.preventDefault();
                        onCancelTitleRename();
                      }
                    }}
                    aria-label={t("app.fileNameLabel")}
                    spellCheck={false}
                  />
                  <span className="detail-panel__title-suffix">.md</span>
                </h2>
              ) : (
                <>
                  <h2>{selectedFileLabel}</h2>
                  <button
                    type="button"
                    className="detail-panel__title-edit-button"
                    onClick={onStartTitleRename}
                    aria-label={t("app.renameFile")}
                    title={t("app.renameFile")}
                  >
                    <Pencil size={14} />
                  </button>
                </>
              )}
            </div>
            <div className="detail-panel__status-group">
              {isAiLoading ? (
                <div className="detail-panel__ai-chip" aria-live="polite">
                  <span className="detail-panel__ai-chip-message">{t("app.aiRequestRunning")}</span>
                  <button
                    type="button"
                    className="detail-panel__ai-chip-cancel"
                    onClick={() => editorHandleRef.current?.cancelAiRequest()}
                    aria-label={t("app.aiRequestCancel")}
                    title={t("app.aiRequestCancel")}
                  >
                    <Square size={10} fill="currentColor" strokeWidth={0} />
                  </button>
                </div>
              ) : null}
              {versioningEnabled ? (
                <VersionsPopover
                  folderPath={folderPath}
                  selectedFilePath={selectedFilePath}
                  onDiffRequest={onVersionDiffRequest}
                  onRestoreRequest={onVersionRestoreRequest}
                />
              ) : null}
              <div
                className={cn(
                  "detail-panel__status",
                  isSaving && "detail-panel__status--saving",
                  isDirty && "detail-panel__status--dirty",
                  isSelectedFileMissing && "detail-panel__status--warning"
                )}
                aria-live="polite"
              >
                {isSaving
                  ? t("app.statusSaving")
                  : isSelectedFileMissing
                    ? t("app.statusFileRemoved")
                    : isDirty
                      ? t("app.statusUnsaved")
                      : t("app.statusSaved")}
              </div>
            </div>
          </div>

          <div className="detail-panel__body">
            {fileError || saveError ? (
              <div className="detail-panel__message detail-panel__message--error">
                {fileError ?? saveError}
              </div>
            ) : isFileLoading || selectedFileContent === null ? (
              <div className="detail-panel__message">
                {t("app.fileLoading")}
              </div>
            ) : (
              <Editor
                key={selectedFilePath}
                ref={editorHandleRef}
                markdown={selectedFileContent}
                onMarkdownChange={onMarkdownChange}
                onCanonicalMarkdown={onCanonicalMarkdown}
                folderPath={folderPath}
                filePath={selectedFilePath}
                editorFocusRequestId={editorFocusRequestId}
                onRequestSidebarFocus={onRequestSidebarFocus}
                onRequestFileOpen={onRequestFileOpen}
                onAiLoadingChange={onAiLoadingChange}
                onAiPendingChange={onAiPendingChange}
                onAiSettingsRequest={onAiSettingsRequest}
                onZenModeRequest={onZenModeRequest}
              />
            )}
          </div>
        </div>
      ) : (
        <div className="detail-panel__card detail-panel__card--empty">
          <p className="detail-panel__eyebrow">{t("app.emptyEyebrow")}</p>
          <h2>{t("app.emptyTitle")}</h2>
          {appVersion ? <p className="detail-panel__version">{t("app.version", { version: appVersion })}</p> : null}
        </div>
      )}
    </section>
  );
}
