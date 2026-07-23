import type { RefObject } from "react";
import { Pencil, Square } from "lucide-react";
import { useTranslation } from "react-i18next";

import { Editor, type EditorHandle } from "@/components/Editor";
import { cn } from "@/lib/utils";

type DocumentPanelProps = {
  selectedFilePath: string | null;
  selectedFileLabel: string | null;
  selectedFileDirectoryLabel: string;
  folderPath: string | null;
  selectedFileContent: string | null;
  appVersion: string | null;

  isRenamingTitle: boolean;
  titleDraft: string;
  titleInputRef: RefObject<HTMLInputElement>;
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

  editorHandleRef: RefObject<EditorHandle>;
  editorFocusRequestId: number;
  onMarkdownChange: (markdown: string) => void;
  onRequestSidebarFocus: () => void;
  onRequestFileOpen: (targetFilePath: string) => void;
  onAiLoadingChange: (isLoading: boolean) => void;
  onAiPendingChange: (isPending: boolean) => void;
  onAiSettingsRequest: () => void;
  onAssistantSettingsRequest: () => void;
  onZenModeRequest: () => void;
};

export function DocumentPanel({
  selectedFilePath,
  selectedFileLabel,
  selectedFileDirectoryLabel,
  folderPath,
  selectedFileContent,
  appVersion,
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
  onRequestSidebarFocus,
  onRequestFileOpen,
  onAiLoadingChange,
  onAiPendingChange,
  onAiSettingsRequest,
  onAssistantSettingsRequest,
  onZenModeRequest
}: DocumentPanelProps) {
  const { t } = useTranslation();

  return (
    <section className="detail-panel" aria-label={t("app.documentAreaLabel")}>
      {selectedFilePath ? (
        <div className="detail-panel__card detail-panel__card--document">
          <div className="detail-panel__header">
            <div className="detail-panel__title">
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
                folderPath={folderPath}
                filePath={selectedFilePath}
                editorFocusRequestId={editorFocusRequestId}
                onRequestSidebarFocus={onRequestSidebarFocus}
                onRequestFileOpen={onRequestFileOpen}
                onAiLoadingChange={onAiLoadingChange}
                onAiPendingChange={onAiPendingChange}
                onAiSettingsRequest={onAiSettingsRequest}
                onAssistantSettingsRequest={onAssistantSettingsRequest}
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
