import { useEffect, useMemo, useRef, useState } from "react";
import { dirname, join } from "@tauri-apps/api/path";
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
import { setAiSuggestionsEmptyListener } from "@/lib/aiSuggestionWidget";
import { findStagedChange, normalizeVaultPath } from "@/lib/chat/vaultStaging";
import { useStagedChangesStore } from "@/store/useStagedChangesStore";
import type { BatchEntry, PendingFolderRename } from "@/components/FileTree";
import { useAppVersion } from "@/hooks/useAppVersion";
import { CHAT_MAX_WIDTH, CHAT_MIN_WIDTH, useChatWidth } from "@/hooks/useChatWidth";
import { useDeleteTarget } from "@/hooks/useDeleteTarget";
import { useExportTarget } from "@/hooks/useExportTarget";
import { useFolderWatcher } from "@/hooks/useFolderWatcher";
import { useGlobalShortcuts } from "@/hooks/useGlobalShortcuts";
import { useRagIndexAutoUpdate } from "@/hooks/useRagIndexAutoUpdate";
import {
  SIDEBAR_MAX_WIDTH,
  SIDEBAR_MIN_WIDTH,
  useSidebarWidth
} from "@/hooks/useSidebarWidth";
import { useStartupFolder } from "@/hooks/useStartupFolder";
import { useTitleRename } from "@/hooks/useTitleRename";
import { useUpdateCheck } from "@/hooks/useUpdateCheck";
import { useWebviewZoom } from "@/hooks/useWebviewZoom";
import { useWindowReveal } from "@/hooks/useWindowReveal";
import { useZenMode } from "@/hooks/useZenMode";
import { getFolderBasename, getRecentFolderPaths, getRelativeDisplayPath } from "@/lib/fileSystem";
import { clearVaultSearchCache } from "@/lib/ragSearch";
import { findStepIndex } from "@/lib/navigationHistory";
import { printMarkdown } from "@/lib/print";
import type { FileVersion } from "@/lib/fileVersions";
import type { VersionDiffTarget } from "@/components/VersionDiffDialog";
import {
  carriesExternalFiles,
  collectDroppedSources,
  type DropPayload
} from "@/lib/dragDrop/droppedSources";
import { sourceFromPath } from "@/lib/import/convert";
import { IMPORT_FILE_EXTENSIONS, type ImportSource } from "@/lib/import/importer";
import { cn } from "@/lib/utils";
import { useAppStore } from "@/store/useAppStore";
import type { Assistant } from "@/store/useAssistantsStore";
import { useAiSettingsStore } from "@/store/useAiSettingsStore";
import { useChatStore } from "@/store/useChatStore";
import { useRagEmbeddingStore } from "@/store/useRagEmbeddingStore";
import { useRagSettingsStore } from "@/store/useRagSettingsStore";
import { useEditorSettingsStore } from "@/store/useEditorSettingsStore";
import { useNavigationHistoryStore } from "@/store/useNavigationHistoryStore";
import { useShortcutsStore } from "@/store/useShortcutsStore";

import "./App.css";

