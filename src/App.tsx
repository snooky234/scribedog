import { useEffect, useMemo, useRef, useState } from "react";
import { open as openImportFilesDialog } from "@tauri-apps/plugin-dialog";
import { useTranslation } from "react-i18next";

import type { EditorHandle } from "@/components/Editor";
import { Sidebar } from "@/components/Sidebar";
import { AppDialogs } from "@/components/app/AppDialogs";
import { DocumentPanel } from "@/components/app/DocumentPanel";
import type { BatchEntry, PendingFolderRename } from "@/components/FileTree";
import { useAppVersion } from "@/hooks/useAppVersion";
import { useDeleteTarget } from "@/hooks/useDeleteTarget";
import { useExportTarget } from "@/hooks/useExportTarget";
import { useFolderWatcher } from "@/hooks/useFolderWatcher";
import { useGlobalShortcuts } from "@/hooks/useGlobalShortcuts";
import {
  SIDEBAR_MAX_WIDTH,
  SIDEBAR_MIN_WIDTH,
  useSidebarWidth
} from "@/hooks/useSidebarWidth";
import { useStartupFolder } from "@/hooks/useStartupFolder";
import { useTitleRename } from "@/hooks/useTitleRename";
import { useUpdateCheck } from "@/hooks/useUpdateCheck";
import { useWebviewZoom } from "@/hooks/useWebviewZoom";
import { getRelativeDisplayPath } from "@/lib/fileSystem";
import { IMPORT_FILE_EXTENSIONS } from "@/lib/import/importer";
import { cn } from "@/lib/utils";
import { useAppStore } from "@/store/useAppStore";
import type { Assistant } from "@/store/useAssistantsStore";
import { useAiSettingsStore } from "@/store/useAiSettingsStore";

import "./App.css";

