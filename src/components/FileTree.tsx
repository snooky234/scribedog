import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  ChevronDown,
  ChevronRight,
  FilePlus,
  FileText,
  Folder,
  FolderOpen,
  Pencil,
  Trash2
} from "lucide-react";
import { useTranslation } from "react-i18next";
import { dirname, join } from "@tauri-apps/api/path";

import { cn } from "@/lib/utils";
import { getRelativeDisplayPath } from "@/lib/fileSystem";
import {
  buildFileTree,
  getAncestorFolderPaths,
  getStoredExpandedFolderPaths,
  setStoredExpandedFolderPaths,
  type FileTreeNode
} from "@/lib/fileTree";

const INDENT_BASE_REM = 0.5;
const INDENT_STEP_REM = 0.9;

export type PendingFolderRename = {
  folderPath: string;
  requestId: number;
};

type FileTreeProps = {
  folderPath: string;
  filePaths: string[];
  emptyFolderPaths: string[];
  selectedFilePath: string | null;
  dirtyFilePaths: string[];
  pendingFolderRename?: PendingFolderRename | null;
  onSelectFilePath: (filePath: string) => Promise<void>;
  onCreateFileRequest: (targetDirectory: string) => void;
  onDeleteFileRequest: (filePath: string) => void;
  onDeleteFolderRequest: (folderPath: string) => void;
  onRenameFolder: (folderPath: string, newBaseName: string) => Promise<boolean>;
  onRenameFile: (filePath: string, newBaseName: string) => Promise<boolean>;
  onRequestEditorFocus?: () => void;
  focusRequestId?: number;
};

function getNodeKey(node: FileTreeNode): string {
  return `${node.kind}:${node.relativePath}`;
}

// For arrow-key navigation, the visible tree (collapsed folders are skipped)
// is flattened into the same order as the rendering, so up/down follows
// exactly the rows currently visible.
function flattenVisibleNodes(
  nodes: FileTreeNode[],
  expandedFolderPaths: Set<string>
): FileTreeNode[] {
  const result: FileTreeNode[] = [];

  const visit = (list: FileTreeNode[]) => {
    for (const node of list) {
      result.push(node);

      if (node.kind === "folder" && expandedFolderPaths.has(node.relativePath)) {
        visit(node.children);
      }
    }
  };

  visit(nodes);

  return result;
}

type FileContextMenuState =
  | { kind: "file"; filePath: string; x: number; y: number }
  | { kind: "folder"; relativePath: string; x: number; y: number };

type RenamingTarget =
  | { kind: "file"; relativePath: string }
  | { kind: "folder"; relativePath: string };

type TreeNodeRowProps = {
  node: FileTreeNode;
  depth: number;
  expandedFolderPaths: Set<string>;
  selectedFilePath: string | null;
  dirtyFilePaths: string[];
  activeKey: string | null;
  renamingTarget: RenamingTarget | null;
  renameDraft: string;
  renameInputRef: React.RefObject<HTMLInputElement>;
  onToggleFolder: (relativePath: string) => void;
  onSelectFilePath: (filePath: string) => Promise<void>;
  onFileContextMenu: (filePath: string, x: number, y: number) => void;
  onFolderContextMenu: (relativePath: string, x: number, y: number) => void;
  onActivateNode: (node: FileTreeNode) => void;
  onRenameDraftChange: (value: string) => void;
  onCommitRename: () => void;
  onCancelRename: () => void;
  registerItemRef: (key: string, element: HTMLButtonElement | null) => void;
};

