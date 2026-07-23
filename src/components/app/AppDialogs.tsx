import type { Update } from "@tauri-apps/plugin-updater";

import { AssistantEditDialog } from "@/components/AssistantEditDialog";
import { DeleteFileDialog } from "@/components/DeleteFileDialog";
import { ExportDialog, type ExportDialogTarget } from "@/components/ExportDialog";
import { ImportDialog } from "@/components/ImportDialog";
import { SettingsDialog } from "@/components/SettingsDialog";
import { ShortcutsDialog } from "@/components/ShortcutsDialog";
import { UnsavedChangesDialog } from "@/components/UnsavedChangesDialog";
import { UpdateNotification } from "@/components/UpdateNotification";
import type { DeleteTarget } from "@/hooks/useDeleteTarget";
import type { AiSettings } from "@/store/useAiSettingsStore";
import type { Assistant } from "@/store/useAssistantsStore";

type SettingsTab = "general" | "ai" | "assistants";

type AppDialogsProps = {
  // Unsaved-changes navigation prompt
  isUnsavedDialogOpen: boolean;
  pendingTargetLabel: string | null;
  selectedFileLabel: string | null;
  isSaving: boolean;
  isAiActionPending: boolean;
  onSaveNavigation: () => void;
  onDiscardNavigation: () => void;
  onCloseUnsavedDialog: () => void;

  // Settings
  isAiSettingsOpen: boolean;
  settingsInitialTab: SettingsTab;
  aiSettings: AiSettings;
  onSaveSettings: (nextSettings: Partial<AiSettings>) => void;
  onCloseSettings: () => void;
  onAssistantEditRequest: (assistant: Assistant | null) => void;

  // Assistant edit
  assistantEditTarget: { assistant: Assistant | null } | null;
  onCloseAssistantEdit: () => void;

  // Shortcuts
  isShortcutsOpen: boolean;
  onCloseShortcuts: () => void;

  // Delete
  deleteTarget: DeleteTarget | null;
  deleteTargetLabel: string | null;
  isDeleting: boolean;
  onConfirmDelete: () => void;
  onCancelDelete: () => void;

  // Export
  exportTarget: ExportDialogTarget | null;
  readMarkdownForExport: (filePath: string) => Promise<string>;
  onCloseExport: () => void;

  // Import
  importFileList: string[] | null;
  folderPath: string | null;
  onImported: (createdFilePaths: string[]) => void;
  onCloseImport: () => void;

  // Update
  availableUpdate: Update | null;
  onDismissUpdate: () => void;
};

export function AppDialogs({
  isUnsavedDialogOpen,
  pendingTargetLabel,
  selectedFileLabel,
  isSaving,
  isAiActionPending,
  onSaveNavigation,
  onDiscardNavigation,
  onCloseUnsavedDialog,
  isAiSettingsOpen,
  settingsInitialTab,
  aiSettings,
  onSaveSettings,
  onCloseSettings,
  onAssistantEditRequest,
  assistantEditTarget,
  onCloseAssistantEdit,
  isShortcutsOpen,
  onCloseShortcuts,
  deleteTarget,
  deleteTargetLabel,
  isDeleting,
  onConfirmDelete,
  onCancelDelete,
  exportTarget,
  readMarkdownForExport,
  onCloseExport,
  importFileList,
  folderPath,
  onImported,
  onCloseImport,
  availableUpdate,
  onDismissUpdate
}: AppDialogsProps) {
  return (
    <>
      <UnsavedChangesDialog
        open={isUnsavedDialogOpen}
        targetLabel={pendingTargetLabel}
        currentFileLabel={selectedFileLabel}
        isSaving={isSaving}
        hasPendingAiAction={isAiActionPending}
        onSave={onSaveNavigation}
        onDiscard={onDiscardNavigation}
        onCancel={onCloseUnsavedDialog}
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
      />

      <AssistantEditDialog
        open={assistantEditTarget !== null}
        assistant={assistantEditTarget?.assistant ?? null}
        onClose={onCloseAssistantEdit}
      />

      <ShortcutsDialog open={isShortcutsOpen} onClose={onCloseShortcuts} />

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
        onClose={onCloseExport}
      />

      <ImportDialog
        files={importFileList}
        vaultRoot={folderPath}
        onImported={onImported}
        onClose={onCloseImport}
      />

      {availableUpdate ? (
        <UpdateNotification update={availableUpdate} onDismiss={onDismissUpdate} />
      ) : null}
    </>
  );
}
