import { useEffect, useMemo, useRef, useState } from "react";
import { Pencil, Square } from "lucide-react";
import { listen } from "@tauri-apps/api/event";
import { open as openImportFilesDialog } from "@tauri-apps/plugin-dialog";
import { invoke } from "@tauri-apps/api/core";
import { check, type Update } from "@tauri-apps/plugin-updater";
import { useTranslation } from "react-i18next";

import { Editor, type EditorHandle } from "@/components/Editor";
import { SettingsDialog } from "@/components/SettingsDialog";
import { DeleteFileDialog } from "@/components/DeleteFileDialog";
import { ExportDialog, type ExportDialogTarget } from "@/components/ExportDialog";
import { ImportDialog } from "@/components/ImportDialog";
import { ShortcutsDialog } from "@/components/ShortcutsDialog";
import { UnsavedChangesDialog } from "@/components/UnsavedChangesDialog";
import { UpdateNotification } from "@/components/UpdateNotification";
import { Sidebar } from "@/components/Sidebar";
import type { PendingFolderRename } from "@/components/FileTree";
import { isWindowsPlatform } from "@/lib/platform";
import { useAppVersion } from "@/hooks/useAppVersion";
import { useUpdateSettingsStore } from "@/store/useUpdateSettingsStore";
import {
  FOLDER_FILES_CHANGED_EVENT,
  clearLastOpenedFolderPath,
  getLastOpenedFolderPath,
  getRelativeDisplayPath,
  readMarkdownFile
} from "@/lib/fileSystem";
import { getDefaultExportBaseName } from "@/lib/export/exporter";
import { IMPORT_FILE_EXTENSIONS } from "@/lib/import/importer";
import { cn } from "@/lib/utils";
import { useAppStore } from "@/store/useAppStore";
import { useAiSettingsStore } from "@/store/useAiSettingsStore";

import "./App.css";

const SIDEBAR_WIDTH_STORAGE_KEY = "scribedog-sidebar-width";
const MIN_SIDEBAR_WIDTH = 220;
const MAX_SIDEBAR_WIDTH = 560;
const DEFAULT_SIDEBAR_WIDTH = 320;
const SIDEBAR_KEYBOARD_STEP = 16;

function clampSidebarWidth(width: number): number {
  return Math.min(MAX_SIDEBAR_WIDTH, Math.max(MIN_SIDEBAR_WIDTH, width));
}

function getInitialSidebarWidth(): number {
  try {
    const stored = window.localStorage.getItem(SIDEBAR_WIDTH_STORAGE_KEY);
    const parsed = stored ? Number(stored) : NaN;

    if (!Number.isNaN(parsed)) {
      return clampSidebarWidth(parsed);
    }
  } catch {
    // localStorage may be unavailable in some environments.
  }

  return DEFAULT_SIDEBAR_WIDTH;
}

function persistSidebarWidth(width: number): void {
  try {
    window.localStorage.setItem(SIDEBAR_WIDTH_STORAGE_KEY, String(width));
  } catch {
    // localStorage may be unavailable in some environments.
  }
}

