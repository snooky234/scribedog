import {
  ChevronDown,
  ChevronRight,
  FileText,
  Folder,
  FolderOpen
} from "lucide-react";
import { useTranslation } from "react-i18next";

import { cn } from "@/lib/utils";
import { getNodeMtimeMs, type FileTreeNode } from "@/lib/fileTree";
import type { SortMode } from "@/lib/vaultMeta";
import { useSearchStore } from "@/store/useSearchStore";

import {
  formatModifiedLabel,
  getNodeKey,
  INDENT_BASE_REM,
  INDENT_STEP_REM
} from "./treeNavigation";
import type { DropIndicator, DropPosition, RenamingTarget } from "./types";

type TreeNodeRowProps = {
  node: FileTreeNode;
  depth: number;
  expandedFolderPaths: Set<string>;
  selectedFilePath: string | null;
  selectedKeys: Set<string>;
  dirtyFilePaths: string[];
  activeKey: string | null;
  renamingTarget: RenamingTarget | null;
  renameDraft: string;
  renameInputRef: React.RefObject<HTMLInputElement>;
  sortMode: SortMode;
  dragSourceKeys: string[];
  dropIndicator: DropIndicator | null;
  onRowClick: (node: FileTreeNode, event: React.MouseEvent) => void;
  onRowContextMenu: (node: FileTreeNode, x: number, y: number) => void;
  onRenameDraftChange: (value: string) => void;
  onCommitRename: () => void;
  onCancelRename: () => void;
  registerItemRef: (key: string, element: HTMLButtonElement | null) => void;
  onRowDragStart: (node: FileTreeNode) => void;
  onRowDropIndicatorChange: (key: string, position: DropPosition | null) => void;
  onRowDrop: (node: FileTreeNode, position: DropPosition) => void;
  onRowDragEnd: () => void;
};

