import type { AppUpdate } from "@/platform/types";

import { AssistantEditDialog } from "@/components/AssistantEditDialog";
import { DeleteFileDialog } from "@/components/DeleteFileDialog";
import { ExportDialog, type ExportDialogTarget } from "@/components/ExportDialog";
import type { MarkdownFileRecord } from "@/lib/fileSystem";
import { ImportDialog } from "@/components/ImportDialog";
import { MoveToDialog, type MoveRequest } from "@/components/MoveToDialog";
import { SaveConflictDialog } from "@/components/SaveConflictDialog";
import { SettingsDialog, type SettingsTab } from "@/components/SettingsDialog";
import { ThemeBuilderDialog } from "@/components/ThemeBuilderDialog";
import { UnsavedChangesDialog } from "@/components/UnsavedChangesDialog";
import { UpdateNotification } from "@/components/UpdateNotification";
import { VersionDiffDialog, type VersionDiffTarget } from "@/components/VersionDiffDialog";
import type { DeleteTarget } from "@/hooks/useDeleteTarget";
import type { FileVersion } from "@/lib/fileVersions";
import type { ImportSource } from "@/lib/import/importer";
import type { AiSettings } from "@/store/useAiSettingsStore";
import type { Assistant } from "@/store/useAssistantsStore";

type AppDialogsProps = {
  // Closing a dirty entry of the "In progress" list (hooks/useWorkingSetActions.ts)
  closingFileLabel: string | null;
  onSaveAndClose: () => void;
  onDiscardAndClose: () => void;
  onCancelClose: () => void;

  // A save whose changes overlap with someone else's (store: saveConflict);
  // the label is null while there is nothing to ask.
  saveConflictFileLabel: string | null;
  saveConflictCount: number;
  isSaving: boolean;
  onReviewConflict: () => void;
  onOverwriteConflict: () => void;
  onDismissConflict: () => void;

  // Settings
  isAiSettingsOpen: boolean;
  settingsInitialTab: SettingsTab;
  aiSettings: AiSettings;
  onSaveSettings: (nextSettings: Partial<AiSettings>) => void;
  onCloseSettings: () => void;
  onAssistantEditRequest: (assistant: Assistant | null) => void;
  onThemeBuilderRequest: () => void;

  // Theme builder
  isThemeBuilderOpen: boolean;
  onCloseThemeBuilder: () => void;

  // Assistant edit
  assistantEditTarget: { assistant: Assistant | null } | null;
  onCloseAssistantEdit: () => void;

  // Move to folder (tree context menu)
  moveRequest: MoveRequest | null;
  fileRelativePaths: string[];
  emptyFolderRelativePaths: string[];
  isMoving: boolean;
  onConfirmMove: (targetRelativePath: string) => void;
  onCancelMove: () => void;

  // Delete
  deleteTarget: DeleteTarget | null;
  deleteTargetLabel: string | null;
  isDeleting: boolean;
  onConfirmDelete: () => void;
  onCancelDelete: () => void;

  // Export
  exportTarget: ExportDialogTarget | null;
  readMarkdownForExport: (filePath: string) => Promise<string>;
  resolveOrderedExportRecords: (target: ExportDialogTarget) => MarkdownFileRecord[];
  onCloseExport: () => void;

  // Import
  importFileList: ImportSource[] | null;
  folderPath: string | null;
  importTargetFolder: string | null;
  importSkippedCount: number;
  importLimitReached: boolean;
  onImported: (createdFilePaths: string[]) => void;
  onCloseImport: () => void;

  // Update
  availableUpdate: AppUpdate | null;
  onDismissUpdate: () => void;

  // Version diff
  versionDiffTarget: VersionDiffTarget | null;
  versionDiffCurrentContent: string;
  isRestoringVersion: boolean;
  onRestoreVersion: (version: FileVersion) => void;
  onCloseVersionDiff: () => void;
};