function App() {
  const { t } = useTranslation();
  const [pendingNavigation, setPendingNavigation] = useState<
    { type: "file"; filePath: string } | { type: "folder"; folderPath: string | null } | null
  >(null);
  // Set right before a back/forward step so the history effect below moves the
  // position instead of recording the target as a new entry. Cleared once it is
  // consumed — or when the unsaved-changes dialog cancels the step.
  const navigationIntentRef = useRef<{ filePath: string; index: number } | null>(null);
  const [isUnsavedDialogOpen, setIsUnsavedDialogOpen] = useState(false);
  const [isAiSettingsOpen, setIsAiSettingsOpen] = useState(false);
  const [settingsInitialTab, setSettingsInitialTab] = useState<SettingsTab>("general");
  const [versionDiffTarget, setVersionDiffTarget] = useState<VersionDiffTarget | null>(null);
  const [isRestoringVersion, setIsRestoringVersion] = useState(false);
  // Wrapped in an object so "create new assistant" (assistant: null) is
  // distinguishable from "no edit in progress" (whole value null).
  const [assistantEditTarget, setAssistantEditTarget] = useState<{ assistant: Assistant | null } | null>(null);
  const [importFileList, setImportFileList] = useState<ImportSource[] | null>(null);
  const [importTargetFolder, setImportTargetFolder] = useState<string | null>(null);
  // What a dropped folder contributed beyond the importable files themselves.
  const [importSkippedCount, setImportSkippedCount] = useState(0);
  const [importLimitReached, setImportLimitReached] = useState(false);
  const [importInsertAfterBasename, setImportInsertAfterBasename] = useState<string | null | undefined>(
    undefined
  );
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
  const loadShortcutOverrides = useShortcutsStore((state) => state.loadOverrides);
  const aiSettings = useAiSettingsStore((state) => state.settings);
  const updateAiSettings = useAiSettingsStore((state) => state.updateSettings);
  const navigationHistory = useNavigationHistoryStore((state) => state.history);
  const isChatOpen = useChatStore((state) => state.isOpen);
  const chatView = useChatStore((state) => state.view);
  const setChatFolder = useChatStore((state) => state.setFolder);
  const loadRagSettings = useRagSettingsStore((state) => state.loadForFolder);
  const loadRagEmbeddingSettings = useRagEmbeddingStore((state) => state.load);

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

  // A note the agent has proposed into existence is not on disk either, but it
  // was never removed — it has not been applied yet. Without this it opens
  // under a warning saying the file is gone, which is both wrong and the
  // opposite of what is about to happen to it.
  const stagedChanges = useStagedChangesStore((state) => state.changes);
  const isSelectedFileStaged =
    selectedFilePath !== null &&
    folderPath !== null &&
    Boolean(
      findStagedChange(
        stagedChanges,
        normalizeVaultPath(getRelativeDisplayPath(folderPath, selectedFilePath))
      )
    );

  const isSelectedFileMissing =
    selectedFilePath !== null && !filePaths.includes(selectedFilePath) && !isSelectedFileStaged;

  const { sidebarWidth, isResizingSidebar, handleResizeStart, handleResizeKeyDown } =
    useSidebarWidth();
  const { chatWidth, isResizingChat, handleChatResizeStart, handleChatResizeKeyDown } =
    useChatWidth();

  const zenWidth = useEditorSettingsStore((state) => state.zenWidth);
  const { isZenMode, enterZenMode, exitZenMode, toggleZenMode } = useZenMode({
    canEnter: () => selectedFilePath !== null
  });

  useWebviewZoom();
  useWindowReveal();

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
    resolveOrderedRecords,
    closeExport
  } = useExportTarget();

  // Prints a file straight from the sidebar without opening it — reuses the
  // same "unsaved content wins" read as export so a dirty background tab
  // still prints its in-memory edits.
  const handlePrintFileRequest = (filePath: string) => {
    void readMarkdownForExport(filePath)
      .then((markdown) => printMarkdown(markdown, filePath))
      .catch((error: unknown) => {
        console.error("Print failed:", error);
      });
  };

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
      : (pendingNavigation.folderPath ? getFolderBasename(pendingNavigation.folderPath) : null) ??
        t("app.pendingTargetOtherFolder")
    : null;

  const openFolderSafely = async () => {
    if (selectedFilePath && (isDirty || isAiActionPending)) {
      setPendingNavigation({ type: "folder", folderPath: null });
      setIsUnsavedDialogOpen(true);
      return;
    }

    await openFolder();
  };

  const openRecentFolderSafely = async (targetFolderPath: string) => {
    if (selectedFilePath && (isDirty || isAiActionPending)) {
      setPendingNavigation({ type: "folder", folderPath: targetFolderPath });
      setIsUnsavedDialogOpen(true);
      return;
    }

    await openFolderAtPath(targetFolderPath);
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

    // A file the agent has only proposed is in the tree but not on disk; this
    // gives it an in-memory document so opening it shows the proposal instead
    // of a read error.
    useStagedChangesStore.getState().seedCreatedDocument(filePath);

    await selectFilePath(filePath);
  };

  // Opening a different vault has nothing to do with the previous one's
  // history. Declared before the recording effect below so that a folder switch
  // which immediately selects a file clears first and records afterwards.
  useEffect(() => {
    useNavigationHistoryStore.getState().reset();
  }, [folderPath]);

  // The single writer of the navigation history: whichever way a note ends up
  // open — sidebar, a link in the text, the backlinks panel, a search hit, a
  // freshly created file — it is recorded here exactly once. A back/forward
  // step announces itself through navigationIntentRef and only moves the
  // position instead of pushing a new entry.
  useEffect(() => {
    if (!selectedFilePath) {
      return;
    }

    const intent = navigationIntentRef.current;
    navigationIntentRef.current = null;

    if (intent && intent.filePath === selectedFilePath) {
      useNavigationHistoryStore.getState().goTo(intent.index);
      return;
    }

    useNavigationHistoryStore.getState().visit(selectedFilePath);
  }, [selectedFilePath]);

  const backStepIndex = useMemo(
    () => findStepIndex(navigationHistory, -1, filePaths),
    [navigationHistory, filePaths]
  );
  const forwardStepIndex = useMemo(
    () => findStepIndex(navigationHistory, 1, filePaths),
    [navigationHistory, filePaths]
  );

  const historyEntryLabel = (stepIndex: number | null) => {
    if (stepIndex === null) {
      return null;
    }

    const targetPath = navigationHistory.entries[stepIndex];

    return folderPath ? getRelativeDisplayPath(folderPath, targetPath) : targetPath;
  };

  const navigateHistory = (stepIndex: number | null) => {
    if (stepIndex === null) {
      return;
    }

    const targetPath = navigationHistory.entries[stepIndex];
    navigationIntentRef.current = { filePath: targetPath, index: stepIndex };
    void selectFilePathSafely(targetPath);
  };

  // Shared by "new file", "new folder" and "import": the new entry lands
  // directly after the tree's current selection — one level deeper (as the
  // first child) when a folder is selected, same level (directly after it)
  // when a file is selected. Falls back to appending at the vault root when
  // nothing or more than one entry is selected.
  const resolveNewEntryTarget = async (): Promise<{
    targetDirectory: string | null;
    insertAfterBasename: string | null | undefined;
  }> => {
    if (!folderPath) {
      return { targetDirectory: null, insertAfterBasename: undefined };
    }

    if (fileTreeSelection.length !== 1) {
      return { targetDirectory: folderPath, insertAfterBasename: undefined };
    }

    const [entry] = fileTreeSelection;

    if (entry.kind === "folder") {
      return { targetDirectory: await join(folderPath, entry.path), insertAfterBasename: null };
    }

    const basename = entry.path.replace(/\\/g, "/").split("/").pop() ?? "";

    return { targetDirectory: await dirname(entry.path), insertAfterBasename: basename };
  };

  const handleCreateFile = async (targetDirectory?: string) => {
    const resolved =
      targetDirectory !== undefined
        ? { targetDirectory, insertAfterBasename: undefined as string | null | undefined }
        : await resolveNewEntryTarget();
    const newFilePath = await createNewFile(resolved.targetDirectory ?? undefined, resolved.insertAfterBasename);

    if (newFilePath) {
      const fileName = newFilePath.replace(/\\/g, "/").split("/").pop() ?? "";
      startTitleRename(fileName.replace(/\.md$/i, ""), newFilePath);
    }
  };

  const handleCreateFolder = async () => {
    const { targetDirectory, insertAfterBasename } = await resolveNewEntryTarget();
    const newFolderPath = await createNewFolder(targetDirectory ?? undefined, insertAfterBasename);

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
      const { targetDirectory, insertAfterBasename } = await resolveNewEntryTarget();
      setImportTargetFolder(targetDirectory);
      setImportInsertAfterBasename(insertAfterBasename);
      setImportSkippedCount(0);
      setImportLimitReached(false);
      setImportFileList(selectedPaths.map((path) => ({ source: sourceFromPath(path) })));
    }
  };

  /**
   * Files and folders dragged onto the file tree from outside the app. The
   * folder they were dropped on decides where they land — dropping next to
   * nothing in particular targets the vault root.
   */
  const handleFilesDropped = (payload: DropPayload, targetDirectory: string) => {
    if (!folderPath) {
      return;
    }

    void (async () => {
      const collected = await collectDroppedSources(payload);
      const segments = targetDirectory.split("/").filter(Boolean);

      setImportTargetFolder(segments.length > 0 ? await join(folderPath, ...segments) : folderPath);
      // Imported notes go to the end of their folder rather than next to a row
      // that only happened to be under the pointer.
      setImportInsertAfterBasename(null);
      setImportSkippedCount(collected.skipped);
      setImportLimitReached(collected.limitReached);
      setImportFileList(collected.sources);
    })();
  };

  const handleImported = (createdFilePaths: string[]) => {
    if (!folderPath) {
      return;
    }

    const parentRelativePath = getRelativeDisplayPath(folderPath, importTargetFolder ?? folderPath);
    registerImportedFiles(createdFilePaths, parentRelativePath, importInsertAfterBasename);
  };

  const closeUnsavedDialog = () => {
    // Cancelling the dialog cancels the navigation, so a back/forward step
    // announced for it must not be applied to whatever is opened next.
    navigationIntentRef.current = null;
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

    // Saving/discarding *continues* the navigation, so a back/forward step
    // survives the dialog closing (which cancels one).
    const navigationIntent = navigationIntentRef.current;
    closeUnsavedDialog();
    navigationIntentRef.current = navigationIntent;

    if (nextNavigation.type === "file") {
      await selectFilePath(nextNavigation.filePath);
      return;
    }

    if (nextNavigation.folderPath) {
      await openFolderAtPath(nextNavigation.folderPath);
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

  // The knowledge base's own connection is app-wide like the AI settings, and
  // has to be in memory before the first lookup: its API key comes from the OS
  // credential store, and a search that starts before it arrives would fall
  // back to keyword search without saying why.
  useEffect(() => {
    void loadRagEmbeddingSettings();
  }, [loadRagEmbeddingSettings]);

  // Custom key bindings are app-wide (shortcuts.json in the app config dir),
  // so they are loaded once at startup rather than per opened folder.
  useEffect(() => {
    void loadShortcutOverrides();
  }, [loadShortcutOverrides]);

  // Chat sessions are vault-scoped (persisted into .scribedog/); reload them
  // whenever the opened folder changes.
  useEffect(() => {
    void setChatFolder(folderPath);
  }, [folderPath, setChatFolder]);

  // The agent's staged file changes and their undo checkpoints are vault-scoped
  // in the same way, and for the same reason: they name paths inside this
  // folder and mean nothing in the next one.
  useEffect(() => {
    void useStagedChangesStore.getState().setFolder(folderPath);
  }, [folderPath]);

  // The staging layer's marker for the open document has to go when its
  // proposals do — whether the user clicked accept/discard on a widget or the
  // chat settled them (see setAiSuggestionsEmptyListener).
  useEffect(() => {
    setAiSuggestionsEmptyListener(() => useStagedChangesStore.getState().clearEditorProposal());

    return () => setAiSuggestionsEmptyListener(null);
  }, []);

  // Same for the knowledge base's settings — which folders the AI may read is
  // consent given for one vault, and must never carry over to the next one.
  // Clearing the search cache alongside makes sure no passage of the previous
  // vault can still be returned.
  useEffect(() => {
    void loadRagSettings(folderPath);
    void clearVaultSearchCache();
  }, [folderPath, loadRagSettings]);

  // The chat agent's document tools (src/lib/chat/agentTools.ts) reach the
  // editor through this bridge rather than through props, since the store
  // that drives the agent loop has no path down into the editor component.
  useEffect(() => {
    registerEditorToolBridge({
      // The editor component is only mounted while a note is open, so its
      // handle is exactly the "is there a document" answer the agent needs.
      hasDocument: () => editorHandleRef.current !== null,
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

  // Safety net for files dropped anywhere no handler claims them: without it
  // the webview follows the drop and navigates the whole app away to the file,
  // which looks exactly like a crash. Handlers that took the drop have called
  // preventDefault by the time this window-level listener runs.
  useEffect(() => {
    const swallowDrop = (event: DragEvent) => {
      // Only drags from outside can navigate the app away, and leaving in-app
      // drags strictly untouched keeps this from interfering with the editor's
      // and the file tree's own drag handling.
      if (event.defaultPrevented || !carriesExternalFiles(event.dataTransfer)) {
        return;
      }

      event.preventDefault();

      if (event.type === "dragover" && event.dataTransfer) {
        event.dataTransfer.dropEffect = "none";
      }
    };

    window.addEventListener("dragover", swallowDrop);
    window.addEventListener("drop", swallowDrop);

    return () => {
      window.removeEventListener("dragover", swallowDrop);
      window.removeEventListener("drop", swallowDrop);
    };
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
  useRagIndexAutoUpdate();
  useGlobalShortcuts({
    selectedFilePath,
    saveSelectedFile,
    openFolderSafely,
    createFile: handleCreateFile,
    showShortcuts: () => {
      setSettingsInitialTab("shortcuts");
      setIsAiSettingsOpen(true);
    },
    toggleZenMode,
    navigateBack: () => navigateHistory(backStepIndex),
    navigateForward: () => navigateHistory(forwardStepIndex),
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
            recentFolderPaths={getRecentFolderPaths()}
            onOpenRecentFolder={(targetFolderPath) => void openRecentFolderSafely(targetFolderPath)}
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
            onPrintFileRequest={handlePrintFileRequest}
            onRenameFolder={renameFolderPath}
            onRenameFile={renameFilePath}
            onMoveEntry={moveTreeEntry}
            onSetSortMode={(mode) => void setSortMode(mode)}
            onAiSettingsRequest={() => {
              setSettingsInitialTab("general");
              setIsAiSettingsOpen(true);
            }}
            onRequestEditorFocus={() => setEditorFocusRequestId((id) => id + 1)}
            sidebarFocusRequestId={sidebarFocusRequestId}
            onFileTreeSelectionChange={setFileTreeSelection}
            fileTreeSelectionCount={fileTreeSelection.length}
            onFilesDropped={handleFilesDropped}
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
            backTargetLabel={historyEntryLabel(backStepIndex)}
            forwardTargetLabel={historyEntryLabel(forwardStepIndex)}
            onNavigateBack={() => navigateHistory(backStepIndex)}
            onNavigateForward={() => navigateHistory(forwardStepIndex)}
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
            onVersionDiffRequest={handleVersionDiffRequest}
            onVersionRestoreRequest={(version) => void handleVersionRestore(version)}
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
        deleteTarget={deleteTarget}
        deleteTargetLabel={deleteTargetLabel}
        isDeleting={isDeleting}
        onConfirmDelete={() => void confirmDeleteTarget()}
        onCancelDelete={cancelDeleteTarget}
        exportTarget={exportTarget}
        readMarkdownForExport={readMarkdownForExport}
        resolveOrderedExportRecords={resolveOrderedRecords}
        onCloseExport={closeExport}
        importFileList={importFileList}
        folderPath={folderPath}
        importTargetFolder={importTargetFolder}
        importSkippedCount={importSkippedCount}
        importLimitReached={importLimitReached}
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
