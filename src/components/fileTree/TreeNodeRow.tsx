import type { ReactNode } from "react";

import {
  ChevronDown,
  ChevronRight,
  Ellipsis,
  FileText,
  Folder,
  FolderOpen,
  PawPrint
} from "lucide-react";
import { useTranslation } from "react-i18next";

import { cn } from "@/lib/utils";
import { vaultPathKey } from "@/lib/chat/vaultStaging";
import { carriesExternalFiles } from "@/lib/dragDrop/droppedSources";
import { FILE_LINK_DRAG_MIME, getLinkableFilePath, TREE_NODE_DRAG_MIME } from "@/lib/editor/fileLinks";
import { getNodeMtimeMs, type FileTreeFolderNode, type FileTreeNode } from "@/lib/fileTree";
import { getNoteDisplayName } from "@/lib/folderNotes";
import { getVaultIcon, type VaultIconMap } from "@/lib/vaultIcons";
import type { SortMode } from "@/lib/vaultMeta";
import { DROP_DIRECTORY_ATTRIBUTE, useImportDropStore } from "@/store/useImportDropStore";
import { getVaultCapabilities } from "@/platform";
import type { PinToggleAction } from "@/store/appStore/workingSet";
import { useSearchStore } from "@/store/useSearchStore";

import {
  formatModifiedLabel,
  getNodeKey,
  INDENT_BASE_REM,
  INDENT_STEP_REM
} from "./treeNavigation";
import { PinToggle } from "./PinToggle";
import type { DropIndicator, DropPosition, RenamingTarget } from "./types";

type TreeNodeRowProps = {
  node: FileTreeNode;
  depth: number;
  expandedFolderPaths: Set<string>;
  /**
   * Search hits per folder, summed over its subtree (see buildFolderMatchCounts).
   * Passed down instead of read from the store, because a row cannot aggregate
   * its own subtree without re-walking it on every render.
   */
  folderMatchCounts: Record<string, number>;
  /**
   * The vault agent's proposals, in the three forms a row has to distinguish:
   * something is staged for this file at all, the file does not exist yet, the
   * file is staged for deletion. Keyed like everywhere else in the staging
   * layer (slashes normalized, lowercased — Windows).
   */
  folderStagedCounts: Record<string, number>;
  /** Dirty notes per folder subtree, the folder's own note included. */
  folderDirtyCounts: Record<string, number>;
  stagedKeys: Set<string>;
  stagedCreatedKeys: Set<string>;
  stagedDeletedKeys: Set<string>;
  selectedFilePath: string | null;
  selectedKeys: Set<string>;
  dirtyFilePaths: string[];
  /**
   * Folder notes (lib/folderNotes.ts). With them on, a folder row is also the
   * row of the folder's note: the name opens it, the chevron toggles, and the
   * open/unsaved markers of the note land here. Both sets hold relative folder
   * paths, computed once in FileTree.
   */
  folderNotesEnabled: boolean;
  activeFolderNotePath: string | null;
  dirtyFolderNotePaths: Set<string>;
  /** What the pin of the note at this absolute path would do (workingSet.ts). */
  describePinToggle: (filePath: string) => PinToggleAction;
  onTogglePin: (filePath: string) => void;
  /** Only for the folder row's tooltip; FileTree decides what a click does. */
  openOnDoubleClick: boolean;
  activeKey: string | null;
  renamingTarget: RenamingTarget | null;
  renameDraft: string;
  renameInputRef: React.RefObject<HTMLInputElement | null>;
  /** Per-entry icons, keyed vault-relative (lib/vaultIcons.ts). */
  vaultIcons: VaultIconMap;
  sortMode: SortMode;
  dragSourceKeys: string[];
  dropIndicator: DropIndicator | null;
  onRowClick: (node: FileTreeNode, event: React.MouseEvent) => void;
  /** Double-click on a note (or a folder's note row): pins it, or opens it where a click only marks. */
  onRowDoubleClick: (node: FileTreeNode) => void;
  /** The chevron's own click, once the row itself opens the note. */
  onToggleFolder: (node: FileTreeFolderNode) => void;
  onRowContextMenu: (node: FileTreeNode, x: number, y: number) => void;
  onRenameDraftChange: (value: string) => void;
  onCommitRename: () => void;
  onCancelRename: () => void;
  registerItemRef: (key: string, element: HTMLButtonElement | null) => void;
  onRowDragStart: (node: FileTreeNode) => void;
  onRowDropIndicatorChange: (key: string, position: DropPosition | null) => void;
  onRowDrop: (node: FileTreeNode, position: DropPosition) => void;
  onRowDragEnd: () => void;
  /** Absolute paths this drag carries — the row itself, or the whole selection. */
  resolveDragFilePaths: (node: FileTreeNode) => string[];
};