function App() {
  const { t } = useTranslation();
  const [pendingNavigation, setPendingNavigation] = useState<
    { type: "file"; filePath: string } | { type: "folder" } | null
  >(null);
  const [isUnsavedDialogOpen, setIsUnsavedDialogOpen] = useState(false);
  const [isAiSettingsOpen, setIsAiSettingsOpen] = useState(false);
  const [settingsInitialTab, setSettingsInitialTab] = useState<"general" | "ai" | "assistants">("general");
  // Wrapped in an object so "create new assistant" (assistant: null) is
  // distinguishable from "no edit in progress" (whole value null).
  const [assistantEditTarget, setAssistantEditTarget] = useState<{ assistant: Assistant | null } | null>(null);
  const [isShortcutsOpen, setIsShortcutsOpen] = useState(false);
  const [importFileList, setImportFileList] = useState<string[] | null>(null);
  const [pendingFolderRename, setPendingFolderRename] = useState<PendingFolderRename | null>(
    null
  );
  const [editorFocusRequestId, setEditorFocusRequestId] = useState(0);
  const [sidebarFocusRequestId, setSidebarFocusRequestId] = useState(0);
  const [fileTreeSelection, setFileTreeSelection] = useState<BatchEntry[]>([]);
  const [isAiLoading, setIsAiLoading] = useState(false);
  const [isAiActionPending, setIsAiActionPending] = useState(false);
  const appVersion = useAppVersion();
  const editorHandleRef = useRef<EditorHandle | null>(null);
  const folderRenameRequestIdRef = useRef(0);

  const openFolder = useAppStore((state) => state.openFolder);
  const openFolderAtPath = useAppStore((state) => state.openFolderAtPath);
  const refreshFolderFiles = useAppStore((state) => state.refreshFolderFiles);
  const filePaths = useAppStore((state) => state.filePaths);
  const folderPath = useAppStore((state) => state.folderPath);
  const isLoading = useAppStore((state) => state.isLoading);
  const isFileLoading = useAppStore((state) => state.isFileLoading);
  const isSaving = useAppStore((state) => state.isSaving);
  const isDirty = useAppStore((state) => state.isDirty);
  const selectedFilePath = useAppStore((state) => state.selectedFilePath);
  const selectedFileContent = useAppStore((state) => state.selectedFileContent);
  const fileDocuments = useAppStore((state) => state.fileDocuments);
  const folderError = useAppStore((state) => state.folderError);
  const fileError = useAppStore((state) => state.fileError);
  const saveError = useAppStore((state) => state.saveError);
  const selectFilePath = useAppStore((state) => state.selectFilePath);
  const updateSelectedFileContent = useAppStore(
    (state) => state.updateSelectedFileContent
  );
  const discardSelectedFileChanges = useAppStore(
    (state) => state.discardSelectedFileChanges
  );
  const saveSelectedFile = useAppStore((state) => state.saveSelectedFile);
  const createNewFile = useAppStore((state) => state.createNewFile);
  const registerImportedFiles = useAppStore((state) => state.registerImportedFiles);
  const createNewFolder = useAppStore((state) => state.createNewFolder);
  const emptyFolderPaths = useAppStore((state) => state.emptyFolderPaths);
  const renameSelectedFile = useAppStore((state) => state.renameSelectedFile);
  const renameFilePath = useAppStore((state) => state.renameFilePath);
  const renameFolderPath = useAppStore((state) => state.renameFolderPath);
  const deleteFilePath = useAppStore((state) => state.deleteFilePath);
  const deleteFolderPath = useAppStore((state) => state.deleteFolderPath);
  const sortMode = useAppStore((state) => state.sortMode);
  const manualOrder = useAppStore((state) => state.manualOrder);
  const fileMtimeMs = useAppStore((state) => state.fileMtimeMs);
  const emptyFolderMtimeMs = useAppStore((state) => state.emptyFolderMtimeMs);
  const setSortMode = useAppStore((state) => state.setSortMode);
  const moveTreeEntry = useAppStore((state) => state.moveTreeEntry);
  const loadAiSettings = useAiSettingsStore((state) => state.loadSettings);
  const aiSettings = useAiSettingsStore((state) => state.settings);
  const updateAiSettings = useAiSettingsStore((state) => state.updateSettings);

  const dirtyFilePaths = useMemo(
    () =>
      Object.entries(fileDocuments)
        .filter(([, document]) => document.content !== document.baseContent)
        .map(([filePath]) => filePath),
    [fileDocuments]
  );

  const selectedFileLabel =
    folderPath && selectedFilePath
      ? getRelativeDisplayPath(folderPath, selectedFilePath)
      : null;

  const selectedFileDirectoryLabel = selectedFileLabel
    ? selectedFileLabel.slice(0, selectedFileLabel.lastIndexOf("/") + 1)
    : "";
  const selectedFileBaseName = selectedFileLabel
    ? selectedFileLabel
        .slice(selectedFileLabel.lastIndexOf("/") + 1)
        .replace(/\.md$/i, "")
    : "";

  const isSelectedFileMissing =
    selectedFilePath !== null && !filePaths.includes(selectedFilePath);

  const { sidebarWidth, isResizingSidebar, handleResizeStart, handleResizeKeyDown } =
    useSidebarWidth();

  useWebviewZoom();

  const { availableUpdate, dismissUpdate } = useUpdateCheck();

  const {
    isRenamingTitle,
    titleDraft,
    setTitleDraft,
    titleInputRef,
    startTitleRename,
    commitTitleRename,
    cancelTitleRename
  } = useTitleRename({ selectedFilePath, selectedFileBaseName, renameSelectedFile });

  const {
    deleteTarget,
    isDeleting,
    requestDeleteFile,
    requestDeleteFolder,
    requestDeleteMultiple,
    requestDeleteFromToolbar,
    cancelDeleteTarget,
    confirmDeleteTarget
  } = useDeleteTarget({
    folderPath,
    selectedFilePath,
    fileTreeSelection,
    deleteFilePath,
    deleteFolderPath
  });

  const {
    exportTarget,
    requestExportFile,
    requestExportFolder,
    requestExportMultiple,
    readMarkdownForExport,
    closeExport
  } = useExportTarget();

  const deleteTargetLabel =
    deleteTarget && deleteTarget.kind !== "multiple" && folderPath
      ? getRelativeDisplayPath(folderPath, deleteTarget.path)
      : deleteTarget && deleteTarget.kind !== "multiple"
        ? deleteTarget.path
        : null;

  const pendingTargetLabel = pendingNavigation
    ? pendingNavigation.type === "file"
      ? folderPath
        ? getRelativeDisplayPath(folderPath, pendingNavigation.filePath)
        : pendingNavigation.filePath
      : t("app.pendingTargetOtherFolder")
    : null;

  const openFolderSafely = async () => {
    if (selectedFilePath && (isDirty || isAiActionPending)) {
      setPendingNavigation({ type: "folder" });
      setIsUnsavedDialogOpen(true);
      return;
    }

    await openFolder();
  };

  const selectFilePathSafely = async (filePath: string) => {
    if (filePath === selectedFilePath) {
      return;
    }

    if (selectedFilePath && (isDirty || isAiActionPending)) {
      setPendingNavigation({ type: "file", filePath });
      setIsUnsavedDialogOpen(true);
      return;
    }

    await selectFilePath(filePath);
  };

  const handleCreateFile = async (targetDirectory?: string) => {
    const newFilePath = await createNewFile(targetDirectory);

    if (newFilePath) {
      const fileName = newFilePath.replace(/\\/g, "/").split("/").pop() ?? "";
      startTitleRename(fileName.replace(/\.md$/i, ""), newFilePath);
    }
  };

  const handleCreateFolder = async () => {
    const newFolderPath = await createNewFolder();

    if (newFolderPath) {
      folderRenameRequestIdRef.current += 1;
      setPendingFolderRename({
        folderPath: newFolderPath,
        requestId: folderRenameRequestIdRef.current
      });
    }
  };

  const requestImportFiles = async () => {
    const selected = await openImportFilesDialog({
      multiple: true,
      title: t("importDialog.chooseFilesTitle"),
      filters: [
        {
          name: t("importDialog.filterName"),
          extensions: [...IMPORT_FILE_EXTENSIONS]
        }
      ]
    });

    const selectedPaths =
      typeof selected === "string" ? [selected] : Array.isArray(selected) ? selected : [];

    if (selectedPaths.length > 0) {
      setImportFileList(selectedPaths);
    }
  };

  const handleImported = (createdFilePaths: string[]) => {
    registerImportedFiles(createdFilePaths);
  };

  const closeUnsavedDialog = () => {
    setPendingNavigation(null);
    setIsUnsavedDialogOpen(false);
  };

  const continuePendingNavigation = async (mode: "save" | "discard") => {
    const nextNavigation = pendingNavigation;

    if (!nextNavigation) {
      closeUnsavedDialog();
      return;
    }

    const shouldContinue =
      mode === "save" ? await saveSelectedFile() : discardSelectedFileChanges();

    if (!shouldContinue) {
      return;
    }

    closeUnsavedDialog();

    if (nextNavigation.type === "file") {
      await selectFilePath(nextNavigation.filePath);
      return;
    }

    await openFolder();
  };

  useEffect(() => {
    setIsAiLoading(false);
    setIsAiActionPending(false);
  }, [selectedFilePath]);

  useEffect(() => {
    void loadAiSettings();
  }, [loadAiSettings]);

  useStartupFolder(openFolderAtPath);
  useFolderWatcher(refreshFolderFiles);
  useGlobalShortcuts({
    selectedFilePath,
    saveSelectedFile,
    openFolderSafely,
    createFile: handleCreateFile,
    showShortcuts: () => setIsShortcutsOpen(true),
    editorHandleRef
  });

  return (
    <main className="app-shell" aria-label={t("app.shellLabel")}>
      <div className="workspace">
        <section
          className="workspace-grid"
          aria-label={t("app.workspaceLabel")}
          style={{ "--sidebar-width": `${sidebarWidth}px` } as React.CSSProperties}
        >
          <Sidebar
            folderPath={folderPath}
            filePaths={filePaths}
            emptyFolderPaths={emptyFolderPaths}
            selectedFilePath={selectedFilePath}
            dirtyFilePaths={dirtyFilePaths}
            folderError={folderError}
            isLoading={isLoading}
            pendingFolderRename={pendingFolderRename}
            sortMode={sortMode}
            manualOrder={manualOrder}
            fileMtimeMs={fileMtimeMs}
            emptyFolderMtimeMs={emptyFolderMtimeMs}
            onOpenFolder={openFolderSafely}
            onCreateFile={() => void handleCreateFile()}
            onCreateFileRequest={(targetDirectory) => void handleCreateFile(targetDirectory)}
            onCreateFolder={() => void handleCreateFolder()}
            onImportRequest={() => void requestImportFiles()}
            onSelectFilePath={selectFilePathSafely}
            onDeleteFileRequest={requestDeleteFile}
            onDeleteFolderRequest={requestDeleteFolder}
            onDeleteMultipleRequest={requestDeleteMultiple}
            onDeleteToolbarRequest={requestDeleteFromToolbar}
            onExportFileRequest={requestExportFile}
            onExportFolderRequest={requestExportFolder}
            onExportMultipleRequest={requestExportMultiple}
            onRenameFolder={renameFolderPath}
            onRenameFile={renameFilePath}
            onMoveEntry={moveTreeEntry}
            onSetSortMode={(mode) => void setSortMode(mode)}
            onAiSettingsRequest={() => {
              setSettingsInitialTab("general");
              setIsAiSettingsOpen(true);
            }}
            onShortcutsRequest={() => setIsShortcutsOpen(true)}
            onRequestEditorFocus={() => setEditorFocusRequestId((id) => id + 1)}
            sidebarFocusRequestId={sidebarFocusRequestId}
            onFileTreeSelectionChange={setFileTreeSelection}
            fileTreeSelectionCount={fileTreeSelection.length}
          />

          <div
            className={cn(
              "workspace-resizer",
              isResizingSidebar && "workspace-resizer--active"
            )}
            role="separator"
            aria-orientation="vertical"
            aria-label={t("app.sidebarResizeLabel")}
            aria-valuenow={sidebarWidth}
            aria-valuemin={SIDEBAR_MIN_WIDTH}
            aria-valuemax={SIDEBAR_MAX_WIDTH}
            tabIndex={0}
            onPointerDown={handleResizeStart}
            onKeyDown={handleResizeKeyDown}
          >
            <span className="workspace-resizer__grip" aria-hidden="true" />
          </div>

          <DocumentPanel
            selectedFilePath={selectedFilePath}
            selectedFileLabel={selectedFileLabel}
            selectedFileDirectoryLabel={selectedFileDirectoryLabel}
            folderPath={folderPath}
            selectedFileContent={selectedFileContent}
            appVersion={appVersion}
            isRenamingTitle={isRenamingTitle}
            titleDraft={titleDraft}
            titleInputRef={titleInputRef}
            onTitleDraftChange={setTitleDraft}
            onCommitTitleRename={() => void commitTitleRename()}
            onCancelTitleRename={cancelTitleRename}
            onStartTitleRename={() => startTitleRename(selectedFileBaseName, selectedFilePath)}
            isAiLoading={isAiLoading}
            isSaving={isSaving}
            isDirty={isDirty}
            isSelectedFileMissing={isSelectedFileMissing}
            isFileLoading={isFileLoading}
            fileError={fileError}
            saveError={saveError}
            editorHandleRef={editorHandleRef}
            editorFocusRequestId={editorFocusRequestId}
            onMarkdownChange={updateSelectedFileContent}
            onRequestSidebarFocus={() => setSidebarFocusRequestId((id) => id + 1)}
            onRequestFileOpen={(targetFilePath) => void selectFilePathSafely(targetFilePath)}
            onAiLoadingChange={setIsAiLoading}
            onAiPendingChange={setIsAiActionPending}
            onAiSettingsRequest={() => {
              setSettingsInitialTab("ai");
              setIsAiSettingsOpen(true);
            }}
            onAssistantSettingsRequest={() => {
              setSettingsInitialTab("assistants");
              setIsAiSettingsOpen(true);
            }}
          />
        </section>
      </div>

      <AppDialogs
        isUnsavedDialogOpen={isUnsavedDialogOpen}
        pendingTargetLabel={pendingTargetLabel}
        selectedFileLabel={selectedFileLabel}
        isSaving={isSaving}
        isAiActionPending={isAiActionPending}
        onSaveNavigation={() => void continuePendingNavigation("save")}
        onDiscardNavigation={() => void continuePendingNavigation("discard")}
        onCloseUnsavedDialog={closeUnsavedDialog}
        isAiSettingsOpen={isAiSettingsOpen}
        settingsInitialTab={settingsInitialTab}
        aiSettings={aiSettings}
        onSaveSettings={updateAiSettings}
        onCloseSettings={() => setIsAiSettingsOpen(false)}
        onAssistantEditRequest={(assistant) => {
          // Editing happens in its own modal; the settings dialog closes and
          // reopens on the assistants tab once editing is done.
          setIsAiSettingsOpen(false);
          setAssistantEditTarget({ assistant });
        }}
        assistantEditTarget={assistantEditTarget}
        onCloseAssistantEdit={() => {
          setAssistantEditTarget(null);
          setSettingsInitialTab("assistants");
          setIsAiSettingsOpen(true);
        }}
        isShortcutsOpen={isShortcutsOpen}
        onCloseShortcuts={() => setIsShortcutsOpen(false)}
        deleteTarget={deleteTarget}
        deleteTargetLabel={deleteTargetLabel}
        isDeleting={isDeleting}
        onConfirmDelete={() => void confirmDeleteTarget()}
        onCancelDelete={cancelDeleteTarget}
        exportTarget={exportTarget}
        readMarkdownForExport={readMarkdownForExport}
        onCloseExport={closeExport}
        importFileList={importFileList}
        folderPath={folderPath}
        onImported={handleImported}
        onCloseImport={() => setImportFileList(null)}
        availableUpdate={availableUpdate}
        onDismissUpdate={dismissUpdate}
      />
    </main>
  );
}

export default App;