function TreeNodeRow({
  node,
  depth,
  expandedFolderPaths,
  selectedFilePath,
  dirtyFilePaths,
  activeKey,
  renamingTarget,
  renameDraft,
  renameInputRef,
  onToggleFolder,
  onSelectFilePath,
  onFileContextMenu,
  onFolderContextMenu,
  onActivateNode,
  onRenameDraftChange,
  onCommitRename,
  onCancelRename,
  registerItemRef
}: TreeNodeRowProps) {
  const { t } = useTranslation();
  const paddingLeft = `${INDENT_BASE_REM + depth * INDENT_STEP_REM}rem`;
  const key = getNodeKey(node);
  // Roving tabindex: only the active row is reachable via Tab, all others are
  // focused with arrow keys (see handleTreeKeyDown).
  const tabIndex = activeKey === key ? 0 : -1;

  if (node.kind === "folder") {
    const isExpanded = expandedFolderPaths.has(node.relativePath);
    const isRenaming = renamingTarget?.kind === "folder" && renamingTarget.relativePath === node.relativePath;

    return (
      <li role="none">
        {isRenaming ? (
          <div
            className="file-tree__row file-tree__row--folder file-tree__row--renaming"
            style={{ paddingLeft }}
          >
            <span className="file-tree__chevron" aria-hidden="true">
              {isExpanded ? <ChevronDown /> : <ChevronRight />}
            </span>
            {isExpanded ? <FolderOpen aria-hidden="true" /> : <Folder aria-hidden="true" />}
            <input
              ref={renameInputRef}
              type="text"
              className="file-tree__rename-input"
              value={renameDraft}
              onFocus={(event) => event.currentTarget.select()}
              onChange={(event) => onRenameDraftChange(event.target.value)}
              onKeyDown={(event) => {
                event.stopPropagation();

                if (event.key === "Enter") {
                  event.preventDefault();
                  onCommitRename();
                } else if (event.key === "Escape") {
                  event.preventDefault();
                  onCancelRename();
                }
              }}
              onBlur={onCommitRename}
              aria-label={t("fileTree.renameInputLabel")}
              spellCheck={false}
            />
          </div>
        ) : (
          <button
            type="button"
            role="treeitem"
            aria-expanded={isExpanded}
            className="file-tree__row file-tree__row--folder"
            style={{ paddingLeft }}
            title={node.relativePath}
            tabIndex={tabIndex}
            ref={(element) => registerItemRef(key, element)}
            onClick={() => {
              onActivateNode(node);
              onToggleFolder(node.relativePath);
            }}
            onContextMenu={(event) => {
              event.preventDefault();
              onFolderContextMenu(node.relativePath, event.clientX, event.clientY);
            }}
          >
            <span className="file-tree__chevron" aria-hidden="true">
              {isExpanded ? <ChevronDown /> : <ChevronRight />}
            </span>
            {isExpanded ? <FolderOpen aria-hidden="true" /> : <Folder aria-hidden="true" />}
            <span className="file-tree__name">{node.name}</span>
          </button>
        )}

        {isExpanded ? (
          <ul role="group" className="file-tree__group">
            {node.children.map((child) => (
              <TreeNodeRow
                key={child.relativePath}
                node={child}
                depth={depth + 1}
                expandedFolderPaths={expandedFolderPaths}
                selectedFilePath={selectedFilePath}
                dirtyFilePaths={dirtyFilePaths}
                activeKey={activeKey}
                renamingTarget={renamingTarget}
                renameDraft={renameDraft}
                renameInputRef={renameInputRef}
                onToggleFolder={onToggleFolder}
                onSelectFilePath={onSelectFilePath}
                onFileContextMenu={onFileContextMenu}
                onFolderContextMenu={onFolderContextMenu}
                onActivateNode={onActivateNode}
                onRenameDraftChange={onRenameDraftChange}
                onCommitRename={onCommitRename}
                onCancelRename={onCancelRename}
                registerItemRef={registerItemRef}
              />
            ))}
          </ul>
        ) : null}
      </li>
    );
  }

  const isSelected = node.filePath === selectedFilePath;
  const isDirty = dirtyFilePaths.includes(node.filePath);
  const isRenaming = renamingTarget?.kind === "file" && renamingTarget.relativePath === node.relativePath;

  return (
    <li role="none">
      {isRenaming ? (
        <div
          className="file-tree__row file-tree__row--file file-tree__row--renaming"
          style={{ paddingLeft }}
        >
          <span className="file-tree__chevron" aria-hidden="true" />
          <FileText aria-hidden="true" />
          <input
            ref={renameInputRef}
            type="text"
            className="file-tree__rename-input"
            value={renameDraft}
            onFocus={(event) => event.currentTarget.select()}
            onChange={(event) => onRenameDraftChange(event.target.value)}
            onKeyDown={(event) => {
              event.stopPropagation();

              if (event.key === "Enter") {
                event.preventDefault();
                onCommitRename();
              } else if (event.key === "Escape") {
                event.preventDefault();
                onCancelRename();
              }
            }}
            onBlur={onCommitRename}
            aria-label={t("fileTree.fileRenameInputLabel")}
            spellCheck={false}
          />
          <span className="file-tree__rename-suffix">.md</span>
        </div>
      ) : (
        <button
          type="button"
          role="treeitem"
          aria-selected={isSelected}
          className={cn(
            "file-tree__row file-tree__row--file",
            isSelected && "file-tree__row--active"
          )}
          style={{ paddingLeft }}
          title={node.relativePath}
          tabIndex={tabIndex}
          ref={(element) => registerItemRef(key, element)}
          onClick={() => {
            onActivateNode(node);
            onSelectFilePath(node.filePath);
          }}
          onContextMenu={(event) => {
            event.preventDefault();
            onFileContextMenu(node.filePath, event.clientX, event.clientY);
          }}
        >
          <span className="file-tree__chevron" aria-hidden="true" />
          <FileText aria-hidden="true" />
          <span className="file-tree__name">{node.name}</span>
          {isDirty ? (
            <span
              className="sidebar-panel__item-dirty"
              title={t("fileTree.unsavedChanges")}
              aria-label={t("fileTree.unsavedChanges")}
            />
          ) : null}
        </button>
      )}
    </li>
  );
}