/**
 * A row's icon: the emoji the user picked for this entry, or the default
 * lucide glyph for its kind. Every row carries one — a tree where only some
 * rows have an icon reads as broken rather than as customized, and the
 * default is also what the user clicks to pick an icon in the first place.
 *
 * Rendered as an image role with an empty alt: the name next to it already
 * says which entry this is, and "📕 emoji, Rezepte" is noise in a screen
 * reader walking a file list.
 */
function RowIcon({ icon, fallback }: { icon: string | null; fallback: ReactNode }) {
  if (icon) {
    return (
      <span className="file-tree__icon file-tree__icon--emoji" aria-hidden="true">
        {icon}
      </span>
    );
  }

  return <span className="file-tree__icon">{fallback}</span>;
}

const PIN_TOGGLE_LABEL_KEYS: Record<PinToggleAction, string> = {
  pin: "fileTree.pinWorkingSet",
  unpin: "fileTree.unpinWorkingSet",
  close: "fileTree.closeWorkingSet"
};

/**
 * The row's context menu without a right-click. Only shown for a coarse
 * pointer (file-tree.css): a finger cannot right-click, and a long press is
 * the browser's own gesture on both platforms. A sibling of the row button,
 * not a child, since a button may not contain another.
 */
function RowMoreButton({ onOpen }: { onOpen: (x: number, y: number) => void }) {
  const { t } = useTranslation();

  return (
    <button
      type="button"
      className="file-tree__more"
      aria-label={t("fileTree.moreActions")}
      title={t("fileTree.moreActions")}
      data-testid="row-more"
      onClick={(event) => {
        // The tree's context menu closes on any window click; the one that
        // opens it must not reach that listener.
        event.stopPropagation();
        const rect = event.currentTarget.getBoundingClientRect();
        onOpen(rect.left, rect.bottom);
      }}
    >
      <Ellipsis aria-hidden="true" />
    </button>
  );
}