function App() {
  const { t } = useTranslation();
  const [pendingNavigation, setPendingNavigation] = useState<
    { type: "file"; filePath: string } | { type: "folder" } | null
  >(null);
  const [isUnsavedDialogOpen, setIsUnsavedDialogOpen] = useState(false);
  const [isAiSettingsOpen, setIsAiSettingsOpen] = useState(false);
  const [settingsInitialTab, setSettingsInitialTab] = useState<"general" | "ai">("general");
  const [isShortcutsOpen, setIsShortcutsOpen] = useState(false);
  const [isRenamingTitle, setIsRenamingTitle] = useState(false);
  const [titleDraft, setTitleDraft] = useState("");
  const [renameSessionId, setRenameSessionId] = useState(0);
  const [deleteTarget, setDeleteTarget] = useState<
    | { kind: "file" | "folder"; path: string }
    | { kind: "multiple"; paths: Array<{ kind: "file" | "folder"; path: string }> }
    | null
  >(null);
  const [isDeleting, setIsDeleting] = useState(false);
  const [exportTarget, setExportTarget] = useState<ExportDialogTarget | null>(null);
  const [importFileList, setImportFileList] = useState<string[] | null>(null);
  const [pendingFolderRename, setPendingFolderRename] = useState<PendingFolderRename | null>(
    null
  );
  const [editorFocusRequestId, setEditorFocusRequestId] = useState(0);
  const [sidebarFocusRequestId, setSidebarFocusRequestId] = useState(0);
  const [isAiLoading, setIsAiLoading] = useState(false);
  const [isAiActionPending, setIsAiActionPending] = useState(false);
  const [sidebarWidth, setSidebarWidth] = useState<number>(getInitialSidebarWidth);
  const [isResizingSidebar, setIsResizingSidebar] = useState(false);
  const [availableUpdate, setAvailableUpdate] = useState<Update | null>(null);
  const checkForUpdatesEnabled = useUpdateSettingsStore((state) => state.checkForUpdatesEnabled);
  const appVersion = useAppVersion();
  const skipRenameCommitRef = useRef(false);
  const renameTargetPathRef = useRef<string | null>(null);
  const titleInputRef = useRef<HTMLInputElement | null>(null);
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

  const startTitleRename = (initialDraft: string, targetFilePath: string | null) => {
    skipRenameCommitRef.current = false;
    renameTargetPathRef.current = targetFilePath;
    setTitleDraft(initialDraft);
    setIsRenamingTitle(true);
    setRenameSessionId((id) => id + 1);
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

  const commitTitleRename = async () => {
    if (skipRenameCommitRef.current) {
      return;
    }

    skipRenameCommitRef.current = true;

    if (titleDraft.trim() === selectedFileBaseName || titleDraft.trim() === "") {
      setIsRenamingTitle(false);
      return;
    }

    const didRename = await renameSelectedFile(titleDraft);

    if (didRename) {
      setIsRenamingTitle(false);
    } else {
      skipRenameCommitRef.current = false;
      titleInputRef.current?.focus();
    }
  };

  const cancelTitleRename = () => {
    skipRenameCommitRef.current = true;
    setIsRenamingTitle(false);
  };

  const requestDeleteFile = (filePath: string) => {
    setDeleteTarget({ kind: "file", path: filePath });
  };

  const requestDeleteFolder = (folderPath: string) => {
    setDeleteTarget({ kind: "folder", path: folderPath });
  };

  const requestDeleteMultiple = (paths: Array<{ kind: "file" | "folder"; path: string }>) => {
    if (paths.length === 0) {
      return;
    }

    if (paths.length === 1) {
      setDeleteTarget(paths[0]);
      return;
    }

    setDeleteTarget({ kind: "multiple", paths });
  };

  const requestExportFile = (filePath: string) => {
    setExportTarget({
      kind: "file",
      sourcePath: filePath,
      defaultName: getDefaultExportBaseName(filePath)
    });
  };

  const requestExportFolder = (exportFolderPath: string) => {
    setExportTarget({
      kind: "folder",
      sourcePath: exportFolderPath,
      defaultName: getDefaultExportBaseName(exportFolderPath)
    });
  };

  const requestExportMultiple = (entries: Array<{ kind: "file" | "folder"; path: string }>) => {
    if (entries.length === 0) {
      return;
    }

    if (entries.length === 1) {
      const [entry] = entries;

      if (entry.kind === "file") {
        requestExportFile(entry.path);
      } else {
        requestExportFolder(entry.path);
      }

      return;
    }

    setExportTarget({
      kind: "multiple",
      entries,
      defaultName: t("exportDialog.defaultMultipleName")
    });
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

  // Prefers unsaved in-memory content over the on-disk state, so an export
  // always matches what the user currently sees in the editor.
  const readMarkdownForExport = async (filePath: string): Promise<string> => {
    const document = useAppStore.getState().fileDocuments[filePath];
    return document ? document.content : readMarkdownFile(filePath);
  };

  const cancelDeleteTarget = () => {
    if (isDeleting) {
      return;
    }

    setDeleteTarget(null);
  };

  const confirmDeleteTarget = async () => {
    if (!deleteTarget) {
      return;
    }

    setIsDeleting(true);

    if (deleteTarget.kind === "multiple") {
      // Sequential: each store call reads fresh state via get(), so parallel
      // calls would clobber each other's writes.
      for (const entry of deleteTarget.paths) {
        await (entry.kind === "file" ? deleteFilePath(entry.path) : deleteFolderPath(entry.path));
      }

      setIsDeleting(false);
      setDeleteTarget(null);
      return;
    }

    const didDelete =
      deleteTarget.kind === "file"
        ? await deleteFilePath(deleteTarget.path)
        : await deleteFolderPath(deleteTarget.path);
    setIsDeleting(false);

    if (didDelete) {
      setDeleteTarget(null);
    }
  };

  useEffect(() => {
    if (selectedFilePath !== renameTargetPathRef.current) {
      setIsRenamingTitle(false);
      skipRenameCommitRef.current = false;
    }
  }, [selectedFilePath]);

  useEffect(() => {
    setIsAiLoading(false);
    setIsAiActionPending(false);
  }, [selectedFilePath]);

  useEffect(() => {
    if (isRenamingTitle) {
      titleInputRef.current?.focus();
      titleInputRef.current?.select();
    }
    // renameSessionId ensures focus/selection are reset even when a new
    // rename starts while isRenamingTitle was already true from the previous
    // session (e.g. quickly creating another file before the old blur committed).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isRenamingTitle, renameSessionId]);

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
    const handleKeyDown = (event: KeyboardEvent) => {
      if (!(event.ctrlKey || event.metaKey)) {
        return;
      }

      const key = event.key.toLowerCase();

      if (key === "s") {
        event.preventDefault();

        if (selectedFilePath) {
          void saveSelectedFile();
        }

        return;
      }

      if (key === "o") {
        event.preventDefault();
        void openFolderSafely();
        return;
      }

      if (key === "n") {
        event.preventDefault();
        void handleCreateFile();
        return;
      }

      if (key === "p") {
        event.preventDefault();

        if (selectedFilePath) {
          editorHandleRef.current?.printDocument();
        }

        return;
      }

      if (key === "#" || event.code === "Backslash") {
        event.preventDefault();
        setIsShortcutsOpen(true);
      }
    };

    window.addEventListener("keydown", handleKeyDown);

    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [saveSelectedFile, selectedFilePath, openFolderSafely, handleCreateFile]);

  useEffect(() => {
    void loadAiSettings();
  }, [loadAiSettings]);

  useEffect(() => {
    let isActive = true;

    const loadStartupFolder = async () => {
      const startupFolderPath = await invoke<string | null>("get_startup_folder_path");
      const targetFolderPath = startupFolderPath ?? getLastOpenedFolderPath();

      if (!isActive || !targetFolderPath) {
        return;
      }

      const didOpenFolder = await openFolderAtPath(targetFolderPath);

      if (!didOpenFolder && !startupFolderPath) {
        clearLastOpenedFolderPath();
      }
    };

    void loadStartupFolder();

    return () => {
      isActive = false;
    };
  }, [openFolderAtPath]);

  useEffect(() => {
    if (!checkForUpdatesEnabled || !isWindowsPlatform()) {
      return;
    }

    let isActive = true;

    const checkForUpdates = async () => {
      try {
        const update = await check();

        if (isActive && update) {
          setAvailableUpdate(update);
        }
      } catch {
        // Update-Check darf den App-Start nicht blockieren.
      }
    };

    void checkForUpdates();

    return () => {
      isActive = false;
    };
  }, [checkForUpdatesEnabled]);

  useEffect(() => {
    let isMounted = true;
    let debounceHandle: number | undefined;
    let unlisten: (() => void) | null = null;

    const registerListener = async () => {
      const cleanup = await listen<string>(FOLDER_FILES_CHANGED_EVENT, (event) => {
        const currentFolderPath = useAppStore.getState().folderPath;

        if (!currentFolderPath || event.payload !== currentFolderPath) {
          return;
        }

        if (debounceHandle !== undefined) {
          window.clearTimeout(debounceHandle);
        }

        debounceHandle = window.setTimeout(() => {
          if (isMounted) {
            void refreshFolderFiles();
          }
        }, 150);
      });

      unlisten = cleanup;
    };

    void registerListener();

    return () => {
      isMounted = false;

      if (debounceHandle !== undefined) {
        window.clearTimeout(debounceHandle);
      }

      unlisten?.();
    };
  }, [refreshFolderFiles]);

  const handleSidebarResizeStart = (event: React.PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) {
      return;
    }

    event.preventDefault();
    const startX = event.clientX;
    const startWidth = sidebarWidth;
    setIsResizingSidebar(true);
    document.body.classList.add("is-resizing-sidebar");

    const handlePointerMove = (moveEvent: PointerEvent) => {
      setSidebarWidth(clampSidebarWidth(startWidth + (moveEvent.clientX - startX)));
    };

    const stopResizing = () => {
      setIsResizingSidebar(false);
      document.body.classList.remove("is-resizing-sidebar");
      setSidebarWidth((currentWidth) => {
        persistSidebarWidth(currentWidth);
        return currentWidth;
      });
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", stopResizing);
    };

    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", stopResizing);
  };

  const handleSidebarResizeKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "ArrowLeft") {
      event.preventDefault();
      setSidebarWidth((currentWidth) => {
        const nextWidth = clampSidebarWidth(currentWidth - SIDEBAR_KEYBOARD_STEP);
        persistSidebarWidth(nextWidth);
        return nextWidth;
      });
    } else if (event.key === "ArrowRight") {
      event.preventDefault();
      setSidebarWidth((currentWidth) => {
        const nextWidth = clampSidebarWidth(currentWidth + SIDEBAR_KEYBOARD_STEP);
        persistSidebarWidth(nextWidth);
        return nextWidth;
      });
    }
  };

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
            aria-valuemin={MIN_SIDEBAR_WIDTH}
            aria-valuemax={MAX_SIDEBAR_WIDTH}
            tabIndex={0}
            onPointerDown={handleSidebarResizeStart}
            onKeyDown={handleSidebarResizeKeyDown}
          >
            <span className="workspace-resizer__grip" aria-hidden="true" />
          </div>

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
                          onChange={(event) => setTitleDraft(event.target.value)}
                          onBlur={() => void commitTitleRename()}
                          onKeyDown={(event) => {
                            if (event.key === "Enter") {
                              event.preventDefault();
                              void commitTitleRename();
                            } else if (event.key === "Escape") {
                              event.preventDefault();
                              cancelTitleRename();
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
                          onClick={() =>
                            startTitleRename(selectedFileBaseName, selectedFilePath)
                          }
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
                      onMarkdownChange={updateSelectedFileContent}
                      folderPath={folderPath}
                      filePath={selectedFilePath}
                      editorFocusRequestId={editorFocusRequestId}
                      onRequestSidebarFocus={() => setSidebarFocusRequestId((id) => id + 1)}
                      onAiLoadingChange={setIsAiLoading}
                      onAiPendingChange={setIsAiActionPending}
                      onAiSettingsRequest={() => {
                        setSettingsInitialTab("ai");
                        setIsAiSettingsOpen(true);
                      }}
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
        </section>
      </div>

      <UnsavedChangesDialog
        open={isUnsavedDialogOpen}
        targetLabel={pendingTargetLabel}
        currentFileLabel={selectedFileLabel}
        isSaving={isSaving}
        hasPendingAiAction={isAiActionPending}
        onSave={() => void continuePendingNavigation("save")}
        onDiscard={() => void continuePendingNavigation("discard")}
        onCancel={closeUnsavedDialog}
      />

      <SettingsDialog
        open={isAiSettingsOpen}
        initialTab={settingsInitialTab}
        settings={aiSettings}
        onSave={(nextSettings) => {
          updateAiSettings(nextSettings);
          setIsAiSettingsOpen(false);
        }}
        onClose={() => setIsAiSettingsOpen(false)}
      />

      <ShortcutsDialog open={isShortcutsOpen} onClose={() => setIsShortcutsOpen(false)} />

      <DeleteFileDialog
        open={deleteTarget !== null}
        kind={deleteTarget && deleteTarget.kind !== "multiple" ? deleteTarget.kind : "file"}
        fileLabel={deleteTargetLabel}
        count={deleteTarget?.kind === "multiple" ? deleteTarget.paths.length : undefined}
        isDeleting={isDeleting}
        onConfirm={() => void confirmDeleteTarget()}
        onCancel={cancelDeleteTarget}
      />

      <ExportDialog
        target={exportTarget}
        readMarkdown={readMarkdownForExport}
        onClose={() => setExportTarget(null)}
      />

      <ImportDialog
        files={importFileList}
        vaultRoot={folderPath}
        onImported={handleImported}
        onClose={() => setImportFileList(null)}
      />

      {availableUpdate ? (
        <UpdateNotification
          update={availableUpdate}
          onDismiss={() => setAvailableUpdate(null)}
        />
      ) : null}
    </main>
  );
}

export default App;
