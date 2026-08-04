import { useCallback, useEffect, useMemo, useRef } from "react";
import { BookOpen, Download, FilePlus, Pencil, Printer, Trash2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import { dirname, join } from "@tauri-apps/api/path";

import type { ExportMode } from "@/components/ExportDialog";
import {
  normalizeVaultPath,
  stagedChangeKind,
  vaultPathKey
} from "@/lib/chat/vaultStaging";
import { getRelativeDisplayPath, type MarkdownFileRecord } from "@/lib/fileSystem";
import { buildFileTree, type FileTreeNode } from "@/lib/fileTree";
import type { ManualOrderMap, SortMode } from "@/lib/vaultMeta";
import type { MoveTreeEntryInput } from "@/store/useAppStore";
import { useSearchStore } from "@/store/useSearchStore";
import { useStagedChangesStore } from "@/store/useStagedChangesStore";

import { ContextMenuSurface } from "./fileTree/ContextMenuSurface";
import { TreeNodeRow } from "./fileTree/TreeNodeRow";
import { useExpandedFolders } from "./fileTree/useExpandedFolders";
import { useTreeContextMenu } from "./fileTree/useTreeContextMenu";
import { useTreeDragDrop } from "./fileTree/useTreeDragDrop";
import { useTreeRename } from "./fileTree/useTreeRename";
import { useTreeSelection } from "./fileTree/useTreeSelection";
import {
  buildFolderMatchCounts,
  buildNodeContextMap,
  collectMatchingFolderPaths,
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
  onExportFileRequest: (filePath: string, mode: ExportMode) => void;
  onExportFolderRequest: (folderPath: string, mode: ExportMode) => void;
  onPrintFileRequest: (filePath: string) => void;
  onRenameFolder: (folderPath: string, newBaseName: string) => Promise<boolean>;
  onRenameFile: (filePath: string, newBaseName: string) => Promise<boolean>;
  onMoveEntry: (input: MoveTreeEntryInput) => Promise<boolean>;
  onDeleteMultipleRequest: (entries: BatchEntry[]) => void;
  onExportMultipleRequest: (entries: BatchEntry[], mode: ExportMode) => void;
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
  onPrintFileRequest,
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
  const { expandedFolderPaths, toggleFolder, expandAncestorsOf, expandFolders } =
    useExpandedFolders(folderPath);
  const { contextMenu, setContextMenu } = useTreeContextMenu();
  const fileMatchCounts = useSearchStore((state) => state.fileMatchCounts);
  const lastHandledFolderRenameRequestIdRef = useRef<number | undefined>(undefined);

  const stagedChanges = useStagedChangesStore((state) => state.changes);

  // What the agent has proposed, indexed the way the rows need it.
  //
  // Files it proposes to CREATE do not exist on disk yet, so they are not in
  // filePaths — they are folded into the tree as records of their own, greyed
  // out and with the paw. Leaving them out would mean the one kind of change a
  // user most wants to look at before applying is the one they cannot find.
  const staged = useMemo(() => {
    const separator = folderPath.includes("\\") ? "\\" : "/";
    const toAbsolute = (relativePath: string) =>
      `${folderPath}${separator}${normalizeVaultPath(relativePath).split("/").join(separator)}`;

    const changedFilePaths: Record<string, number> = {};
    const deletedKeys = new Set<string>();
    const createdRecords: MarkdownFileRecord[] = [];

    for (const change of stagedChanges) {
      const kind = stagedChangeKind(change);

      if (kind === "create") {
        const filePath = toAbsolute(change.targetPath);

        createdRecords.push({
          filePath,
          relativePath: normalizeVaultPath(change.targetPath),
          mtimeMs: 0
        });
        changedFilePaths[filePath] = 1;
        continue;
      }

      const filePath = toAbsolute(change.path);
      changedFilePaths[filePath] = 1;

      if (kind === "delete") {
        deletedKeys.add(vaultPathKey(filePath));
      }
    }

    return {
      changedFilePaths,
      changedKeys: new Set(Object.keys(changedFilePaths).map(vaultPathKey)),
      createdKeys: new Set(createdRecords.map((record) => vaultPathKey(record.filePath))),
      deletedKeys,
      createdRecords
    };
  }, [folderPath, stagedChanges]);

  const treeNodes = useMemo(() => {
    const records: MarkdownFileRecord[] = filePaths.map((filePath) => ({
      filePath,
      relativePath: getRelativeDisplayPath(folderPath, filePath),
      mtimeMs: fileMtimeMs[filePath] ?? 0
    }));

    // Only the ones the tree does not already know: a file created and applied
    // in the same session is in filePaths by now.
    const known = new Set(records.map((record) => vaultPathKey(record.relativePath)));

    for (const record of staged.createdRecords) {
      if (!known.has(vaultPathKey(record.relativePath))) {
        records.push(record);
      }
    }
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
  }, [
    folderPath,
    filePaths,
    emptyFolderPaths,
    fileMtimeMs,
    emptyFolderMtimeMs,
    sortMode,
    manualOrder,
    staged
  ]);

  const nodeContextByKey = useMemo(() => buildNodeContextMap(treeNodes), [treeNodes]);

  const folderMatchCounts = useMemo(
    () => buildFolderMatchCounts(treeNodes, fileMatchCounts),
    [treeNodes, fileMatchCounts]
  );

  // Same aggregation for the paw: a collapsed folder has to say that something
  // inside it is waiting, and no row can work that out without re-walking its
  // own subtree on every render.
  const folderStagedCounts = useMemo(
    () => buildFolderMatchCounts(treeNodes, staged.changedFilePaths),
    [treeNodes, staged]
  );

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
      // While a project-wide search is running, opening a collapsed folder that
      // carries hits unfolds its whole matching subtree at once — the badge only
      // says "something below matches", so one click has to get the user there
      // instead of one level per click. Collapsing stays a plain toggle.
      const matchingFolderPaths =
        expandedFolderPaths.has(node.relativePath) || !folderMatchCounts[node.relativePath]
          ? []
          : collectMatchingFolderPaths(node, folderMatchCounts);

      if (matchingFolderPaths.length > 0) {
        expandFolders(matchingFolderPaths);
      } else {
        toggleFolder(node.relativePath);
      }
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

    if (event.key === "F2") {
      if (!activeKey) {
        return;
      }

      const activeNode = flatNodes.find((node) => getNodeKey(node) === activeKey);

      if (!activeNode) {
        return;
      }

      event.preventDefault();

      if (activeNode.kind === "folder") {
        startFolderRename(activeNode.relativePath);
      } else {
        startFileRename(activeNode.relativePath);
      }
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

  // What a drag out of the tree carries: the dragged file, or — when it is part
  // of a multi-selection — every selected file. Folders carry nothing, since
  // only files can be linked in a document.
  const resolveDragFilePaths = useCallback(
    (node: FileTreeNode): string[] => {
      if (node.kind !== "file") {
        return [];
      }

      const key = getNodeKey(node);

      if (!selectedKeys.has(key) || selectedKeys.size <= 1) {
        return [node.filePath];
      }

      return flatNodes.flatMap((candidate) =>
        candidate.kind === "file" && selectedKeys.has(getNodeKey(candidate))
          ? [candidate.filePath]
          : []
      );
    },
    [flatNodes, selectedKeys]
  );

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
            folderMatchCounts={folderMatchCounts}
            folderStagedCounts={folderStagedCounts}
            stagedKeys={staged.changedKeys}
            stagedCreatedKeys={staged.createdKeys}
            stagedDeletedKeys={staged.deletedKeys}
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
            resolveDragFilePaths={resolveDragFilePaths}
          />
        ))}
      </ul>

      {contextMenu ? (
        <ContextMenuSurface
          x={contextMenu.x}
          y={contextMenu.y}
          onClick={(event) => event.stopPropagation()}
        >
          {contextMenu.kind === "multiple" ? (
            <>
              {(["standard", "manuscript"] as const).map((mode) => (
                <button
                  key={mode}
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
                          entry.kind === "folder"
                            ? await join(folderPath, entry.path)
                            : entry.path
                      }))
                    ).then((resolved) => onExportMultipleRequest(resolved, mode));

                    setContextMenu(null);
                  }}
                >
                  {mode === "manuscript" ? (
                    <BookOpen aria-hidden="true" />
                  ) : (
                    <Download aria-hidden="true" />
                  )}
                  {t(mode === "manuscript" ? "fileTree.exportManuscript" : "fileTree.export")}
                </button>
              ))}

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
                    void join(folderPath, contextMenu.relativePath).then((path) =>
                      onExportFolderRequest(path, "standard")
                    );
                  } else {
                    onExportFileRequest(contextMenu.filePath, "standard");
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
                className="file-tree-context-menu__item"
                onClick={() => {
                  if (contextMenu.kind === "folder") {
                    void join(folderPath, contextMenu.relativePath).then((path) =>
                      onExportFolderRequest(path, "manuscript")
                    );
                  } else {
                    onExportFileRequest(contextMenu.filePath, "manuscript");
                  }

                  setContextMenu(null);
                }}
              >
                <BookOpen aria-hidden="true" />
                {t("fileTree.exportManuscript")}
              </button>

              {contextMenu.kind === "file" ? (
                <button
                  type="button"
                  role="menuitem"
                  className="file-tree-context-menu__item"
                  onClick={() => {
                    onPrintFileRequest(contextMenu.filePath);
                    setContextMenu(null);
                  }}
                >
                  <Printer aria-hidden="true" />
                  {t("fileTree.print")}
                </button>
              ) : null}

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
        </ContextMenuSurface>
      ) : null}
    </>
  );
}