export function TreeNodeRow({
  node,
  depth,
  expandedFolderPaths,
  folderMatchCounts,
  folderStagedCounts,
  folderDirtyCounts,
  stagedKeys,
  stagedCreatedKeys,
  stagedDeletedKeys,
  selectedFilePath,
  selectedKeys,
  dirtyFilePaths,
  folderNotesEnabled,
  activeFolderNotePath,
  dirtyFolderNotePaths,
  describePinToggle,
  onTogglePin,
  openOnDoubleClick,
  activeKey,
  renamingTarget,
  renameDraft,
  renameInputRef,
  vaultIcons,
  sortMode,
  dragSourceKeys,
  dropIndicator,
  onRowClick,
  onRowDoubleClick,
  onToggleFolder,
  onRowContextMenu,
  onRenameDraftChange,
  onCommitRename,
  onCancelRename,
  registerItemRef,
  onRowDragStart,
  onRowDropIndicatorChange,
  onRowDrop,
  onRowDragEnd,
  resolveDragFilePaths
}: TreeNodeRowProps) {
  const { t, i18n } = useTranslation();
  // Badge for the currently active project-wide search: number of matches
  // in this file (0 hides the badge and the row highlight).
  const searchMatchCount = useSearchStore((state) =>
    node.kind === "file" ? state.fileMatchCounts[node.filePath] ?? 0 : 0
  );
  // Same badge for folders, but cumulative over the subtree — and only shown
  // while the folder is collapsed. Expanded, the per-file counts are visible
  // anyway, and the identical hits stacked on every ancestor would read like a
  // broken sum. The folder row deliberately gets no --search-match tint: every
  // ancestor up to the root matches, which would wash out the whole sidebar.
  const folderMatchCount =
    node.kind === "folder" ? folderMatchCounts[node.relativePath] ?? 0 : 0;
  // Hits in the folder's own note. They are part of the collapsed sum above;
  // expanded, they would be the one count nowhere on screen, so the row shows
  // them on its own then.
  const folderNoteMatchCount = useSearchStore((state) =>
    node.kind === "folder" && node.folderNotePath
      ? state.fileMatchCounts[node.folderNotePath] ?? 0
      : 0
  );
  // The paw. On a folder it is cumulative over the subtree and only shown while
  // the folder is collapsed — expanded, the files carry their own, and the same
  // marker repeated on every ancestor would say nothing.
  const stagedKey = node.kind === "file" ? vaultPathKey(node.filePath) : "";
  const hasStagedChange = node.kind === "file" && stagedKeys.has(stagedKey);
  const isStagedNew = node.kind === "file" && stagedCreatedKeys.has(stagedKey);
  const isStagedDeleted = node.kind === "file" && stagedDeletedKeys.has(stagedKey);
  const folderStagedCount =
    node.kind === "folder" ? folderStagedCounts[node.relativePath] ?? 0 : 0;
  // Where a drop from outside the app imports to: a folder takes the drop
  // itself, a file hands it to the folder it lives in. Only folders light up
  // for it — every file in the root would otherwise highlight for the same
  // target. The drop itself is handled by the panel (see Sidebar.tsx).
  const dropDirectory =
    node.kind === "folder"
      ? node.relativePath
      : node.relativePath.split("/").slice(0, -1).join("/");
  const isImportDropTarget = useImportDropStore(
    (state) => node.kind === "folder" && state.targetDirectory === node.relativePath
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

  // Reordering and moving inside the tree only works in manual sort mode; a
  // file, and a folder with a folder note, can always be dragged, because
  // dropping it into the editor inserts a link to it (see lib/editor/fileLinks.ts).
  const isReorderEnabled = sortMode === "manual" && getVaultCapabilities().move;
  const isDragEnabled = isReorderEnabled || getLinkableFilePath(node, folderNotesEnabled) !== null;
  const isDragSource = dragSourceKeys.includes(key);
  const isMultiSelected = selectedKeys.has(key);
  const activeDropPosition = dropIndicator?.key === key ? dropIndicator.position : null;

  const dragOutHandlers = isDragEnabled
    ? {
        draggable: true,
        onDragStart: (event: React.DragEvent<HTMLButtonElement>) => {
          const draggedFilePaths = resolveDragFilePaths(node);

          event.dataTransfer.effectAllowed = isReorderEnabled ? "copyMove" : "copy";
          event.dataTransfer.setData(TREE_NODE_DRAG_MIME, key);

          if (draggedFilePaths.length > 0) {
            event.dataTransfer.setData("text/plain", draggedFilePaths.join("\n"));
            event.dataTransfer.setData(FILE_LINK_DRAG_MIME, JSON.stringify(draggedFilePaths));
          }

          onRowDragStart(node);
        },
        onDragEnd: () => {
          onRowDragEnd();
        }
      }
    : {};

  const dropTargetHandlers = isReorderEnabled
    ? {
        onDragOver: (event: React.DragEvent<HTMLButtonElement>) => {
          // Files from outside the app are an import, not a move: the event is
          // left alone so it reaches the panel's own handler, which marks the
          // target folder and takes the drop.
          if (carriesExternalFiles(event.dataTransfer)) {
            return;
          }

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
          if (carriesExternalFiles(event.dataTransfer)) {
            return;
          }

          event.preventDefault();
          event.stopPropagation();
          onRowDrop(node, activeDropPosition ?? "below");
        }
      }
    : {};

  const dragHandlers = { ...dragOutHandlers, ...dropTargetHandlers };

  if (node.kind === "folder") {
    const isExpanded = expandedFolderPaths.has(node.relativePath);
    const isRenaming = renamingTarget?.kind === "folder" && renamingTarget.relativePath === node.relativePath;
    const isNoteActive = folderNotesEnabled && activeFolderNotePath === node.relativePath;
    const isNoteDirty = folderNotesEnabled && dirtyFolderNotePaths.has(node.relativePath);
    // Only a written folder note gets the pin on the row: offered on every
    // folder it would pin notes that do not exist yet. Shift+Enter still can.
    const folderNotePath = folderNotesEnabled ? node.folderNotePath : undefined;
    // The ring says "something *inside*"; the folder's own note has the
    // filled dot for itself, so it is taken out of the count.
    const hasDirtyInside =
      !isExpanded && (folderDirtyCounts[node.relativePath] ?? 0) - (isNoteDirty ? 1 : 0) > 0;
    const shownMatchCount = isExpanded ? folderNoteMatchCount : folderMatchCount;

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
            <RowIcon
              icon={getVaultIcon(vaultIcons, node.relativePath)}
              fallback={isExpanded ? <FolderOpen aria-hidden="true" /> : <Folder aria-hidden="true" />}
            />
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
            aria-selected={isNoteActive || isMultiSelected}
            className={cn(
              "file-tree__row file-tree__row--folder",
              folderNotesEnabled && "file-tree__row--folder-note",
              isNoteActive && "file-tree__row--active",
              isMultiSelected && "file-tree__row--selected",
              isDragSource && "file-tree__row--drag-source",
              activeDropPosition === "above" && "file-tree__row--drop-above",
              activeDropPosition === "below" && "file-tree__row--drop-below",
              activeDropPosition === "into" && "file-tree__row--drop-into",
              isImportDropTarget && "file-tree__row--drop-import"
            )}
            style={{ paddingLeft }}
            title={
              folderNotesEnabled
                ? t(openOnDoubleClick ? "fileTree.openFolderNoteDoubleClick" : "fileTree.openFolderNote", {
                    path: node.relativePath
                  })
                : node.relativePath
            }
            {...{ [DROP_DIRECTORY_ATTRIBUTE]: dropDirectory }}
            tabIndex={tabIndex}
            ref={(element) => registerItemRef(key, element)}
            onClick={(event) => onRowClick(node, event)}
            onDoubleClick={() => onRowDoubleClick(node)}
            onContextMenu={(event) => {
              event.preventDefault();
              onRowContextMenu(node, event.clientX, event.clientY);
            }}
            {...dragHandlers}
          >
            {/* A span, not a nested button (invalid inside the row's button):
                its click is stopped before it reaches the row, which with
                folder notes on would open the note instead of toggling. */}
            <span
              className={cn(
                "file-tree__chevron",
                folderNotesEnabled && "file-tree__chevron--toggle"
              )}
              aria-hidden="true"
              title={
                folderNotesEnabled
                  ? t(isExpanded ? "fileTree.collapseFolder" : "fileTree.expandFolder")
                  : undefined
              }
              onClick={
                folderNotesEnabled
                  ? (event) => {
                      event.stopPropagation();
                      onToggleFolder(node);
                    }
                  : undefined
              }
              // Unfolding and folding again quickly is no double-click on the note.
              onDoubleClick={folderNotesEnabled ? (event) => event.stopPropagation() : undefined}
            >
              {isExpanded ? <ChevronDown /> : <ChevronRight />}
            </span>
            <RowIcon
              icon={getVaultIcon(vaultIcons, node.relativePath)}
              fallback={isExpanded ? <FolderOpen aria-hidden="true" /> : <Folder aria-hidden="true" />}
            />
            <span className="file-tree__name">{node.name}</span>
            {shownMatchCount > 0 ? (
              <span
                className="file-tree__search-badge file-tree__search-badge--folder"
                title={t("findReplace.folderMatchBadge", { count: shownMatchCount })}
                aria-label={t("findReplace.folderMatchBadge", { count: shownMatchCount })}
              >
                {shownMatchCount}
              </span>
            ) : null}
            {!isExpanded && folderStagedCount > 0 ? (
              <PawPrint
                className="file-tree__paw"
                aria-label={t("fileTree.stagedChangeFolder", { count: folderStagedCount })}
              >
                <title>{t("fileTree.stagedChangeFolder", { count: folderStagedCount })}</title>
              </PawPrint>
            ) : null}
            {folderNotePath ? (
              <PinToggle
                action={describePinToggle(folderNotePath)}
                labelKeys={PIN_TOGGLE_LABEL_KEYS}
                onToggle={() => onTogglePin(folderNotePath)}
              />
            ) : null}
            {modifiedLabel ? <span className="file-tree__mtime">{modifiedLabel}</span> : null}
            {hasDirtyInside ? (
              <span
                className="sidebar-panel__item-dirty sidebar-panel__item-dirty--inside"
                title={t("fileTree.unsavedChangesInside")}
                aria-label={t("fileTree.unsavedChangesInside")}
              />
            ) : null}
            {isNoteDirty ? (
              <span
                className="sidebar-panel__item-dirty"
                title={t("fileTree.unsavedChanges")}
                aria-label={t("fileTree.unsavedChanges")}
              />
            ) : null}
          </button>
        )}
        {!isRenaming ? (
          <RowMoreButton onOpen={(x, y) => onRowContextMenu(node, x, y)} />
        ) : null}

        {isExpanded ? (
          <ul role="group" className="file-tree__group">
            {node.children.map((child) => (
              <TreeNodeRow
                key={child.relativePath}
                node={child}
                depth={depth + 1}
                expandedFolderPaths={expandedFolderPaths}
                folderMatchCounts={folderMatchCounts}
                folderStagedCounts={folderStagedCounts}
                folderDirtyCounts={folderDirtyCounts}
                stagedKeys={stagedKeys}
                stagedCreatedKeys={stagedCreatedKeys}
                stagedDeletedKeys={stagedDeletedKeys}
                selectedFilePath={selectedFilePath}
                selectedKeys={selectedKeys}
                dirtyFilePaths={dirtyFilePaths}
                folderNotesEnabled={folderNotesEnabled}
                activeFolderNotePath={activeFolderNotePath}
                dirtyFolderNotePaths={dirtyFolderNotePaths}
                describePinToggle={describePinToggle}
                onTogglePin={onTogglePin}
                openOnDoubleClick={openOnDoubleClick}
                activeKey={activeKey}
                renamingTarget={renamingTarget}
                renameDraft={renameDraft}
                renameInputRef={renameInputRef}
                vaultIcons={vaultIcons}
                sortMode={sortMode}
                dragSourceKeys={dragSourceKeys}
                dropIndicator={dropIndicator}
                onRowClick={onRowClick}
                onRowDoubleClick={onRowDoubleClick}
                onToggleFolder={onToggleFolder}
                onRowContextMenu={onRowContextMenu}
                onRenameDraftChange={onRenameDraftChange}
                onCommitRename={onCommitRename}
                onCancelRename={onCancelRename}
                registerItemRef={registerItemRef}
                onRowDragStart={onRowDragStart}
                onRowDropIndicatorChange={onRowDropIndicatorChange}
                onRowDrop={onRowDrop}
                onRowDragEnd={onRowDragEnd}
                resolveDragFilePaths={resolveDragFilePaths}
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
            isStagedNew && "file-tree__row--staged-new",
            isStagedDeleted && "file-tree__row--staged-deleted",
            isSelected && "file-tree__row--active",
            isMultiSelected && "file-tree__row--selected",
            isDragSource && "file-tree__row--drag-source",
            activeDropPosition === "above" && "file-tree__row--drop-above",
            activeDropPosition === "below" && "file-tree__row--drop-below"
          )}
          style={{ paddingLeft }}
          title={node.relativePath}
          {...{ [DROP_DIRECTORY_ATTRIBUTE]: dropDirectory }}
          tabIndex={tabIndex}
          ref={(element) => registerItemRef(key, element)}
          onClick={(event) => onRowClick(node, event)}
          onDoubleClick={() => onRowDoubleClick(node)}
          onContextMenu={(event) => {
            event.preventDefault();
            onRowContextMenu(node, event.clientX, event.clientY);
          }}
          {...dragHandlers}
        >
          <span className="file-tree__chevron" aria-hidden="true" />
          <RowIcon
            icon={getVaultIcon(vaultIcons, node.relativePath)}
            fallback={<FileText aria-hidden="true" />}
          />
          {/* Every note is a .md file, so the extension says nothing. */}
          <span className="file-tree__name">{getNoteDisplayName(node.name)}</span>
          {searchMatchCount > 0 ? (
            <span
              className="file-tree__search-badge"
              title={t("findReplace.fileMatchBadge", { count: searchMatchCount })}
              aria-label={t("findReplace.fileMatchBadge", { count: searchMatchCount })}
            >
              {searchMatchCount}
            </span>
          ) : null}
          {hasStagedChange ? (
            <PawPrint
              className="file-tree__paw"
              aria-label={t("fileTree.stagedChange")}
            >
              <title>{t("fileTree.stagedChange")}</title>
            </PawPrint>
          ) : null}
          <PinToggle
            action={describePinToggle(node.filePath)}
            labelKeys={PIN_TOGGLE_LABEL_KEYS}
            onToggle={() => onTogglePin(node.filePath)}
          />
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
      {!isRenaming ? (
        <RowMoreButton onOpen={(x, y) => onRowContextMenu(node, x, y)} />
      ) : null}
    </li>
  );
}