export function FileTree({
  folderPath,
  filePaths,
  emptyFolderPaths,
  selectedFilePath,
  dirtyFilePaths,
  pendingFolderRename,
  onSelectFilePath,
  onCreateFileRequest,
  onDeleteFileRequest,
  onDeleteFolderRequest,
  onRenameFolder,
  onRenameFile,
  onRequestEditorFocus,
  focusRequestId
}: FileTreeProps) {
  const { t } = useTranslation();
  const [expandedFolderPaths, setExpandedFolderPaths] = useState<Set<string>>(() =>
    getStoredExpandedFolderPaths(folderPath)
  );
  const [contextMenu, setContextMenu] = useState<FileContextMenuState | null>(null);
  const [activeKey, setActiveKey] = useState<string | null>(null);
  const [renamingTarget, setRenamingTarget] = useState<RenamingTarget | null>(null);
  const [renameDraft, setRenameDraft] = useState("");
  const itemRefs = useRef<Map<string, HTMLButtonElement>>(new Map());
  const renameInputRef = useRef<HTMLInputElement>(null);
  const skipRenameCommitRef = useRef(false);
  // Last handled request value instead of a bool guard: StrictMode-safe, same
  // pattern as in Editor.tsx (duplicate mount effects would otherwise focus
  // unintentionally on the second run).
  const lastHandledFocusRequestRef = useRef(focusRequestId);
  const lastHandledFolderRenameRequestIdRef = useRef<number | undefined>(undefined);

  const treeNodes = useMemo(() => {
    const records = filePaths.map((filePath) => ({
      filePath,
      relativePath: getRelativeDisplayPath(folderPath, filePath)
    }));
    const emptyFolderRelativePaths = emptyFolderPaths.map((emptyFolderPath) =>
      getRelativeDisplayPath(folderPath, emptyFolderPath)
    );

    return buildFileTree(records, emptyFolderRelativePaths);
  }, [folderPath, filePaths, emptyFolderPaths]);

  const flatNodes = useMemo(
    () => flattenVisibleNodes(treeNodes, expandedFolderPaths),
    [treeNodes, expandedFolderPaths]
  );

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

  const handleActivateNode = (node: FileTreeNode) => {
    setActiveKey(getNodeKey(node));
  };

  const handleTreeKeyDown = (event: React.KeyboardEvent<HTMLUListElement>) => {
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      if (flatNodes.length === 0) {
        return;
      }

      event.preventDefault();

      const currentIndex = activeKey
        ? flatNodes.findIndex((node) => getNodeKey(node) === activeKey)
        : -1;

      const nextIndex =
        currentIndex === -1
          ? 0
          : Math.min(
              Math.max(currentIndex + (event.key === "ArrowDown" ? 1 : -1), 0),
              flatNodes.length - 1
            );

      const nextKey = getNodeKey(flatNodes[nextIndex]);

      setActiveKey(nextKey);
      itemRefs.current.get(nextKey)?.focus();
      return;
    }

    if (event.key === "Tab" && !event.shiftKey) {
      event.preventDefault();
      onRequestEditorFocus?.();
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
            dirtyFilePaths={dirtyFilePaths}
            activeKey={activeKey}
            renamingTarget={renamingTarget}
            renameDraft={renameDraft}
            renameInputRef={renameInputRef}
            onToggleFolder={toggleFolder}
            onSelectFilePath={onSelectFilePath}
            onFileContextMenu={(filePath, x, y) => setContextMenu({ kind: "file", filePath, x, y })}
            onFolderContextMenu={(relativePath, x, y) =>
              setContextMenu({ kind: "folder", relativePath, x, y })
            }
            onActivateNode={handleActivateNode}
            onRenameDraftChange={setRenameDraft}
            onCommitRename={() => void commitRename()}
            onCancelRename={cancelRename}
            registerItemRef={registerItemRef}
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
            </div>,
            document.body
          )
        : null}
    </>
  );
}
