import { ChevronDown, ChevronRight, Ellipsis, Folder, ListX, Locate, Pin, PinOff, X } from "lucide-react";
import { useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import type {
  DragEvent as ReactDragEvent,
  KeyboardEvent as ReactKeyboardEvent,
  PointerEvent as ReactPointerEvent,
  RefObject
} from "react";

import { ContextMenuSurface } from "@/components/fileTree/ContextMenuSurface";
import type { DropPosition } from "@/components/fileTree/types";
import { useContextMenuState } from "@/components/fileTree/useContextMenuState";
import { FILE_LINK_DRAG_MIME } from "@/lib/editor/fileLinks";
import { getRelativeDisplayPath } from "@/lib/fileSystem";
import { getFolderNoteFolderPath, getNoteDisplayName, isFolderNotePath } from "@/lib/folderNotes";
import { cn } from "@/lib/utils";
import type { WorkingSetEntry } from "@/store/useAppStore";
import { useEditorSettingsStore } from "@/store/useEditorSettingsStore";

export type WorkingSetPanelProps = {
  folderPath: string;
  entries: WorkingSetEntry[];
  selectedFilePath: string | null;
  dirtyFilePaths: string[];
  collapsed: boolean;
  onToggleCollapsed: () => void;
  /** The tree below is folded away: the list may take the whole height. */
  fillsSidebar: boolean;
  /** Ceiling for the list's height; the list is as tall as its rows below it. */
  maxHeight: number;
  listRef: RefObject<HTMLUListElement | null>;
  onSelect: (filePath: string) => void;
  onClose: (filePath: string) => void;
  onCloseOthers: (filePath: string) => void;
  onCloseAll: () => void;
  onCloseSaved: () => void;
  onRevealInTree: (filePath: string) => void;
  onPin: (filePath: string) => void;
  onUnpin: (filePath: string) => void;
  /** Drag & drop: the entry goes in front of the one at `beforeIndex`. */
  onMove: (filePath: string, beforeIndex: number) => void;
};

type EntryContextMenu = { x: number; y: number; filePath: string };

type EntryDropIndicator = { filePath: string; position: Extract<DropPosition, "above" | "below"> };

/**
 * The "In progress" section above the file tree (store/appStore/workingSet.ts
 * has the rules of who is in it). One row per note: name, its folder in
 * small type, the dirty dot the tree uses, a pin where the user put one, and
 * a close button that shows on hover and focus. The header stays when the
 * section is folded, count and dot included, so a folded list still says
 * whether something is unsaved.
 */
export function WorkingSetPanel({
  folderPath,
  entries,
  selectedFilePath,
  dirtyFilePaths,
  collapsed,
  onToggleCollapsed,
  fillsSidebar,
  maxHeight,
  listRef,
  onSelect,
  onClose,
  onCloseOthers,
  onCloseAll,
  onCloseSaved,
  onRevealInTree,
  onPin,
  onUnpin,
  onMove
}: WorkingSetPanelProps) {
  const { t } = useTranslation();
  const { contextMenu, setContextMenu } = useContextMenuState<EntryContextMenu>();
  // With pin-only admission every entry is pinned, so the pin/unpin items
  // and "close saved" would say nothing; they show only once edited notes
  // can enter on their own. The pin mark itself always shows: it is what
  // tells someone who double-clicked by accident how the entry got here.
  const showPins = useEditorSettingsStore((state) => state.autoAdmitWorkingSet);
  const dirtySet = new Set(dirtyFilePaths);
  const hasDirty = entries.some((entry) => dirtySet.has(entry.filePath));
  const hasClosable = entries.some((entry) => !entry.pinned && !dirtySet.has(entry.filePath));
  const contextEntry = contextMenu ? entries.find((entry) => entry.filePath === contextMenu.filePath) : undefined;

  const describe = (filePath: string) => {
    const relativePath = getRelativeDisplayPath(folderPath, filePath);
    const folderRelativePath = isFolderNotePath(relativePath)
      ? getFolderNoteFolderPath(relativePath).split("/").slice(0, -1).join("/")
      : relativePath.split("/").slice(0, -1).join("/");

    return {
      name: getNoteDisplayName(relativePath),
      folder: folderRelativePath,
      relativePath,
      isFolderNote: isFolderNotePath(relativePath)
    };
  };

  const rowRefs = useRef(new Map<string, HTMLButtonElement>());

  // Arrow keys behave like in the tree below: the focus moves and the note
  // opens at once, no Enter needed. Home/End jump to the ends of the list.
  const handleRowKeyDown = (event: ReactKeyboardEvent<HTMLButtonElement>, filePath: string) => {
    if (event.key === "Delete") {
      event.preventDefault();
      onClose(filePath);
      return;
    }

    if (event.key !== "ArrowDown" && event.key !== "ArrowUp" && event.key !== "Home" && event.key !== "End") {
      return;
    }

    event.preventDefault();
    const index = entries.findIndex((entry) => entry.filePath === filePath);
    const nextIndex =
      event.key === "Home"
        ? 0
        : event.key === "End"
          ? entries.length - 1
          : Math.min(entries.length - 1, Math.max(0, index + (event.key === "ArrowDown" ? 1 : -1)));
    const next = entries[nextIndex];

    if (!next || next.filePath === filePath) {
      return;
    }

    rowRefs.current.get(next.filePath)?.focus();
    onSelect(next.filePath);
  };

  // Drag & drop reorders the list; the order is the user's from then on and
  // is stored with it. The drag also carries the note's path the way a tree
  // row does, so dropping a row into the editor or the chat still inserts a
  // link. Only a drag that started in this list is a reorder: one from the
  // tree or from outside the app passes through untouched.
  const [dragFilePath, setDragFilePath] = useState<string | null>(null);
  const [dropIndicator, setDropIndicator] = useState<EntryDropIndicator | null>(null);

  const resetDrag = () => {
    setDragFilePath(null);
    setDropIndicator(null);
  };

  const handleItemDragOver = (event: ReactDragEvent<HTMLLIElement>, filePath: string) => {
    if (!dragFilePath) {
      return;
    }

    event.preventDefault();
    event.dataTransfer.dropEffect = "move";

    if (filePath === dragFilePath) {
      setDropIndicator(null);
      return;
    }

    const rect = event.currentTarget.getBoundingClientRect();
    const position = event.clientY - rect.top < rect.height / 2 ? "above" : "below";

    setDropIndicator((current) =>
      current?.filePath === filePath && current.position === position ? current : { filePath, position }
    );
  };

  const handleItemDrop = (event: ReactDragEvent<HTMLLIElement>, filePath: string) => {
    if (!dragFilePath) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();

    const source = dragFilePath;
    const position = dropIndicator?.filePath === filePath ? dropIndicator.position : null;
    resetDrag();

    if (!position || source === filePath) {
      return;
    }

    const targetIndex = entries.findIndex((entry) => entry.filePath === filePath);

    if (targetIndex >= 0) {
      onMove(source, position === "above" ? targetIndex : targetIndex + 1);
    }
  };

  // Middle-click closes, like a browser tab; the button is read at pointer
  // time because auxclick does not fire for every pointing device.
  const handleRowPointerUp = (event: ReactPointerEvent<HTMLButtonElement>, filePath: string) => {
    if (event.button === 1) {
      event.preventDefault();
      onClose(filePath);
    }
  };

  return (
    <section
      className={cn("working-set", collapsed && "working-set--collapsed", fillsSidebar && "working-set--fills")}
      aria-label={t("workingSet.title")}
      data-testid="working-set"
    >
      <div className="working-set__header">
        <button
          type="button"
          className="working-set__toggle"
          onClick={onToggleCollapsed}
          aria-expanded={!collapsed}
          aria-controls="working-set-list"
        >
          {collapsed ? <ChevronRight aria-hidden="true" /> : <ChevronDown aria-hidden="true" />}
          <span className="working-set__title">{t("workingSet.title")}</span>
          <span className="working-set__count">{entries.length}</span>
          {hasDirty ? (
            <span
              className="sidebar-panel__item-dirty"
              title={t("fileTree.unsavedChanges")}
              aria-label={t("fileTree.unsavedChanges")}
            />
          ) : null}
        </button>
        {showPins ? (
          <button
            type="button"
            className="working-set__header-action"
            onClick={onCloseSaved}
            disabled={!hasClosable}
            aria-label={t("workingSet.closeSaved")}
            title={t("workingSet.closeSaved")}
          >
            <ListX aria-hidden="true" />
          </button>
        ) : null}
      </div>

      {collapsed ? null : (
        <ul
          id="working-set-list"
          ref={listRef}
          className="working-set__list"
          role="list"
          style={fillsSidebar ? undefined : { maxHeight }}
        >
          {entries.map((entry) => {
            const { name, folder, relativePath, isFolderNote } = describe(entry.filePath);
            const isActive = entry.filePath === selectedFilePath;
            const isDirty = dirtySet.has(entry.filePath);
            const dropPosition = dropIndicator?.filePath === entry.filePath ? dropIndicator.position : null;

            return (
              <li
                key={entry.filePath}
                className={cn(
                  "working-set__item",
                  dragFilePath === entry.filePath && "working-set__item--drag-source",
                  dropPosition && `working-set__item--drop-${dropPosition}`
                )}
                onDragOver={(event) => handleItemDragOver(event, entry.filePath)}
                onDragLeave={(event) => {
                  // Moving between the row and its close button is no leave.
                  if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
                    setDropIndicator((current) => (current?.filePath === entry.filePath ? null : current));
                  }
                }}
                onDrop={(event) => handleItemDrop(event, entry.filePath)}
              >
                <button
                  type="button"
                  draggable
                  onDragStart={(event) => {
                    event.dataTransfer.effectAllowed = "copyMove";
                    event.dataTransfer.setData("text/plain", entry.filePath);
                    event.dataTransfer.setData(FILE_LINK_DRAG_MIME, JSON.stringify([entry.filePath]));
                    setContextMenu(null);
                    setDragFilePath(entry.filePath);
                  }}
                  onDragEnd={resetDrag}
                  ref={(element) => {
                    if (element) {
                      rowRefs.current.set(entry.filePath, element);
                    } else {
                      rowRefs.current.delete(entry.filePath);
                    }
                  }}
                  className={cn("working-set__row", isActive && "working-set__row--active")}
                  title={relativePath}
                  aria-current={isActive ? "true" : undefined}
                  onClick={() => onSelect(entry.filePath)}
                  onPointerUp={(event) => handleRowPointerUp(event, entry.filePath)}
                  onAuxClick={(event) => event.preventDefault()}
                  onKeyDown={(event) => handleRowKeyDown(event, entry.filePath)}
                  onContextMenu={(event) => {
                    event.preventDefault();
                    setContextMenu({ x: event.clientX, y: event.clientY, filePath: entry.filePath });
                  }}
                >
                  <span className="working-set__text">
                    {/* A folder note and a note of the same name next to it
                        would read the same; the tree tells them apart by
                        their icon, so this list does too. */}
                    <span className="working-set__name">
                      {isFolderNote ? (
                        <Folder className="working-set__kind" aria-label={t("app.folderNoteBadge")}>
                          <title>{t("app.folderNoteBadge")}</title>
                        </Folder>
                      ) : null}
                      {name}
                    </span>
                    {folder ? <span className="working-set__folder">{folder}</span> : null}
                  </span>
                  {entry.pinned ? (
                    <Pin className="working-set__pin" aria-label={t("workingSet.pinned")}>
                      <title>{t("workingSet.pinned")}</title>
                    </Pin>
                  ) : null}
                  {isDirty ? (
                    <span
                      className="sidebar-panel__item-dirty"
                      title={t("fileTree.unsavedChanges")}
                      aria-label={t("fileTree.unsavedChanges")}
                    />
                  ) : null}
                </button>
                <button
                  type="button"
                  className="working-set__close"
                  onClick={(event) => {
                    event.stopPropagation();
                    onClose(entry.filePath);
                  }}
                  aria-label={t("workingSet.close", { name })}
                  title={t("workingSet.closeShort")}
                >
                  <X aria-hidden="true" />
                </button>
                {/* Touch: no hover for the cross and no right-click, so the
                    same "…" the tree rows carry opens the menu as a sheet
                    (shown by responsive.css on coarse pointers only). */}
                <button
                  type="button"
                  className="file-tree__more working-set__more"
                  aria-label={t("fileTree.moreActions")}
                  title={t("fileTree.moreActions")}
                  onClick={(event) => {
                    // The menu closes on any window click; the one that
                    // opens it must not reach that listener.
                    event.stopPropagation();
                    const rect = event.currentTarget.getBoundingClientRect();
                    setContextMenu({ x: rect.left, y: rect.bottom, filePath: entry.filePath });
                  }}
                >
                  <Ellipsis aria-hidden="true" />
                </button>
              </li>
            );
          })}
        </ul>
      )}

      {contextMenu && contextEntry ? (
        <ContextMenuSurface
          x={contextMenu.x}
          y={contextMenu.y}
          title={describe(contextEntry.filePath).name}
          onClick={(event) => event.stopPropagation()}
        >
          <button
            type="button"
            role="menuitem"
            className="file-tree-context-menu__item"
            onClick={() => {
              onClose(contextEntry.filePath);
              setContextMenu(null);
            }}
          >
            <X aria-hidden="true" />
            {t("workingSet.closeShort")}
          </button>
          <button
            type="button"
            role="menuitem"
            className="file-tree-context-menu__item"
            disabled={entries.length < 2}
            onClick={() => {
              onCloseOthers(contextEntry.filePath);
              setContextMenu(null);
            }}
          >
            <ListX aria-hidden="true" />
            {t("workingSet.closeOthers")}
          </button>
          <button
            type="button"
            role="menuitem"
            className="file-tree-context-menu__item"
            onClick={() => {
              onCloseAll();
              setContextMenu(null);
            }}
          >
            <ListX aria-hidden="true" />
            {t("workingSet.closeAll")}
          </button>
          <div className="editor-toolbar__menu-separator" role="separator" />
          <button
            type="button"
            role="menuitem"
            className="file-tree-context-menu__item"
            onClick={() => {
              onRevealInTree(contextEntry.filePath);
              setContextMenu(null);
            }}
          >
            <Locate aria-hidden="true" />
            {t("workingSet.revealInTree")}
          </button>
          {!showPins ? null : contextEntry.pinned ? (
            <button
              type="button"
              role="menuitem"
              className="file-tree-context-menu__item"
              onClick={() => {
                onUnpin(contextEntry.filePath);
                setContextMenu(null);
              }}
            >
              <PinOff aria-hidden="true" />
              {t("workingSet.unpin")}
            </button>
          ) : (
            <button
              type="button"
              role="menuitem"
              className="file-tree-context-menu__item"
              onClick={() => {
                onPin(contextEntry.filePath);
                setContextMenu(null);
              }}
            >
              <Pin aria-hidden="true" />
              {t("workingSet.pin")}
            </button>
          )}
        </ContextMenuSurface>
      ) : null}
    </section>
  );
}