export function TreeNodeRow({
  node,
  depth,
  expandedFolderPaths,
  selectedFilePath,
  selectedKeys,
  dirtyFilePaths,
  activeKey,
  renamingTarget,
  renameDraft,
  renameInputRef,
  sortMode,
  dragSourceKeys,
  dropIndicator,
  onRowClick,
  onRowContextMenu,
  onRenameDraftChange,
  onCommitRename,
  onCancelRename,
  registerItemRef,
  onRowDragStart,
  onRowDropIndicatorChange,
  onRowDrop,
  onRowDragEnd
}: TreeNodeRowProps) {
  const { t, i18n } = useTranslation();
  // Badge for the currently active project-wide search: number of matches
  // in this file (0 hides the badge and the row highlight).
  const searchMatchCount = useSearchStore((state) =>
    node.kind === "file" ? state.fileMatchCounts[node.filePath] ?? 0 : 0
  );
  const paddingLeft = `${INDENT_BASE_REM + depth * INDENT_STEP_REM}rem`;
  const key = getNodeKey(node);
  // Roving tabindex: only the active row is reachable via Tab, all others are
  // focused with arrow keys (see handleTreeKeyDown).
  const tabIndex = activeKey === key ? 0 : -1;
  const modifiedLabel =
    sortMode === "modified"
      ? formatModifiedLabel(getNodeMtimeMs(node), i18n.resolvedLanguage ?? i18n.language)
      : "";

  const isDragEnabled = sortMode === "manual";
  const isDragSource = dragSourceKeys.includes(key);
  const isMultiSelected = selectedKeys.has(key);
  const activeDropPosition = dropIndicator?.key === key ? dropIndicator.position : null;

  const dragHandlers = isDragEnabled
    ? {
        draggable: true,
        onDragStart: (event: React.DragEvent<HTMLButtonElement>) => {
          event.dataTransfer.effectAllowed = "move";
          event.dataTransfer.setData("text/plain", key);
          onRowDragStart(node);
        },
        onDragOver: (event: React.DragEvent<HTMLButtonElement>) => {
          event.preventDefault();
          event.dataTransfer.dropEffect = "move";

          const rect = event.currentTarget.getBoundingClientRect();
          const ratio = (event.clientY - rect.top) / rect.height;

          let position: DropPosition;

          if (node.kind === "folder" && ratio >= 0.25 && ratio <= 0.75) {
            position = "into";
          } else {
            position = ratio < 0.5 ? "above" : "below";
          }

          onRowDropIndicatorChange(key, position);
        },
        onDragLeave: () => {
          onRowDropIndicatorChange(key, null);
        },
        onDrop: (event: React.DragEvent<HTMLButtonElement>) => {
          event.preventDefault();
          event.stopPropagation();
          onRowDrop(node, activeDropPosition ?? "below");
        },
        onDragEnd: () => {
          onRowDragEnd();
        }
      }
    : {};

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
            aria-selected={isMultiSelected}
            className={cn(
              "file-tree__row file-tree__row--folder",
              isMultiSelected && "file-tree__row--selected",
              isDragSource && "file-tree__row--drag-source",
              activeDropPosition === "above" && "file-tree__row--drop-above",
              activeDropPosition === "below" && "file-tree__row--drop-below",
              activeDropPosition === "into" && "file-tree__row--drop-into"
            )}
            style={{ paddingLeft }}
            title={node.relativePath}
            tabIndex={tabIndex}
            ref={(element) => registerItemRef(key, element)}
            onClick={(event) => onRowClick(node, event)}
            onContextMenu={(event) => {
              event.preventDefault();
              onRowContextMenu(node, event.clientX, event.clientY);
            }}
            {...dragHandlers}
          >
            <span className="file-tree__chevron" aria-hidden="true">
              {isExpanded ? <ChevronDown /> : <ChevronRight />}
            </span>
            {isExpanded ? <FolderOpen aria-hidden="true" /> : <Folder aria-hidden="true" />}
            <span className="file-tree__name">{node.name}</span>
            {modifiedLabel ? <span className="file-tree__mtime">{modifiedLabel}</span> : null}
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
                selectedKeys={selectedKeys}
                dirtyFilePaths={dirtyFilePaths}
                activeKey={activeKey}
                renamingTarget={renamingTarget}
                renameDraft={renameDraft}
                renameInputRef={renameInputRef}
                sortMode={sortMode}
                dragSourceKeys={dragSourceKeys}
                dropIndicator={dropIndicator}
                onRowClick={onRowClick}
                onRowContextMenu={onRowContextMenu}
                onRenameDraftChange={onRenameDraftChange}
                onCommitRename={onCommitRename}
                onCancelRename={onCancelRename}
                registerItemRef={registerItemRef}
                onRowDragStart={onRowDragStart}
                onRowDropIndicatorChange={onRowDropIndicatorChange}
                onRowDrop={onRowDrop}
                onRowDragEnd={onRowDragEnd}
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
          aria-selected={isSelected || isMultiSelected}
          className={cn(
            "file-tree__row file-tree__row--file",
            searchMatchCount > 0 && "file-tree__row--search-match",
            isSelected && "file-tree__row--active",
            isMultiSelected && "file-tree__row--selected",
            isDragSource && "file-tree__row--drag-source",
            activeDropPosition === "above" && "file-tree__row--drop-above",
            activeDropPosition === "below" && "file-tree__row--drop-below"
          )}
          style={{ paddingLeft }}
          title={node.relativePath}
          tabIndex={tabIndex}
          ref={(element) => registerItemRef(key, element)}
          onClick={(event) => onRowClick(node, event)}
          onContextMenu={(event) => {
            event.preventDefault();
            onRowContextMenu(node, event.clientX, event.clientY);
          }}
          {...dragHandlers}
        >
          <span className="file-tree__chevron" aria-hidden="true" />
          <FileText aria-hidden="true" />
          <span className="file-tree__name">{node.name}</span>
          {searchMatchCount > 0 ? (
            <span
              className="file-tree__search-badge"
              title={t("findReplace.fileMatchBadge", { count: searchMatchCount })}
              aria-label={t("findReplace.fileMatchBadge", { count: searchMatchCount })}
            >
              {searchMatchCount}
            </span>
          ) : null}
          {modifiedLabel ? <span className="file-tree__mtime">{modifiedLabel}</span> : null}
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
