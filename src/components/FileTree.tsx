import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Download, FilePlus, Pencil, Trash2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import { dirname, join } from "@tauri-apps/api/path";

import { getRelativeDisplayPath, type MarkdownFileRecord } from "@/lib/fileSystem";
import {
  buildFileTree,
  getAncestorFolderPaths,
  getStoredExpandedFolderPaths,
  isDescendantRelativePath,
  setStoredExpandedFolderPaths,
  type FileTreeNode
} from "@/lib/fileTree";
import type { ManualOrderMap, SortMode } from "@/lib/vaultMeta";
import type { MoveTreeEntryInput } from "@/store/useAppStore";

import { TreeNodeRow } from "./fileTree/TreeNodeRow";
import {
  buildNodeContextMap,
  computeRangeKeys,
  flattenVisibleNodes,
  getNodeKey,
  getTopLevelSelection
} from "./fileTree/treeNavigation";
import type {
  BatchEntry,
  DropIndicator,
  DropPosition,
  FileContextMenuState,
  PendingFolderRename,
  RenamingTarget
} from "./fileTree/types";

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
  const [expandedFolderPaths, setExpandedFolderPaths] = useState<Set<string>>(() =>
    getStoredExpandedFolderPaths(folderPath)
  );
  const [contextMenu, setContextMenu] = useState<FileContextMenuState | null>(null);
  const [activeKey, setActiveKey] = useState<string | null>(null);
  // Range anchor for Shift-click/Shift-Arrow is activeKey itself; rangeFocusKey
  // tracks the moving edge across consecutive Shift+Arrow presses so the
  // anchor stays fixed until a non-Shift interaction resets it.
  const [rangeFocusKey, setRangeFocusKey] = useState<string | null>(null);
  const [selectedKeys, setSelectedKeys] = useState<Set<string>>(() => new Set());
  const [renamingTarget, setRenamingTarget] = useState<RenamingTarget | null>(null);
  const [renameDraft, setRenameDraft] = useState("");
  const [dragSourceKeys, setDragSourceKeys] = useState<string[]>([]);
  const [dropIndicator, setDropIndicator] = useState<DropIndicator | null>(null);
  const itemRefs = useRef<Map<string, HTMLButtonElement>>(new Map());
  const renameInputRef = useRef<HTMLInputElement>(null);
  const skipRenameCommitRef = useRef(false);
  // Last handled request value instead of a bool guard: StrictMode-safe, same
  // pattern as in Editor.tsx (duplicate mount effects would otherwise focus
  // unintentionally on the second run).
  const lastHandledFocusRequestRef = useRef(focusRequestId);
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

  // Same reduction used by the multi-select context menu's export/delete
  // actions, so the toolbar delete button and the Delete key act on exactly
  // the same set of entries a right-click batch action would.
  const selectionAsBatchEntries = useCallback(
    (keys: Iterable<string>): BatchEntry[] =>
      getTopLevelSelection(keys, flatNodes).map((node) => ({
        kind: node.kind,
        path: node.kind === "file" ? node.filePath : node.relativePath
      })),
    [flatNodes]
  );

  useEffect(() => {
    if (!onSelectionChange) {
      return;
    }

    if (selectedKeys.size > 1) {
      onSelectionChange(selectionAsBatchEntries(selectedKeys));
      return;
    }

    if (activeKey) {
      onSelectionChange(selectionAsBatchEntries([activeKey]));
      return;
    }

    onSelectionChange([]);
  }, [selectedKeys, activeKey, selectionAsBatchEntries, onSelectionChange]);

  const registerItemRef = useCallback((key: string, element: HTMLButtonElement | null) => {
    if (element) {
      itemRefs.current.set(key, element);
    } else {
      itemRefs.current.delete(key);
    }
  }, []);

  useEffect(() => {
    if (!selectedFilePath) {
      return;
    }

    const ancestors = getAncestorFolderPaths(
      getRelativeDisplayPath(folderPath, selectedFilePath)
    );

    setExpandedFolderPaths((currentPaths) => {
      if (ancestors.every((ancestor) => currentPaths.has(ancestor))) {
        return currentPaths;
      }

      const nextPaths = new Set(currentPaths);

      for (const ancestor of ancestors) {
        nextPaths.add(ancestor);
      }

      setStoredExpandedFolderPaths(folderPath, nextPaths);

      return nextPaths;
    });
  }, [folderPath, selectedFilePath]);

  // Moves the active entry (roving tabindex) to the file that was just
  // opened, so tabbing back from the editor later lands on the file being
  // edited instead of a previously selected row.
  useEffect(() => {
    if (!selectedFilePath) {
      return;
    }

    setActiveKey(`file:${getRelativeDisplayPath(folderPath, selectedFilePath)}`);
  }, [folderPath, selectedFilePath]);

  // Falls back to the first visible entry if the active one drops out of the
  // visible list (e.g. because its parent folder was collapsed).
  useEffect(() => {
    setActiveKey((currentKey) => {
      if (currentKey && flatNodes.some((node) => getNodeKey(node) === currentKey)) {
        return currentKey;
      }

      return flatNodes.length > 0 ? getNodeKey(flatNodes[0]) : null;
    });
  }, [flatNodes]);

  // Drops selected keys whose node no longer exists in the tree at all (e.g.
  // after a batch delete/move) — merely collapsing a folder does not clear
  // selections inside it, only nodes that actually vanished from the data.
  useEffect(() => {
    const allKeys = new Set(
      (function collectAllKeys(nodes: FileTreeNode[]): string[] {
        const keys: string[] = [];

        for (const node of nodes) {
          keys.push(getNodeKey(node));

          if (node.kind === "folder") {
            keys.push(...collectAllKeys(node.children));
          }
        }

        return keys;
      })(treeNodes)
    );

    setSelectedKeys((currentKeys) => {
      const nextKeys = new Set([...currentKeys].filter((key) => allKeys.has(key)));
      return nextKeys.size === currentKeys.size ? currentKeys : nextKeys;
    });
  }, [treeNodes]);

  // Focus request from outside (editor: Shift+Tab) returns focus to the
  // sidebar, onto the active tree entry.
  useEffect(() => {
    if (lastHandledFocusRequestRef.current === focusRequestId) {
      return;
    }

    lastHandledFocusRequestRef.current = focusRequestId;

    const targetKey = activeKey ?? (flatNodes.length > 0 ? getNodeKey(flatNodes[0]) : null);

    if (targetKey) {
      itemRefs.current.get(targetKey)?.focus();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusRequestId]);

  useEffect(() => {
    if (renamingTarget) {
      renameInputRef.current?.focus();
      renameInputRef.current?.select();
    }
  }, [renamingTarget]);

  const startFolderRename = useCallback((relativePath: string) => {
    skipRenameCommitRef.current = false;
    setRenamingTarget({ kind: "folder", relativePath });
    setRenameDraft(relativePath.split("/").pop() ?? relativePath);
  }, []);

  const startFileRename = useCallback((relativePath: string) => {
    skipRenameCommitRef.current = false;
    setRenamingTarget({ kind: "file", relativePath });
    const baseName = relativePath.split("/").pop() ?? relativePath;
    setRenameDraft(baseName.replace(/\.md$/i, ""));
  }, []);

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
    const ancestors = getAncestorFolderPaths(relativePath);

    setExpandedFolderPaths((currentPaths) => {
      const nextPaths = new Set(currentPaths);
      let didChange = false;

      for (const ancestor of ancestors) {
        if (!nextPaths.has(ancestor)) {
          nextPaths.add(ancestor);
          didChange = true;
        }
      }

      if (!didChange) {
        return currentPaths;
      }

      setStoredExpandedFolderPaths(folderPath, nextPaths);

      return nextPaths;
    });

    startFolderRename(relativePath);
  }, [pendingFolderRename, folderPath, startFolderRename]);

  const cancelRename = useCallback(() => {
    skipRenameCommitRef.current = true;
    setRenamingTarget(null);
  }, []);

  // Guard following the pattern of commitTitleRename in App.tsx: Enter
  // usually also triggers onBlur; without the lock, the second call would
  // try to rename the (already renamed) old path a second time.
  const commitRename = useCallback(async () => {
    if (skipRenameCommitRef.current || !renamingTarget) {
      return;
    }

    skipRenameCommitRef.current = true;

    const trimmedDraft = renameDraft.trim();
    const currentBaseName = renamingTarget.relativePath.split("/").pop() ?? renamingTarget.relativePath;
    const currentName =
      renamingTarget.kind === "file" ? currentBaseName.replace(/\.md$/i, "") : currentBaseName;

    if (!trimmedDraft || trimmedDraft === currentName) {
      setRenamingTarget(null);
      return;
    }

    const fullPath = await join(folderPath, renamingTarget.relativePath);
    const didRename =
      renamingTarget.kind === "folder"
        ? await onRenameFolder(fullPath, trimmedDraft)
        : await onRenameFile(fullPath, trimmedDraft);

    if (didRename) {
      setRenamingTarget(null);
    } else {
      skipRenameCommitRef.current = false;
      renameInputRef.current?.focus();
    }
  }, [folderPath, onRenameFolder, onRenameFile, renameDraft, renamingTarget]);

  const toggleFolder = (relativePath: string) => {
    setExpandedFolderPaths((currentPaths) => {
      const nextPaths = new Set(currentPaths);

      if (nextPaths.has(relativePath)) {
        nextPaths.delete(relativePath);
      } else {
        nextPaths.add(relativePath);
      }

      setStoredExpandedFolderPaths(folderPath, nextPaths);

      return nextPaths;
    });
  };

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

      itemRefs.current.get(nextKey)?.focus();

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

      const entries = selectionAsBatchEntries(keysToDelete);

      void Promise.all(
        entries.map(async (entry) => ({
          kind: entry.kind,
          path: entry.kind === "folder" ? await join(folderPath, entry.path) : entry.path
        }))
      ).then(onDeleteMultipleRequest);
    }
  };

  useEffect(() => {
    if (!contextMenu) {
      return;
    }

    const closeContextMenu = () => setContextMenu(null);

    window.addEventListener("click", closeContextMenu);
    // Capture phase: must run before a new right-click on a file row (bubble
    // phase) sets a fresh context menu, otherwise this handler would
    // immediately overwrite the new state with null again.
    window.addEventListener("contextmenu", closeContextMenu, true);
    window.addEventListener("scroll", closeContextMenu, true);

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        closeContextMenu();
      }
    };

    window.addEventListener("keydown", handleKeyDown);

    return () => {
      window.removeEventListener("click", closeContextMenu);
      window.removeEventListener("contextmenu", closeContextMenu, true);
      window.removeEventListener("scroll", closeContextMenu, true);
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [contextMenu]);

  const handleRowDragStart = useCallback(
    (node: FileTreeNode) => {
      const key = getNodeKey(node);

      if (selectedKeys.has(key) && selectedKeys.size > 1) {
        setDragSourceKeys([...selectedKeys]);
      } else {
        setDragSourceKeys([key]);
      }
    },
    [selectedKeys]
  );

  const handleRowDropIndicatorChange = useCallback((key: string, position: DropPosition | null) => {
    setDropIndicator((current) => {
      if (position === null) {
        return current?.key === key ? null : current;
      }

      if (current?.key === key && current.position === position) {
        return current;
      }

      return { key, position };
    });
  }, []);

  const handleRowDragEnd = useCallback(() => {
    setDragSourceKeys([]);
    setDropIndicator(null);
  }, []);

  const handleRowDrop = useCallback(
    (targetNode: FileTreeNode, position: DropPosition) => {
      const sourceKeys = dragSourceKeys;
      setDragSourceKeys([]);
      setDropIndicator(null);

      if (sourceKeys.length === 0) {
        return;
      }

      const targetKey = getNodeKey(targetNode);

      if (sourceKeys.includes(targetKey)) {
        return;
      }

      const topLevelSourceNodes = getTopLevelSelection(sourceKeys, flatNodes);

      if (
        topLevelSourceNodes.some(
          (sourceNode) =>
            sourceNode.kind === "folder" &&
            isDescendantRelativePath(sourceNode.relativePath, targetNode.relativePath)
        )
      ) {
        return;
      }

      void (async () => {
        let targetParentDirectory: string;
        let targetIndex: number;

        if (position === "into" && targetNode.kind === "folder") {
          targetParentDirectory = await join(folderPath, targetNode.relativePath);
          targetIndex = targetNode.children.length;
        } else {
          const context = nodeContextByKey.get(targetKey);

          if (!context) {
            return;
          }

          targetParentDirectory = context.parentRelativePath
            ? await join(folderPath, context.parentRelativePath)
            : folderPath;

          targetIndex = position === "above" ? context.indexInSiblings : context.indexInSiblings + 1;

          const firstSourceContext = nodeContextByKey.get(getNodeKey(topLevelSourceNodes[0]));

          if (
            firstSourceContext &&
            firstSourceContext.parentRelativePath === context.parentRelativePath &&
            firstSourceContext.indexInSiblings < context.indexInSiblings
          ) {
            targetIndex -= 1;
          }
        }

        // Sequential awaits: moveTreeEntry reads fresh state via get() per
        // call, so parallel calls would clobber each other's writes.
        for (const sourceNode of topLevelSourceNodes) {
          const sourcePath = await join(folderPath, sourceNode.relativePath);
          const didMove = await onMoveEntry({
            kind: sourceNode.kind,
            sourcePath,
            targetParentDirectory,
            targetIndex
          });

          if (didMove) {
            targetIndex += 1;
          }
        }

        setSelectedKeys(new Set());
      })();
    },
    [dragSourceKeys, flatNodes, folderPath, nodeContextByKey, onMoveEntry]
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
