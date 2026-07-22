import { useCallback, useEffect, useMemo, useRef } from "react";
import { createPortal } from "react-dom";
import { Download, FilePlus, Pencil, Trash2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import { dirname, join } from "@tauri-apps/api/path";

import { getRelativeDisplayPath, type MarkdownFileRecord } from "@/lib/fileSystem";
import { buildFileTree, type FileTreeNode } from "@/lib/fileTree";
import type { ManualOrderMap, SortMode } from "@/lib/vaultMeta";
import type { MoveTreeEntryInput } from "@/store/useAppStore";

import { TreeNodeRow } from "./fileTree/TreeNodeRow";
import { useExpandedFolders } from "./fileTree/useExpandedFolders";
import { useTreeContextMenu } from "./fileTree/useTreeContextMenu";
import { useTreeDragDrop } from "./fileTree/useTreeDragDrop";
import { useTreeRename } from "./fileTree/useTreeRename";
import { useTreeSelection } from "./fileTree/useTreeSelection";
import {
  buildNodeContextMap,
  computeRangeKeys,
  flattenVisibleNodes,
  getNodeKey,
  getTopLevelSelection
} from "./fileTree/treeNavigation";
import type { BatchEntry, PendingFolderRename } from "./fileTree/types";

export type { BatchEntry, PendingFolderRename } from "./fileTree/types";

type FileTreeProps = {
  folderPath: string;
  filePaths: string[];
  emptyFolderPaths: string[];
  selectedFilePath: string | null;
  dirtyFilePaths: string[];
  pendingFolderRename?: PendingFolderRename | null;
  sortMode: SortMode;
  manualOrder: ManualOrderMap;
  fileMtimeMs: Record<string, number>;
  emptyFolderMtimeMs: Record<string, number>;
  onSelectFilePath: (filePath: string) => Promise<void>;
  onCreateFileRequest: (targetDirectory: string) => void;
  onDeleteFileRequest: (filePath: string) => void;
  onDeleteFolderRequest: (folderPath: string) => void;
  onExportFileRequest: (filePath: string) => void;
  onExportFolderRequest: (folderPath: string) => void;
  onRenameFolder: (folderPath: string, newBaseName: string) => Promise<boolean>;
  onRenameFile: (filePath: string, newBaseName: string) => Promise<boolean>;
  onMoveEntry: (input: MoveTreeEntryInput) => Promise<boolean>;
  onDeleteMultipleRequest: (entries: BatchEntry[]) => void;
  onExportMultipleRequest: (entries: BatchEntry[]) => void;
  onRequestEditorFocus?: () => void;
  focusRequestId?: number;
  onSelectionChange?: (entries: BatchEntry[]) => void;
};

export function FileTree({
  folderPath,
  filePaths,
  emptyFolderPaths,
  selectedFilePath,
  dirtyFilePaths,
  pendingFolderRename,
  sortMode,
  manualOrder,
  fileMtimeMs,
  emptyFolderMtimeMs,
  onSelectFilePath,
  onCreateFileRequest,
  onDeleteFileRequest,
  onDeleteFolderRequest,
  onExportFileRequest,
  onExportFolderRequest,
  onRenameFolder,
  onRenameFile,
  onMoveEntry,
  onDeleteMultipleRequest,
  onExportMultipleRequest,
  onRequestEditorFocus,
  focusRequestId,
  onSelectionChange
}: FileTreeProps) {
  const { t } = useTranslation();
  const { expandedFolderPaths, toggleFolder, expandAncestorsOf } = useExpandedFolders(folderPath);
  const { contextMenu, setContextMenu } = useTreeContextMenu();
  const lastHandledFolderRenameRequestIdRef = useRef<number | undefined>(undefined);

  const treeNodes = useMemo(() => {
    const records: MarkdownFileRecord[] = filePaths.map((filePath) => ({
      filePath,
      relativePath: getRelativeDisplayPath(folderPath, filePath),
      mtimeMs: fileMtimeMs[filePath] ?? 0
    }));
    const emptyFolderRelativePaths = emptyFolderPaths.map((emptyFolderPath) =>
      getRelativeDisplayPath(folderPath, emptyFolderPath)
    );
    const emptyFolderOwnMtimeMs: Record<string, number> = {};

    emptyFolderPaths.forEach((emptyFolderPath) => {
      emptyFolderOwnMtimeMs[getRelativeDisplayPath(folderPath, emptyFolderPath)] =
        emptyFolderMtimeMs[emptyFolderPath] ?? 0;
    });

    return buildFileTree(records, emptyFolderRelativePaths, {
      sortMode,
      manualOrder,
      emptyFolderOwnMtimeMs
    });
  }, [folderPath, filePaths, emptyFolderPaths, fileMtimeMs, emptyFolderMtimeMs, sortMode, manualOrder]);

  const nodeContextByKey = useMemo(() => buildNodeContextMap(treeNodes), [treeNodes]);

  const flatNodes = useMemo(
    () => flattenVisibleNodes(treeNodes, expandedFolderPaths),
    [treeNodes, expandedFolderPaths]
  );

  const {
    activeKey,
    setActiveKey,
    rangeFocusKey,
    setRangeFocusKey,
    selectedKeys,
    setSelectedKeys,
    registerItemRef,
    focusItem,
    resolveBatchEntries
  } = useTreeSelection({
    folderPath,
    selectedFilePath,
    treeNodes,
    flatNodes,
    focusRequestId,
    onSelectionChange
  });

  const clearSelection = useCallback(() => setSelectedKeys(new Set()), [setSelectedKeys]);

  const {
    dragSourceKeys,
    dropIndicator,
    handleRowDragStart,
    handleRowDropIndicatorChange,
    handleRowDragEnd,
    handleRowDrop
  } = useTreeDragDrop({
    folderPath,
    flatNodes,
    nodeContextByKey,
    selectedKeys,
    clearSelection,
    onMoveEntry
  });

  const {
    renamingTarget,
    renameDraft,
    setRenameDraft,
    renameInputRef,
    startFileRename,
    startFolderRename,
    commitRename,
    cancelRename
  } = useTreeRename({ folderPath, onRenameFolder, onRenameFile });

  useEffect(() => {
    if (!selectedFilePath) {
      return;
    }

    expandAncestorsOf(getRelativeDisplayPath(folderPath, selectedFilePath));
  }, [folderPath, selectedFilePath, expandAncestorsOf]);

  // After creating a new folder (sidebar button), switch straight into
  // rename mode, mirroring the title rename for new files.
  useEffect(() => {
    if (!pendingFolderRename) {
      return;
    }

    if (lastHandledFolderRenameRequestIdRef.current === pendingFolderRename.requestId) {
      return;
    }

    lastHandledFolderRenameRequestIdRef.current = pendingFolderRename.requestId;

    const relativePath = getRelativeDisplayPath(folderPath, pendingFolderRename.folderPath);

    expandAncestorsOf(relativePath);
    startFolderRename(relativePath);
  }, [pendingFolderRename, folderPath, expandAncestorsOf, startFolderRename]);

  const handleRowClick = (node: FileTreeNode, event: React.MouseEvent) => {
    const key = getNodeKey(node);

    if (event.ctrlKey || event.metaKey) {
      setSelectedKeys((currentKeys) => {
        const nextKeys = new Set(currentKeys);

        if (nextKeys.has(key)) {
          nextKeys.delete(key);
        } else {
          nextKeys.add(key);
        }

        return nextKeys;
      });
      setActiveKey(key);
      setRangeFocusKey(null);
      return;
    }

    if (event.shiftKey) {
      setSelectedKeys(computeRangeKeys(flatNodes, activeKey, key));
      setRangeFocusKey(key);

      if (node.kind === "file") {
        void onSelectFilePath(node.filePath);
      }
      return;
    }

    setSelectedKeys(new Set([key]));
    setActiveKey(key);
    setRangeFocusKey(null);

    if (node.kind === "folder") {
      toggleFolder(node.relativePath);
    } else {
      void onSelectFilePath(node.filePath);
    }
  };

  const handleTreeKeyDown = (event: React.KeyboardEvent<HTMLUListElement>) => {
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      if (flatNodes.length === 0) {
        return;
      }

      event.preventDefault();

      const anchorForMovement = event.shiftKey ? (rangeFocusKey ?? activeKey) : activeKey;
      const currentIndex = anchorForMovement
        ? flatNodes.findIndex((node) => getNodeKey(node) === anchorForMovement)
        : -1;

      const nextIndex =
        currentIndex === -1
          ? 0
          : Math.min(
              Math.max(currentIndex + (event.key === "ArrowDown" ? 1 : -1), 0),
              flatNodes.length - 1
            );

      const nextNode = flatNodes[nextIndex];
      const nextKey = getNodeKey(nextNode);

      focusItem(nextKey);

      if (event.shiftKey) {
        setSelectedKeys(computeRangeKeys(flatNodes, activeKey, nextKey));
        setRangeFocusKey(nextKey);
        return;
      }

      setActiveKey(nextKey);
      setSelectedKeys(new Set([nextKey]));
      setRangeFocusKey(null);

      if (nextNode.kind === "file") {
        void onSelectFilePath(nextNode.filePath);
      }
      return;
    }

    if (event.key === "Tab" && !event.shiftKey) {
      event.preventDefault();
      onRequestEditorFocus?.();
    }

    if (event.key === "Delete") {
      const keysToDelete: string[] =
        selectedKeys.size > 1 ? [...selectedKeys] : activeKey ? [activeKey] : [];

      if (keysToDelete.length === 0) {
        return;
      }

      event.preventDefault();

      void resolveBatchEntries(keysToDelete).then(onDeleteMultipleRequest);
    }
  };

  const handleRowContextMenu = (node: FileTreeNode, x: number, y: number) => {
    const key = getNodeKey(node);

    if (selectedKeys.has(key) && selectedKeys.size > 1) {
      setContextMenu({ kind: "multiple", keys: [...selectedKeys], x, y });
      return;
    }

    setSelectedKeys(new Set([key]));
    setActiveKey(key);
    setRangeFocusKey(null);

    if (node.kind === "folder") {
      setContextMenu({ kind: "folder", relativePath: node.relativePath, x, y });
    } else {
      setContextMenu({ kind: "file", filePath: node.filePath, x, y });
    }
  };

  return (
    <>
      <ul
        role="tree"
        className="file-tree"
        aria-label={t("fileTree.treeLabel")}
        onKeyDown={handleTreeKeyDown}
      >
        {treeNodes.map((node) => (
          <TreeNodeRow
            key={node.relativePath}
            node={node}
            depth={0}
            expandedFolderPaths={expandedFolderPaths}
            selectedFilePath={selectedFilePath}
            selectedKeys={selectedKeys}
            dirtyFilePaths={dirtyFilePaths}
            activeKey={activeKey}
            renamingTarget={renamingTarget}
            renameDraft={renameDraft}
            renameInputRef={renameInputRef}
            sortMode={sortMode}
            dragSourceKeys={dragSourceKeys}
            dropIndicator={dropIndicator}
            onRowClick={handleRowClick}
            onRowContextMenu={handleRowContextMenu}
            onRenameDraftChange={setRenameDraft}
            onCommitRename={() => void commitRename()}
            onCancelRename={cancelRename}
            registerItemRef={registerItemRef}
            onRowDragStart={handleRowDragStart}
            onRowDropIndicatorChange={handleRowDropIndicatorChange}
            onRowDrop={handleRowDrop}
            onRowDragEnd={handleRowDragEnd}
          />
        ))}
      </ul>

      {contextMenu
        ? createPortal(
            <div
              className="file-tree-context-menu"
              role="menu"
              style={{ top: contextMenu.y, left: contextMenu.x }}
              onClick={(event) => event.stopPropagation()}
            >
              {contextMenu.kind === "multiple" ? (
                <>
                  <button
                    type="button"
                    role="menuitem"
                    className="file-tree-context-menu__item"
                    onClick={() => {
                      const entries = getTopLevelSelection(contextMenu.keys, flatNodes).map(
                        (node): BatchEntry => ({
                          kind: node.kind,
                          path: node.kind === "file" ? node.filePath : node.relativePath
                        })
                      );

                      void Promise.all(
                        entries.map(async (entry) => ({
                          kind: entry.kind,
                          path:
                            entry.kind === "folder" ? await join(folderPath, entry.path) : entry.path
                        }))
                      ).then(onExportMultipleRequest);

                      setContextMenu(null);
                    }}
                  >
                    <Download aria-hidden="true" />
                    {t("fileTree.export")}
                  </button>

                  <button
                    type="button"
                    role="menuitem"
                    className="file-tree-context-menu__item file-tree-context-menu__item--danger"
                    onClick={() => {
                      const entries = getTopLevelSelection(contextMenu.keys, flatNodes).map(
                        (node): BatchEntry => ({
                          kind: node.kind,
                          path: node.kind === "file" ? node.filePath : node.relativePath
                        })
                      );

                      void Promise.all(
                        entries.map(async (entry) => ({
                          kind: entry.kind,
                          path:
                            entry.kind === "folder" ? await join(folderPath, entry.path) : entry.path
                        }))
                      ).then(onDeleteMultipleRequest);

                      setContextMenu(null);
                    }}
                  >
                    <Trash2 aria-hidden="true" />
                    {t("fileTree.delete")}
                  </button>
                </>
              ) : (
                <>
                  <button
                    type="button"
                    role="menuitem"
                    className="file-tree-context-menu__item"
                    onClick={() => {
                      const targetDirectoryPromise =
                        contextMenu.kind === "folder"
                          ? join(folderPath, contextMenu.relativePath)
                          : dirname(contextMenu.filePath);

                      void targetDirectoryPromise.then(onCreateFileRequest);
                      setContextMenu(null);
                    }}
                  >
                    <FilePlus aria-hidden="true" />
                    {t("sidebar.newFile")}
                  </button>

                  <button
                    type="button"
                    role="menuitem"
                    className="file-tree-context-menu__item"
                    onClick={() => {
                      if (contextMenu.kind === "folder") {
                        startFolderRename(contextMenu.relativePath);
                      } else {
                        startFileRename(getRelativeDisplayPath(folderPath, contextMenu.filePath));
                      }

                      setContextMenu(null);
                    }}
                  >
                    <Pencil aria-hidden="true" />
                    {t("fileTree.rename")}
                  </button>

                  <button
                    type="button"
                    role="menuitem"
                    className="file-tree-context-menu__item"
                    onClick={() => {
                      if (contextMenu.kind === "folder") {
                        void join(folderPath, contextMenu.relativePath).then(onExportFolderRequest);
                      } else {
                        onExportFileRequest(contextMenu.filePath);
                      }

                      setContextMenu(null);
                    }}
                  >
                    <Download aria-hidden="true" />
                    {t("fileTree.export")}
                  </button>

                  <button
                    type="button"
                    role="menuitem"
                    className="file-tree-context-menu__item file-tree-context-menu__item--danger"
                    onClick={() => {
                      if (contextMenu.kind === "folder") {
                        void join(folderPath, contextMenu.relativePath).then(onDeleteFolderRequest);
                      } else {
                        onDeleteFileRequest(contextMenu.filePath);
                      }

                      setContextMenu(null);
                    }}
                  >
                    <Trash2 aria-hidden="true" />
                    {t("fileTree.delete")}
                  </button>
                </>
              )}
            </div>,
            document.body
          )
        : null}
    </>
  );
}
