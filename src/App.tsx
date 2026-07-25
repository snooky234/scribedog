import { useEffect, useMemo, useRef, useState } from "react";
import { open as openImportFilesDialog } from "@tauri-apps/plugin-dialog";
import { useTranslation } from "react-i18next";

import type { EditorHandle } from "@/components/Editor";
import type { SettingsTab } from "@/components/SettingsDialog";
import { Sidebar } from "@/components/Sidebar";
import { AppDialogs } from "@/components/app/AppDialogs";
import { DocumentPanel } from "@/components/app/DocumentPanel";
import { ZenMode } from "@/components/app/ZenMode";
import { ChatPanel } from "@/components/chat/ChatPanel";
import { ChatSessionOverview } from "@/components/chat/ChatSessionOverview";
import { registerEditorToolBridge } from "@/lib/chat/agentTools";
import type { BatchEntry, PendingFolderRename } from "@/components/FileTree";
import { useAppVersion } from "@/hooks/useAppVersion";
import { CHAT_MAX_WIDTH, CHAT_MIN_WIDTH, useChatWidth } from "@/hooks/useChatWidth";
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
import { useZenMode } from "@/hooks/useZenMode";
import { getRelativeDisplayPath } from "@/lib/fileSystem";
import type { FileVersion } from "@/lib/fileVersions";
import type { VersionDiffTarget } from "@/components/VersionDiffDialog";
import { IMPORT_FILE_EXTENSIONS } from "@/lib/import/importer";
import { cn } from "@/lib/utils";
import { useAppStore } from "@/store/useAppStore";
import type { Assistant } from "@/store/useAssistantsStore";
import { useAiSettingsStore } from "@/store/useAiSettingsStore";
import { useChatStore } from "@/store/useChatStore";
import { useEditorSettingsStore } from "@/store/useEditorSettingsStore";

import "./App.css";