export function AppDialogs({
  closingFileLabel,
  onSaveAndClose,
  onDiscardAndClose,
  onCancelClose,
  saveConflictFileLabel,
  saveConflictCount,
  isSaving,
  onReviewConflict,
  onOverwriteConflict,
  onDismissConflict,
  isAiSettingsOpen,
  settingsInitialTab,
  aiSettings,
  onSaveSettings,
  onCloseSettings,
  onAssistantEditRequest,
  onThemeBuilderRequest,
  isThemeBuilderOpen,
  onCloseThemeBuilder,
  assistantEditTarget,
  onCloseAssistantEdit,
  moveRequest,
  fileRelativePaths,
  emptyFolderRelativePaths,
  isMoving,
  onConfirmMove,
  onCancelMove,
  deleteTarget,
  deleteTargetLabel,
  isDeleting,
  onConfirmDelete,
  onCancelDelete,
  exportTarget,
  readMarkdownForExport,
  resolveOrderedExportRecords,
  onCloseExport,
  importFileList,
  folderPath,
  importTargetFolder,
  importSkippedCount,
  importLimitReached,
  onImported,
  onCloseImport,
  availableUpdate,
  onDismissUpdate,
  versionDiffTarget,
  versionDiffCurrentContent,
  isRestoringVersion,
  onRestoreVersion,
  onCloseVersionDiff
}: AppDialogsProps) {
  return (
    <>
      <UnsavedChangesDialog
        open={closingFileLabel !== null}
        fileLabel={closingFileLabel}
        isSaving={isSaving}
        onSave={onSaveAndClose}
        onDiscard={onDiscardAndClose}
        onCancel={onCancelClose}
      />

      <SaveConflictDialog
        open={saveConflictFileLabel !== null}
        fileLabel={saveConflictFileLabel}
        conflicts={saveConflictCount}
        isSaving={isSaving}
        onReview={onReviewConflict}
        onOverwrite={onOverwriteConflict}
        onCancel={onDismissConflict}
      />

      <SettingsDialog
        open={isAiSettingsOpen}
        initialTab={settingsInitialTab}
        settings={aiSettings}
        onSave={(nextSettings) => {
          onSaveSettings(nextSettings);
          onCloseSettings();
        }}
        onClose={onCloseSettings}
        onAssistantEditRequest={onAssistantEditRequest}
        onThemeBuilderRequest={onThemeBuilderRequest}
      />

      <ThemeBuilderDialog open={isThemeBuilderOpen} onClose={onCloseThemeBuilder} />

      <AssistantEditDialog
        open={assistantEditTarget !== null}
        assistant={assistantEditTarget?.assistant ?? null}
        onClose={onCloseAssistantEdit}
      />

      <MoveToDialog
        request={moveRequest}
        fileRelativePaths={fileRelativePaths}
        emptyFolderRelativePaths={emptyFolderRelativePaths}
        isMoving={isMoving}
        onConfirm={onConfirmMove}
        onCancel={onCancelMove}
      />

      <DeleteFileDialog
        open={deleteTarget !== null}
        kind={deleteTarget && deleteTarget.kind !== "multiple" ? deleteTarget.kind : "file"}
        fileLabel={deleteTargetLabel}
        count={deleteTarget?.kind === "multiple" ? deleteTarget.paths.length : undefined}
        isDeleting={isDeleting}
        onConfirm={onConfirmDelete}
        onCancel={onCancelDelete}
      />

      <ExportDialog
        target={exportTarget}
        readMarkdown={readMarkdownForExport}
        resolveOrderedRecords={resolveOrderedExportRecords}
        onClose={onCloseExport}
      />

      <ImportDialog
        files={importFileList}
        vaultRoot={folderPath}
        targetFolder={importTargetFolder}
        skippedCount={importSkippedCount}
        limitReached={importLimitReached}
        onImported={onImported}
        onClose={onCloseImport}
      />

      <VersionDiffDialog
        target={versionDiffTarget}
        folderPath={folderPath}
        currentContent={versionDiffCurrentContent}
        isRestoring={isRestoringVersion}
        onRestore={onRestoreVersion}
        onClose={onCloseVersionDiff}
      />

      {availableUpdate ? (
        <UpdateNotification update={availableUpdate} onDismiss={onDismissUpdate} />
      ) : null}
    </>
  );
}
