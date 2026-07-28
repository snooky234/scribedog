import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import {
  ArrowDownAZ,
  ArrowUpDown,
  BookOpen,
  Check,
  Clock,
  Download,
  FileText,
  FolderOpen,
  FolderPlus,
  GripVertical,
  Import,
  Plus,
  Settings2,
  Trash2
} from "lucide-react";
import { useTranslation } from "react-i18next";

import type { ExportMode } from "@/components/ExportDialog";
import { Button } from "@/components/ui/button";
import {
  Menu,
  MenuItem,
  MenuPopup,
  MenuPortal,
  MenuPositioner,
  MenuRadioGroup,
  MenuRadioItem,
  MenuRadioItemIndicator,
  MenuTrigger
} from "@/components/ui/menu";
import { FileTree, type BatchEntry, type PendingFolderRename } from "@/components/FileTree";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  carriesExternalFiles,
  readDropPayload,
  type DropPayload
} from "@/lib/dragDrop/droppedSources";
import { formatFolderLabel, getFolderBasename } from "@/lib/fileSystem";
import type { ManualOrderMap, SortMode } from "@/lib/vaultMeta";
import type { MoveTreeEntryInput } from "@/store/useAppStore";
import { DROP_DIRECTORY_ATTRIBUTE, useImportDropStore } from "@/store/useImportDropStore";

type SidebarProps = {
  folderPath: string | null;
  filePaths: string[];
  emptyFolderPaths: string[];
  selectedFilePath: string | null;
  dirtyFilePaths: string[];
  folderError: string | null;
  isLoading: boolean;
  pendingFolderRename: PendingFolderRename | null;
  sortMode: SortMode;
  manualOrder: ManualOrderMap;
  fileMtimeMs: Record<string, number>;
  emptyFolderMtimeMs: Record<string, number>;
  onOpenFolder: () => void;
  recentFolderPaths: string[];
  onOpenRecentFolder: (folderPath: string) => void;
  onCreateFile: () => void;
  onCreateFileRequest: (targetDirectory: string) => void;
  onCreateFolder: () => void;
  onImportRequest: () => void;
  onSelectFilePath: (filePath: string) => Promise<void>;
  onDeleteFileRequest: (filePath: string) => void;
  onDeleteFolderRequest: (folderPath: string) => void;
  onDeleteMultipleRequest: (entries: BatchEntry[]) => void;
  onDeleteToolbarRequest: () => void;
  onExportFileRequest: (filePath: string, mode: ExportMode) => void;
  onExportFolderRequest: (folderPath: string, mode: ExportMode) => void;
  onExportMultipleRequest: (entries: BatchEntry[], mode: ExportMode) => void;
  onPrintFileRequest: (filePath: string) => void;
  onRenameFolder: (folderPath: string, newBaseName: string) => Promise<boolean>;
  onRenameFile: (filePath: string, newBaseName: string) => Promise<boolean>;
  onMoveEntry: (input: MoveTreeEntryInput) => Promise<boolean>;
  onSetSortMode: (mode: SortMode) => void;
  onAiSettingsRequest: () => void;
  onRequestEditorFocus: () => void;
  sidebarFocusRequestId: number;
  onFileTreeSelectionChange: (entries: BatchEntry[]) => void;
  fileTreeSelectionCount: number;
  // Files dragged in from outside the app, with the vault-relative folder they
  // were dropped on ("" is the vault root).
  onFilesDropped: (payload: DropPayload, targetDirectory: string) => void;
};