function App() {
  const { t } = useTranslation();
  const [pendingNavigation, setPendingNavigation] = useState<
    { type: "file"; filePath: string } | { type: "folder" } | null
  >(null);
  const [isUnsavedDialogOpen, setIsUnsavedDialogOpen] = useState(false);
  const [isAiSettingsOpen, setIsAiSettingsOpen] = useState(false);
  const [settingsInitialTab, setSettingsInitialTab] = useState<SettingsTab>("general");
  const [versionDiffTarget, setVersionDiffTarget] = useState<VersionDiffTarget | null>(null);
  const [isRestoringVersion, setIsRestoringVersion] = useState(false);
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
  const adoptCanonicalFileContent = useAppStore(
    (state) => state.adoptCanonicalFileContent
  );
  const discardSelectedFileChanges = useAppStore(
    (state) => state.discardSelectedFileChanges
  );
  const saveSelectedFile = useAppStore((state) => state.saveSelectedFile);
  const restoreFileVersion = useAppStore((state) => state.restoreFileVersion);
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
  const isChatOpen = useChatStore((state) => state.isOpen);
  const chatView = useChatStore((state) => state.view);
  const setChatFolder = useChatStore((state) => state.setFolder);

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
  const { chatWidth, isResizingChat, handleChatResizeStart, handleChatResizeKeyDown } =
    useChatWidth();

  const zenWidth = useEditorSettingsStore((state) => state.zenWidth);
  const { isZenMode, enterZenMode, exitZenMode } = useZenMode({
    canEnter: () => selectedFilePath !== null
  });

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

    // A selection belongs to the document it was made in. The editor pushes its
    // own selection changes into the chat store, but it cannot cover the two
    // cases handled here: a file switch remounts it with a fresh, empty
    // selection, and closing the file unmounts it entirely.
    useChatStore.getState().setEditorSelection("");
  }, [selectedFilePath]);

  useEffect(() => {
    void loadAiSettings();
  }, [loadAiSettings]);

  // Chat sessions are vault-scoped (persisted into .scribedog/); reload them
  // whenever the opened folder changes.
  useEffect(() => {
    void setChatFolder(folderPath);
  }, [folderPath, setChatFolder]);

  // The chat agent's document tools (src/lib/chat/agentTools.ts) reach the
  // editor through this bridge rather than through props, since the store
  // that drives the agent loop has no path down into the editor component.
  useEffect(() => {
    registerEditorToolBridge({
      getDocument: () => editorHandleRef.current?.getMarkdown() ?? "",
      getSelection: () => editorHandleRef.current?.getSelectionText() ?? "",
      listImageSources: () => editorHandleRef.current?.listImageSources() ?? [],
      listPendingProposals: () => editorHandleRef.current?.listPendingProposals() ?? [],
      acceptPendingProposals: () => editorHandleRef.current?.acceptPendingProposals() ?? 0,
      discardPendingProposals: () => editorHandleRef.current?.discardPendingProposals() ?? 0,
      proposeSelectionReplacement: (text) =>
        editorHandleRef.current?.proposeSelectionReplacement(text) ?? "failed",
      proposeInsertion: (text, anchorText) =>
        editorHandleRef.current?.proposeInsertion(text, anchorText) ?? "failed",
      proposePassageReplacement: (oldText, newText) =>
        editorHandleRef.current?.proposePassageReplacement(oldText, newText) ?? "failed",
      setImageWidth: (src, request) => editorHandleRef.current?.setImageWidth(src, request) ?? null
    });

    return () => registerEditorToolBridge(null);
  }, []);

  const handleVersionDiffRequest = (version: FileVersion) => {
    setVersionDiffTarget({ version, fileLabel: selectedFileLabel ?? "" });
  };

  const handleVersionRestore = async (version: FileVersion) => {
    setIsRestoringVersion(true);

    try {
      const restored = await restoreFileVersion(version.id);

      if (restored) {
        setVersionDiffTarget(null);
      }
    } finally {
      setIsRestoringVersion(false);
    }
  };

  // A diff open on one file must not survive switching to another — it would
  // compare a stored version against a document it never belonged to.
  useEffect(() => {
    setVersionDiffTarget(null);
  }, [selectedFilePath]);

  const openAssistantSettings = () => {
    setSettingsInitialTab("assistants");
    setIsAiSettingsOpen(true);
  };

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
    <main
      className={cn("app-shell", isZenMode && "app-shell--zen")}
      aria-label={t("app.shellLabel")}
      style={{ "--zen-width": `${zenWidth}px` } as React.CSSProperties}
    >
      <div className="workspace">
        <section
          className={cn(
            "workspace-grid",
            isZenMode && "workspace-grid--zen",
            isChatOpen && "workspace-grid--chat-open"
          )}
          aria-label={t("app.workspaceLabel")}
          style={
            {
              "--sidebar-width": `${sidebarWidth}px`,
              "--chat-width": `${chatWidth}px`
            } as React.CSSProperties
          }
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
            onVersionDiffRequest={handleVersionDiffRequest}
            onVersionRestoreRequest={(version) => void handleVersionRestore(version)}
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
            onCanonicalMarkdown={adoptCanonicalFileContent}
            onRequestSidebarFocus={() => setSidebarFocusRequestId((id) => id + 1)}
            onRequestFileOpen={(targetFilePath) => void selectFilePathSafely(targetFilePath)}
            onAiLoadingChange={setIsAiLoading}
            onAiPendingChange={setIsAiActionPending}
            onAiSettingsRequest={() => {
              setSettingsInitialTab("ai");
              setIsAiSettingsOpen(true);
            }}
            onZenModeRequest={enterZenMode}
          />

          {isChatOpen ? (
            <div
              className={cn(
                "workspace-resizer",
                isResizingChat && "workspace-resizer--active"
              )}
              role="separator"
              aria-orientation="vertical"
              aria-label={t("app.chatResizeLabel")}
              aria-valuenow={chatWidth}
              aria-valuemin={CHAT_MIN_WIDTH}
              aria-valuemax={CHAT_MAX_WIDTH}
              tabIndex={0}
              onPointerDown={handleChatResizeStart}
              onKeyDown={handleChatResizeKeyDown}
            >
              <span className="workspace-resizer__grip" aria-hidden="true" />
            </div>
          ) : null}

          {isChatOpen ? (
            <aside className="chat-column" aria-label={t("chat.panelLabel")}>
              {chatView === "overview" ? (
                <ChatSessionOverview />
              ) : (
                <ChatPanel
                  canEditDocument={selectedFilePath !== null}
                  onAssistantSettingsRequest={openAssistantSettings}
                />
              )}
            </aside>
          ) : null}
        </section>
      </div>

      {isZenMode ? <ZenMode onExit={exitZenMode} isDirty={isDirty} /> : null}

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
        versionDiffTarget={versionDiffTarget}
        versionDiffCurrentContent={selectedFileContent ?? ""}
        isRestoringVersion={isRestoringVersion}
        onRestoreVersion={(version) => void handleVersionRestore(version)}
        onCloseVersionDiff={() => setVersionDiffTarget(null)}
      />
    </main>
  );
}

export default App;