export function Sidebar({
  folderPath,
  filePaths,
  emptyFolderPaths,
  selectedFilePath,
  dirtyFilePaths,
  folderError,
  isLoading,
  pendingFolderRename,
  sortMode,
  manualOrder,
  fileMtimeMs,
  emptyFolderMtimeMs,
  onOpenFolder,
  recentFolderPaths,
  onOpenRecentFolder,
  onCreateFile,
  onCreateFileRequest,
  onCreateFolder,
  onImportRequest,
  onSelectFilePath,
  onDeleteFileRequest,
  onDeleteFolderRequest,
  onDeleteMultipleRequest,
  onDeleteToolbarRequest,
  onExportFileRequest,
  onExportFolderRequest,
  onExportMultipleRequest,
  onPrintFileRequest,
  onRenameFolder,
  onRenameFile,
  onMoveEntry,
  onSetSortMode,
  onAiSettingsRequest,
  onRequestEditorFocus,
  sidebarFocusRequestId,
  onFileTreeSelectionChange,
  fileTreeSelectionCount,
  onFilesDropped
}: SidebarProps) {
  const { t } = useTranslation();
  const folderLabel = formatFolderLabel(folderPath);
  const [rootContextMenu, setRootContextMenu] = useState<{ x: number; y: number } | null>(null);
  // Files dragged in from outside the app land as imported notes. Drags that
  // start inside the tree (reordering, or dragging a note into the editor) are
  // none of this handler's business and are left to bubble untouched.
  const importTargetDirectory = useImportDropStore((state) => state.targetDirectory);
  const setImportTargetDirectory = useImportDropStore((state) => state.setTargetDirectory);
  const isDropTarget = importTargetDirectory !== null;

  const handleFileDragOver = (event: React.DragEvent<HTMLElement>) => {
    if (folderPath === null || !carriesExternalFiles(event.dataTransfer)) {
      return;
    }

    // Without this the webview handles the drop itself and navigates away from
    // the app to the dropped file.
    event.preventDefault();
    event.dataTransfer.dropEffect = "copy";

    // The row under the pointer decides the target folder; a file row hands the
    // drop to the folder it lives in, and bare panel space to the vault root.
    const target = event.target instanceof Element ? event.target : null;
    const directory =
      target?.closest(`[${DROP_DIRECTORY_ATTRIBUTE}]`)?.getAttribute(DROP_DIRECTORY_ATTRIBUTE) ?? "";

    setImportTargetDirectory(directory);
  };

  const handleFileDragLeave = (event: React.DragEvent<HTMLElement>) => {
    // Crossing from one child of the panel into the next fires dragleave on the
    // one being left; only a pointer that really left the panel ends the state.
    if (event.relatedTarget instanceof Node && event.currentTarget.contains(event.relatedTarget)) {
      return;
    }

    setImportTargetDirectory(null);
  };

  const handleFileDrop = (event: React.DragEvent<HTMLElement>) => {
    if (folderPath === null || !carriesExternalFiles(event.dataTransfer)) {
      return;
    }

    event.preventDefault();

    const directory = importTargetDirectory ?? "";

    setImportTargetDirectory(null);
    // The transfer is emptied as soon as this handler returns, so what was
    // dropped is taken out of it here and only walked afterwards.
    onFilesDropped(readDropPayload(event.dataTransfer), directory);
  };

  // Same dismissal rules as the tree's own menu (useTreeContextMenu): any
  // click, a competing right-click, a scroll or Escape closes it.
  useEffect(() => {
    if (!rootContextMenu) {
      return;
    }

    const close = () => setRootContextMenu(null);
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        close();
      }
    };

    window.addEventListener("click", close);
    window.addEventListener("contextmenu", close, true);
    window.addEventListener("scroll", close, true);
    window.addEventListener("keydown", handleKeyDown);

    return () => {
      window.removeEventListener("click", close);
      window.removeEventListener("contextmenu", close, true);
      window.removeEventListener("scroll", close, true);
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [rootContextMenu]);

  return (
    <aside
      className={`sidebar-panel${isDropTarget ? " sidebar-panel--drop-target" : ""}`}
      aria-label={t("sidebar.filesLabel")}
      onDragOver={handleFileDragOver}
      onDragLeave={handleFileDragLeave}
      onDrop={handleFileDrop}
    >
      {isDropTarget ? (
        <div className="sidebar-panel__dropzone" aria-hidden="true">
          <Import className="size-5" />
          <span>{t("sidebar.dropImportHint")}</span>
        </div>
      ) : null}

      <div className="sidebar-panel__header">
        <div className="sidebar-panel__actions">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={onCreateFolder}
            disabled={isLoading || folderPath === null}
            aria-label={t("sidebar.newFolder")}
            title={t("sidebar.newFolder")}
          >
            <FolderPlus />
          </Button>

          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={onCreateFile}
            disabled={isLoading || folderPath === null}
            aria-label={t("sidebar.newFile")}
            title={t("sidebar.newFile")}
          >
            <Plus />
          </Button>

          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={onImportRequest}
            disabled={isLoading || folderPath === null}
            aria-label={t("sidebar.importFiles")}
            title={t("sidebar.importFiles")}
          >
            <Import />
          </Button>

          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={onDeleteToolbarRequest}
            disabled={isLoading || (selectedFilePath === null && fileTreeSelectionCount === 0)}
            aria-label={t("sidebar.deleteFile")}
            title={t("sidebar.deleteSelectedFile")}
          >
            <Trash2 />
          </Button>

          <Menu>
            <MenuTrigger
              render={
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={isLoading || folderPath === null}
                  aria-label={t("sidebar.sortMode")}
                  title={t("sidebar.sortMode")}
                >
                  <ArrowUpDown />
                </Button>
              }
            />
            <MenuPortal>
              <MenuPositioner>
                <MenuPopup>
                  <MenuRadioGroup
                    value={sortMode}
                    onValueChange={(value) => onSetSortMode(value as SortMode)}
                  >
                    <MenuRadioItem value="name">
                      <ArrowDownAZ className="size-4" aria-hidden="true" />
                      {t("sidebar.sortModeName")}
                      <MenuRadioItemIndicator />
                    </MenuRadioItem>
                    <MenuRadioItem value="modified">
                      <Clock className="size-4" aria-hidden="true" />
                      {t("sidebar.sortModeModified")}
                      <MenuRadioItemIndicator />
                    </MenuRadioItem>
                    <MenuRadioItem value="manual">
                      <GripVertical className="size-4" aria-hidden="true" />
                      {t("sidebar.sortModeManual")}
                      <MenuRadioItemIndicator />
                    </MenuRadioItem>
                  </MenuRadioGroup>
                </MenuPopup>
              </MenuPositioner>
            </MenuPortal>
          </Menu>

          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={onAiSettingsRequest}
            aria-label={t("sidebar.settings")}
            title={t("sidebar.settings")}
          >
            <Settings2 />
          </Button>
        </div>
        <div className="sidebar-panel__folder-wrap">
          <Menu>
            <MenuTrigger
              render={
                <button
                  type="button"
                  className="sidebar-panel__folder"
                  disabled={isLoading}
                  title={folderPath ?? t("sidebar.openFolder")}
                  aria-label={t("sidebar.openRecentFolder")}
                  // The vault root is the natural target for "export the whole
                  // book", but it is not a row in the tree — so it carries its
                  // own (unrelated) right-click menu alongside this one.
                  onContextMenu={(event) => {
                    if (folderPath === null) {
                      return;
                    }

                    event.preventDefault();
                    setRootContextMenu({ x: event.clientX, y: event.clientY });
                  }}
                />
              }
            >
              {folderLabel}
            </MenuTrigger>
            <MenuPortal>
              <MenuPositioner align="start">
                <MenuPopup>
                  {recentFolderPaths.length > 0 ? (
                    <>
                      {recentFolderPaths.map((recentFolderPath) => (
                        <MenuItem
                          key={recentFolderPath}
                          className="sidebar-panel__recent-folder-item"
                          title={recentFolderPath}
                          onClick={() => onOpenRecentFolder(recentFolderPath)}
                        >
                          {recentFolderPath === folderPath ? (
                            <Check className="size-4" aria-hidden="true" />
                          ) : (
                            <span className="size-4" aria-hidden="true" />
                          )}
                          <span className="sidebar-panel__recent-folder-name">
                            {getFolderBasename(recentFolderPath)}
                          </span>
                        </MenuItem>
                      ))}
                      <div className="editor-toolbar__menu-separator" role="separator" />
                    </>
                  ) : null}
                  <MenuItem onClick={onOpenFolder}>
                    <FolderOpen className="size-4" aria-hidden="true" />
                    {t("sidebar.browseForFolder")}
                  </MenuItem>
                </MenuPopup>
              </MenuPositioner>
            </MenuPortal>
          </Menu>
        </div>
      </div>

      {rootContextMenu && folderPath !== null
        ? createPortal(
            <div
              className="file-tree-context-menu"
              role="menu"
              style={{ top: rootContextMenu.y, left: rootContextMenu.x }}
              onClick={(event) => event.stopPropagation()}
            >
              <button
                type="button"
                role="menuitem"
                className="file-tree-context-menu__item"
                onClick={() => {
                  onExportFolderRequest(folderPath, "standard");
                  setRootContextMenu(null);
                }}
              >
                <Download aria-hidden="true" />
                {t("fileTree.export")}
              </button>
              <button
                type="button"
                role="menuitem"
                className="file-tree-context-menu__item"
                onClick={() => {
                  onExportFolderRequest(folderPath, "manuscript");
                  setRootContextMenu(null);
                }}
              >
                <BookOpen aria-hidden="true" />
                {t("fileTree.exportManuscript")}
              </button>
            </div>,
            document.body
          )
        : null}

      {folderError ? (
        <div className="sidebar-panel__message sidebar-panel__message--error">
          {folderError}
        </div>
      ) : null}

      {isLoading ? (
        <div className="sidebar-panel__message">{t("sidebar.searchingFolder")}</div>
      ) : folderPath === null ? (
        <button
          type="button"
          className="sidebar-panel__empty sidebar-panel__empty--interactive"
          onClick={onOpenFolder}
          disabled={isLoading}
        >
          <FolderOpen />
          <p>{t("sidebar.openFolderPrompt")}</p>
        </button>
      ) : filePaths.length === 0 && emptyFolderPaths.length === 0 ? (
        <button
          type="button"
          className="sidebar-panel__empty sidebar-panel__empty--interactive"
          onClick={onOpenFolder}
          disabled={isLoading}
        >
          <FileText />
          <p>{t("sidebar.noMarkdownFiles")}</p>
        </button>
      ) : null}

      <ScrollArea className="sidebar-panel__scroll">
        {folderPath !== null && (filePaths.length > 0 || emptyFolderPaths.length > 0) ? (
          <FileTree
            key={folderPath}
            folderPath={folderPath}
            filePaths={filePaths}
            emptyFolderPaths={emptyFolderPaths}
            selectedFilePath={selectedFilePath}
            dirtyFilePaths={dirtyFilePaths}
            pendingFolderRename={pendingFolderRename}
            sortMode={sortMode}
            manualOrder={manualOrder}
            fileMtimeMs={fileMtimeMs}
            emptyFolderMtimeMs={emptyFolderMtimeMs}
            onSelectFilePath={onSelectFilePath}
            onCreateFileRequest={onCreateFileRequest}
            onDeleteFileRequest={onDeleteFileRequest}
            onDeleteFolderRequest={onDeleteFolderRequest}
            onDeleteMultipleRequest={onDeleteMultipleRequest}
            onExportFileRequest={onExportFileRequest}
            onExportFolderRequest={onExportFolderRequest}
            onExportMultipleRequest={onExportMultipleRequest}
            onPrintFileRequest={onPrintFileRequest}
            onRenameFolder={onRenameFolder}
            onRenameFile={onRenameFile}
            onMoveEntry={onMoveEntry}
            onRequestEditorFocus={onRequestEditorFocus}
            focusRequestId={sidebarFocusRequestId}
            onSelectionChange={onFileTreeSelectionChange}
          />
        ) : null}
      </ScrollArea>
    </aside>
  );
}