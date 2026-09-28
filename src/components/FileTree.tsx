import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { BookOpen, Copy, Download, Eraser, ExternalLink, FileDown, FilePlus, FolderArchive, FolderInput, FolderPlus, Pencil, Pin, PinOff, Printer, Smile, Trash2, Undo2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import { getVaultCapabilities, platform, vaultCapabilityHint } from "@/platform";
import { dirname, join } from "@/platform/paths";
import { carriesExternalFiles } from "@/lib/dragDrop/droppedSources";
import { getLinkableFilePath } from "@/lib/editor/fileLinks";
import { cn } from "@/lib/utils";

import type { ExportMode } from "@/components/ExportDialog";
import {
  normalizeVaultPath,
  stagedChangeKind,
  vaultPathKey
} from "@/lib/chat/vaultStaging";
import { canDownloadFolderArchive, canDownloadMarkdown } from "@/lib/export/markdownDownload";
import { getRelativeDisplayPath, type MarkdownFileRecord } from "@/lib/fileSystem";
import { buildFileTree, type FileTreeFolderNode, type FileTreeNode } from "@/lib/fileTree";
import { getFolderNoteFolderPath, getFolderNotePath, isFolderNotePath } from "@/lib/folderNotes";
import { isCoarsePointer, singleClickOpens } from "@/lib/openGesture";
import type { ManualOrderMap, SortMode } from "@/lib/vaultMeta";
import {
  isShownAsPinned,
  pinSelectionToggle,
  pinToggleAction,
  type PinToggleAction
} from "@/store/appStore/workingSet";
import { EmojiPickerPopover } from "@/components/EmojiPicker";
import { getVaultIcon, type VaultIconMap } from "@/lib/vaultIcons";
import { anchorForTrigger, type PopoverAnchor } from "@/lib/usePopoverOverflowAlign";
import type { MoveTreeEntryInput, WorkingSetEntry } from "@/store/useAppStore";
import { useEditorSettingsStore } from "@/store/useEditorSettingsStore";
import { useSearchStore } from "@/store/useSearchStore";
import { useStagedChangesStore } from "@/store/useStagedChangesStore";

import { ContextMenuSurface } from "./fileTree/ContextMenuSurface";
import { TreeNodeRow } from "./fileTree/TreeNodeRow";
import { useExpandedFolders } from "./fileTree/useExpandedFolders";
import { useTreeContextMenu } from "./fileTree/useTreeContextMenu";
import { TREE_TAIL_KEY, useTreeDragDrop } from "./fileTree/useTreeDragDrop";
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
import type { BatchEntry, FileContextMenuState, PendingEntryRename } from "./fileTree/types";

export type { BatchEntry, PendingEntryRename } from "./fileTree/types";

type FileTreeProps = {
  folderPath: string;
  filePaths: string[];
  emptyFolderPaths: string[];
  selectedFilePath: string | null;
  dirtyFilePaths: string[];
  /** The "In progress" list; decides what a row's pin shows and toggles. */
  workingSetEntries: WorkingSetEntry[];
  onPinWorkingSetEntry: (filePath: string) => void;
  /** Closes the note's entry (asking first when dirty); the tree's item in pin-only mode. */
  onCloseWorkingSetEntry: (filePath: string) => void;
  /** The same for a multi-selection, one question per dirty note. */
  onCloseWorkingSetEntries: (filePaths: string[]) => void;
  /** Throws away a dirty note's unsaved edits without asking. */
  onDiscardChangesRequest: (filePath: string) => void;
  pendingEntryRename?: PendingEntryRename | null;
  sortMode: SortMode;
  manualOrder: ManualOrderMap;
  vaultIcons: VaultIconMap;
  /** Sets or, with a null icon, clears one entry's icon; the path is absolute. */
  onSetVaultIcon: (entryPath: string, icon: string | null) => void;
  fileMtimeMs: Record<string, number>;
  emptyFolderMtimeMs: Record<string, number>;
  onSelectFilePath: (filePath: string) => Promise<void>;
  /** Absolute folder path; the store resolves the note inside it. */
  onOpenFolderNote: (folderPath: string) => Promise<void>;
  onCreateFileRequest: (targetDirectory: string) => void;
  onCreateFolderRequest: (targetDirectory: string) => void;
  onDeleteFileRequest: (filePath: string) => void;
  onDuplicateFileRequest: (filePath: string) => void;
  onDeleteFolderRequest: (folderPath: string) => void;
  onExportFileRequest: (filePath: string, mode: ExportMode) => void;
  onExportFolderRequest: (folderPath: string, mode: ExportMode) => void;
  /** The note as the .md it is; offered only where the vault is not on this machine. */
  onDownloadMarkdownRequest: (filePath: string) => void;
  /** The folder's raw files as a ZIP, packed by the storage; same condition. */
  onDownloadFolderArchiveRequest: (folderPath: string, archiveName: string) => void;
  onPrintFileRequest: (filePath: string) => void;
  onRenameFolder: (folderPath: string, newBaseName: string) => Promise<boolean>;
  onRenameFile: (filePath: string, newBaseName: string) => Promise<boolean>;
  onMoveEntry: (input: MoveTreeEntryInput) => Promise<boolean>;
  /** "Move to…" from the context menu; entries carry absolute paths. */
  onMoveRequest: (entries: BatchEntry[]) => void;
  onDeleteMultipleRequest: (entries: BatchEntry[]) => void;
  onExportMultipleRequest: (entries: BatchEntry[], mode: ExportMode) => void;
  onRequestEditorFocus?: () => void;
  focusRequestId?: number;
  onSelectionChange?: (entries: BatchEntry[]) => void;
};

/**
 * The vault-relative path a context menu stands for, or null for a
 * multi-selection — an icon is set on one entry at a time.
 */
function getContextMenuRelativePath(
  contextMenu: FileContextMenuState,
  folderPath: string
): string | null {
  if (contextMenu.kind === "folder") {
    return contextMenu.relativePath;
  }

  if (contextMenu.kind === "file") {
    return getRelativeDisplayPath(folderPath, contextMenu.filePath);
  }

  return null;
}

export function FileTree({
  folderPath,
  filePaths,
  emptyFolderPaths,
  selectedFilePath,
  dirtyFilePaths,
  workingSetEntries,
  onPinWorkingSetEntry,
  onCloseWorkingSetEntry,
  onCloseWorkingSetEntries,
  onDiscardChangesRequest,
  pendingEntryRename,
  sortMode,
  manualOrder,
  vaultIcons,
  onSetVaultIcon,
  fileMtimeMs,
  emptyFolderMtimeMs,
  onSelectFilePath,
  onOpenFolderNote,
  onCreateFileRequest,
  onCreateFolderRequest,
  onDeleteFileRequest,
  onDuplicateFileRequest,
  onDeleteFolderRequest,
  onExportFileRequest,
  onExportFolderRequest,
  onDownloadMarkdownRequest,
  onDownloadFolderArchiveRequest,
  onPrintFileRequest,
  onRenameFolder,
  onRenameFile,
  onMoveEntry,
  onMoveRequest,
  onDeleteMultipleRequest,
  onExportMultipleRequest,
  onRequestEditorFocus,
  focusRequestId,
  onSelectionChange
}: FileTreeProps) {
  const { t } = useTranslation();
  const capabilities = getVaultCapabilities();
  const capabilityHint = vaultCapabilityHint();
  // The rendered export needs somewhere to go: a folder on this machine or
  // the platform's download. The raw Markdown is only worth a menu entry
  // where the file manager cannot do the job (browser, server vault).
  const offersExport = platform.features.exportFiles || platform.features.downloads;
  const offersMarkdownDownload = canDownloadMarkdown(folderPath);
  const offersFolderArchive = canDownloadFolderArchive(folderPath);
  const offersRevealInFileManager = platform.shell.openFolderInFileManager !== null;
  const { expandedFolderPaths, toggleFolder, expandAncestorsOf, expandFolders } =
    useExpandedFolders(folderPath);
  const { contextMenu, setContextMenu } = useTreeContextMenu();
  // The entry whose icon is being picked, kept after the menu that opened it
  // has closed.
  const [iconPicker, setIconPicker] = useState<{
    relativePath: string;
    anchor: PopoverAnchor;
  } | null>(null);
  const contextMenuIcon =
    contextMenu === null ? null : getVaultIcon(vaultIcons, getContextMenuRelativePath(contextMenu, folderPath) ?? "");
  const fileMatchCounts = useSearchStore((state) => state.fileMatchCounts);
  const lastHandledEntryRenameRequestIdRef = useRef<number | undefined>(undefined);

  const stagedChanges = useStagedChangesStore((state) => state.changes);
  // Folder notes on: a click on a folder's name opens its note and only the
  // chevron toggles it. Off: the whole row toggles, as it always has.
  const folderNotesEnabled = useEditorSettingsStore((state) => state.folderNotesEnabled);
  // Pin-only admission: an entry is an entry, "unpin" has no meaning, so the
  // listed note offers "close" instead (see WorkingSetPanel).
  const autoAdmitWorkingSet = useEditorSettingsStore((state) => state.autoAdmitWorkingSet);
  const openOnDoubleClick = useEditorSettingsStore((state) => state.openOnDoubleClick);
  // Asked per gesture, not per render: the pointer can change under a tablet.
  const clickOpens = () => singleClickOpens(openOnDoubleClick, isCoarsePointer());

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

  // The open note and the unsaved ones, translated to the folder rows that
  // stand in for them when they are folder notes (relative folder paths).
  const activeFolderNotePath = useMemo(() => {
    if (!selectedFilePath) {
      return null;
    }

    const relativePath = getRelativeDisplayPath(folderPath, selectedFilePath);

    return isFolderNotePath(relativePath) ? getFolderNoteFolderPath(relativePath) || null : null;
  }, [folderPath, selectedFilePath]);

  const dirtyFolderNotePaths = useMemo(
    () =>
      new Set(
        dirtyFilePaths
          .map((filePath) => getRelativeDisplayPath(folderPath, filePath))
          .filter(isFolderNotePath)
          .map(getFolderNoteFolderPath)
      ),
    [folderPath, dirtyFilePaths]
  );

  const folderMatchCounts = useMemo(
    () => buildFolderMatchCounts(treeNodes, fileMatchCounts),
    [treeNodes, fileMatchCounts]
  );

  // Dirty notes per subtree, for the ring on a collapsed folder: a draft
  // restored after a restart may sit in a folder nobody has opened yet.
  const folderDirtyCounts = useMemo(
    () => buildFolderMatchCounts(treeNodes, Object.fromEntries(dirtyFilePaths.map((filePath) => [filePath, 1]))),
    [treeNodes, dirtyFilePaths]
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
  // A lone selection is where the cursor is, and the focus ring already says
  // that; tinting it as well put a second grey row next to the open note. It
  // keeps the tint while a context menu (or the icon picker it opened) is up,
  // since that takes the focus and the tint is then the only mark of the row
  // it acts on.
  const showSelectionTint = selectedKeys.size > 1 || contextMenu !== null || iconPicker !== null;

  const {
    dragSourceKeys,
    dropIndicator,
    handleRowDragStart,
    handleRowDropIndicatorChange,
    handleRowDragEnd,
    handleRowDrop,
    handleTailDrop
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

    const relativePath = getRelativeDisplayPath(folderPath, selectedFilePath);

    // Opening a folder's note reveals the folder, not its contents: the
    // ancestors of the folder are expanded, the folder itself is left as it is
    // — a click on the name is not a request to unfold it.
    expandAncestorsOf(
      isFolderNotePath(relativePath) ? getFolderNoteFolderPath(relativePath) : relativePath
    );
  }, [folderPath, selectedFilePath, expandAncestorsOf]);

  // A freshly created file or folder is named where it lives, next to its
  // siblings: the tree is the only place that can do both, and it shows the
  // names the new one has to be distinct from while it is being typed.
  useEffect(() => {
    if (!pendingEntryRename) {
      return;
    }

    if (lastHandledEntryRenameRequestIdRef.current === pendingEntryRename.requestId) {
      return;
    }

    lastHandledEntryRenameRequestIdRef.current = pendingEntryRename.requestId;

    const relativePath = getRelativeDisplayPath(folderPath, pendingEntryRename.path);

    expandAncestorsOf(relativePath);

    if (pendingEntryRename.kind === "folder") {
      startFolderRename(relativePath);
    } else {
      startFileRename(relativePath);
    }
  }, [pendingEntryRename, folderPath, expandAncestorsOf, startFileRename, startFolderRename]);

  // While a project-wide search is running, opening a collapsed folder that
  // carries hits unfolds its whole matching subtree at once — the badge only
  // says "something below matches", so one click has to get the user there
  // instead of one level per click. Collapsing stays a plain toggle.
  const toggleFolderNode = (node: FileTreeFolderNode) => {
    const matchingFolderPaths =
      expandedFolderPaths.has(node.relativePath) || !folderMatchCounts[node.relativePath]
        ? []
        : collectMatchingFolderPaths(node, folderMatchCounts);

    if (matchingFolderPaths.length > 0) {
      expandFolders(matchingFolderPaths);
    } else {
      toggleFolder(node.relativePath);
    }
  };

  const openFolderNoteOf = (node: FileTreeFolderNode) => {
    void join(folderPath, node.relativePath).then(onOpenFolderNote);
  };

  // The note a row stands for: the file, or with folder notes on the
  // folder's note, written or not yet. Without them a folder has none.
  const resolveNotePath = async (node: FileTreeNode): Promise<string | null> => {
    if (node.kind === "file") {
      return node.filePath;
    }

    if (!folderNotesEnabled) {
      return null;
    }

    return node.folderNotePath ?? getFolderNotePath(await join(folderPath, node.relativePath));
  };

  // Double-click where a click opens: the deliberate way into
  // "In progress" (a click only shows the note).
  const pinNode = (node: FileTreeNode) => {
    void resolveNotePath(node).then((path) => {
      if (path) {
        onPinWorkingSetEntry(path);
      }
    });
  };

  // With folder notes on, a folder row is a note row and behaves exactly
  // like a file's. Without them it is only a place in the tree: the cursor
  // may rest on it, but it is never marked the way a note is, so the open
  // note keeps its marking and only the focus ring moves (file-tree.css).
  const selectionFor = (node: FileTreeNode): Set<string> =>
    node.kind === "folder" && !folderNotesEnabled ? new Set() : new Set([getNodeKey(node)]);

  const openNode = (node: FileTreeNode) => {
    if (node.kind === "file") {
      void onSelectFilePath(node.filePath);
    } else if (folderNotesEnabled) {
      openFolderNoteOf(node);
    }
  };

  const describePinToggle = (filePath: string): PinToggleAction =>
    pinToggleAction(workingSetEntries, filePath, autoAdmitWorkingSet);

  // The row's pin and Shift+Enter. Taking the pin away takes the entry out
  // of the list, through the close that asks first where the note is dirty.
  const togglePin = (filePath: string) => {
    if (describePinToggle(filePath) === "pin") {
      onPinWorkingSetEntry(filePath);
      return;
    }

    onCloseWorkingSetEntry(filePath);
  };

  // A double-click pins where the click before it has already opened the
  // note, and opens where that click only marked it.
  const handleRowDoubleClick = (node: FileTreeNode) => {
    if (clickOpens()) {
      pinNode(node);
    } else {
      openNode(node);
    }
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

      if (node.kind === "file" && clickOpens()) {
        void onSelectFilePath(node.filePath);
      }
      return;
    }

    setActiveKey(key);
    setRangeFocusKey(null);

    // Open on double-click: the click marks the row the way the arrow keys
    // do and leaves the editor alone. A folder without folder notes has no
    // note to keep off the screen, so it still toggles.
    if (!clickOpens() && (node.kind === "file" || folderNotesEnabled)) {
      setSelectedKeys(new Set([key]));
      return;
    }

    if (node.kind === "folder") {
      // A plain click toggles the folder — it is not a request to select it,
      // so unlike the file branch below this does not touch selectedKeys.
      // Selecting a folder is still possible (Ctrl/Shift-click above, right-
      // click for the context menu below), it just does not happen as a side
      // effect of every expand/collapse, or the folder would stay marked
      // long after the click that opened it.
      // With folder notes on, the name opens the folder's note instead and the
      // chevron (its own click target in the row) is what toggles.
      if (folderNotesEnabled) {
        setSelectedKeys(new Set([key]));
        openFolderNoteOf(node);
      } else {
        toggleFolderNode(node);
      }
    } else {
      setSelectedKeys(new Set([key]));
      void onSelectFilePath(node.filePath);
    }
  };

  const handleTreeKeyDown = (event: React.KeyboardEvent<HTMLUListElement>) => {
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      if (flatNodes.length === 0) {
        return;
      }

      event.preventDefault();

      // Always from where the ring is: the moving end of a Shift range, or
      // the active row. Without Shift a step from the anchor would jump back
      // to where the range began instead of one row on from the ring.
      const anchorForMovement = rangeFocusKey ?? activeKey;
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
      setSelectedKeys(selectionFor(nextNode));
      setRangeFocusKey(null);

      if (clickOpens()) {
        openNode(nextNode);
      }
      return;
    }

    // Left/right on a folder unfold and fold it, the way every tree control
    // does — and with folder notes on this is the only keyboard way to, since
    // Enter/Space on the row then open the note. On an expanded folder, right
    // steps into the first child; left on a collapsed folder or a file climbs
    // to the parent.
    if ((event.key === "ArrowRight" || event.key === "ArrowLeft") && activeKey) {
      const activeNode = flatNodes.find((node) => getNodeKey(node) === activeKey);

      if (!activeNode) {
        return;
      }

      event.preventDefault();

      const moveTo = (targetKey: string) => {
        const target = flatNodes.find((node) => getNodeKey(node) === targetKey);

        focusItem(targetKey);
        setActiveKey(targetKey);
        setSelectedKeys(target ? selectionFor(target) : new Set([targetKey]));
        setRangeFocusKey(null);
      };
      const isExpandedFolder =
        activeNode.kind === "folder" && expandedFolderPaths.has(activeNode.relativePath);

      if (event.key === "ArrowRight") {
        if (activeNode.kind !== "folder") {
          return;
        }

        if (!isExpandedFolder) {
          toggleFolder(activeNode.relativePath);
        } else if (activeNode.children[0]) {
          moveTo(getNodeKey(activeNode.children[0]));
        }

        return;
      }

      if (isExpandedFolder) {
        toggleFolder(activeNode.relativePath);
        return;
      }

      const parentRelativePath = nodeContextByKey.get(activeKey)?.parentRelativePath;

      if (parentRelativePath) {
        moveTo(`folder:${parentRelativePath}`);
      }

      return;
    }

    if (event.key === "Tab" && !event.shiftKey) {
      event.preventDefault();
      onRequestEditorFocus?.();
    }

    // Enter on a note opens it and never pins: on the keyboard the pin is
    // Shift+Enter's alone, one key for both directions. Shift+Enter leaves
    // the note where it is; on a multi-selection it toggles all of it
    // (pinSelectionToggle). The row is a button, so without the
    // preventDefault the key would also fire its click. Only from a row
    // itself: the "…" button in the row and the rename input have Enter
    // meanings of their own.
    const isFromRow = event.target instanceof HTMLElement && event.target.getAttribute("role") === "treeitem";

    if (event.key === "Enter" && isFromRow && activeKey && !event.ctrlKey && !event.metaKey && !event.altKey) {
      const activeNode = flatNodes.find((node) => getNodeKey(node) === activeKey);

      if (event.shiftKey && selectedKeys.size > 1 && selectedKeys.has(activeKey)) {
        event.preventDefault();

        const filePaths = flatNodes.flatMap((node) => {
          const filePath = selectedKeys.has(getNodeKey(node)) ? getLinkableFilePath(node, folderNotesEnabled) : null;

          return filePath ? [filePath] : [];
        });

        const toggle = pinSelectionToggle(workingSetEntries, filePaths, autoAdmitWorkingSet);

        if (toggle.action === "pin") {
          toggle.filePaths.forEach(onPinWorkingSetEntry);
        } else {
          onCloseWorkingSetEntries(toggle.filePaths);
        }
        return;
      }

      if (activeNode && (activeNode.kind === "file" || folderNotesEnabled)) {
        event.preventDefault();

        if (event.shiftKey) {
          void resolveNotePath(activeNode).then((path) => {
            if (path) {
              togglePin(path);
            }
          });
          return;
        }

        openNode(activeNode);
        return;
      }
    }

    if (event.key === "F2" && capabilities.rename) {
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

  // What a drag out of the tree carries: the note the dragged row stands for
  // (a file, or a folder's folder note), or — when the row is part of a
  // multi-selection — the notes of every selected row. A folder without a
  // folder note carries nothing, since only files can be linked in a document.
  const resolveDragFilePaths = useCallback(
    (node: FileTreeNode): string[] => {
      const key = getNodeKey(node);

      if (!selectedKeys.has(key) || selectedKeys.size <= 1) {
        const filePath = getLinkableFilePath(node, folderNotesEnabled);

        return filePath ? [filePath] : [];
      }

      return flatNodes.flatMap((candidate) => {
        const filePath = selectedKeys.has(getNodeKey(candidate))
          ? getLinkableFilePath(candidate, folderNotesEnabled)
          : null;

        return filePath ? [filePath] : [];
      });
    },
    [flatNodes, folderNotesEnabled, selectedKeys]
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

  // The context menu's batch actions all start from the same list: the
  // top-level entries of the selection, folders resolved to absolute paths.
  const resolveSelectedEntries = (keys: string[]) =>
    Promise.all(
      getTopLevelSelection(keys, flatNodes).map(
        async (node): Promise<BatchEntry> => ({
          kind: node.kind,
          path: node.kind === "file" ? node.filePath : await join(folderPath, node.relativePath)
        })
      )
    );

  const contextMenuTitle =
    contextMenu === null
      ? undefined
      : contextMenu.kind === "multiple"
        ? t("fileTree.selectionCount", { count: getTopLevelSelection(contextMenu.keys, flatNodes).length })
        : contextMenu.kind === "folder"
          ? contextMenu.relativePath.slice(contextMenu.relativePath.lastIndexOf("/") + 1)
          : getRelativeDisplayPath(folderPath, contextMenu.filePath).split("/").pop();

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
            vaultIcons={vaultIcons}
            depth={0}
            expandedFolderPaths={expandedFolderPaths}
            folderMatchCounts={folderMatchCounts}
            folderStagedCounts={folderStagedCounts}
            folderDirtyCounts={folderDirtyCounts}
            stagedKeys={staged.changedKeys}
            stagedCreatedKeys={staged.createdKeys}
            stagedDeletedKeys={staged.deletedKeys}
            selectedFilePath={selectedFilePath}
            selectedKeys={selectedKeys}
            showSelectionTint={showSelectionTint}
            dirtyFilePaths={dirtyFilePaths}
            folderNotesEnabled={folderNotesEnabled}
            activeFolderNotePath={activeFolderNotePath}
            dirtyFolderNotePaths={dirtyFolderNotePaths}
            describePinToggle={describePinToggle}
            onTogglePin={togglePin}
            openOnDoubleClick={openOnDoubleClick}
            activeKey={activeKey}
            renamingTarget={renamingTarget}
            renameDraft={renameDraft}
            renameInputRef={renameInputRef}
            sortMode={sortMode}
            dragSourceKeys={dragSourceKeys}
            dropIndicator={dropIndicator}
            onRowClick={handleRowClick}
            onRowDoubleClick={handleRowDoubleClick}
            onToggleFolder={toggleFolderNode}
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

      {sortMode === "manual" && capabilities.move && dragSourceKeys.length > 0 ? (
        <div
          className={cn(
            "file-tree__tail",
            dropIndicator?.key === TREE_TAIL_KEY && "file-tree__tail--drop"
          )}
          aria-hidden="true"
          onDragOver={(event) => {
            if (carriesExternalFiles(event.dataTransfer)) {
              return;
            }

            event.preventDefault();
            event.dataTransfer.dropEffect = "move";
            handleRowDropIndicatorChange(TREE_TAIL_KEY, "below");
          }}
          onDragLeave={() => handleRowDropIndicatorChange(TREE_TAIL_KEY, null)}
          onDrop={(event) => {
            if (carriesExternalFiles(event.dataTransfer)) {
              return;
            }

            event.preventDefault();
            event.stopPropagation();
            handleTailDrop();
          }}
        />
      ) : null}

      {contextMenu ? (
        <ContextMenuSurface
          x={contextMenu.x}
          y={contextMenu.y}
          title={contextMenuTitle}
          onClick={(event) => event.stopPropagation()}
        >
          {contextMenu.kind === "multiple" ? (
            <>
              {offersExport ? (["standard", "manuscript"] as const).map((mode) => (
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
              )) : null}

              <button
                type="button"
                role="menuitem"
                className="file-tree-context-menu__item"
                disabled={!capabilities.move}
                title={capabilities.move ? undefined : capabilityHint}
                onClick={() => {
                  void resolveSelectedEntries(contextMenu.keys).then(onMoveRequest);
                  setContextMenu(null);
                }}
              >
                <FolderInput aria-hidden="true" />
                {t("fileTree.moveTo")}
              </button>

              <button
                type="button"
                role="menuitem"
                className="file-tree-context-menu__item file-tree-context-menu__item--danger"
                disabled={!capabilities.delete}
                title={capabilities.delete ? undefined : capabilityHint}
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
                disabled={!capabilities.create}
                title={capabilities.create ? undefined : capabilityHint}
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

              {contextMenu.kind === "folder" ? (
                <button
                  type="button"
                  role="menuitem"
                  className="file-tree-context-menu__item"
                  disabled={!capabilities.create}
                  title={capabilities.create ? undefined : capabilityHint}
                  onClick={() => {
                    void join(folderPath, contextMenu.relativePath).then(onCreateFolderRequest);
                    setContextMenu(null);
                  }}
                >
                  <FolderPlus aria-hidden="true" />
                  {t("sidebar.newFolder")}
                </button>
              ) : null}

              <button
                type="button"
                role="menuitem"
                className="file-tree-context-menu__item"
                disabled={!capabilities.rename}
                title={capabilities.rename ? undefined : capabilityHint}
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

              {/* Files and folders take the same two entries: an icon is a
                  property of the row, and which kind of entry it stands for
                  makes no difference to picking one. */}
              <button
                type="button"
                role="menuitem"
                className="file-tree-context-menu__item"
                onClick={(event) => {
                  const relativePath = getContextMenuRelativePath(contextMenu, folderPath);

                  if (relativePath !== null) {
                    // Anchored to the menu entry, not to the pointer: the menu
                    // closes with this click, so the picker has to hang
                    // somewhere the eye is already looking.
                    setIconPicker({
                      relativePath,
                      anchor: anchorForTrigger(event.currentTarget.getBoundingClientRect())
                    });
                  }

                  setContextMenu(null);
                }}
              >
                <Smile aria-hidden="true" />
                {t("fileTree.changeIcon")}
              </button>

              {contextMenuIcon !== null ? (
                <button
                  type="button"
                  role="menuitem"
                  className="file-tree-context-menu__item"
                  onClick={() => {
                    const relativePath = getContextMenuRelativePath(contextMenu, folderPath);

                    if (relativePath !== null) {
                      void join(folderPath, relativePath).then((path) => onSetVaultIcon(path, null));
                    }

                    setContextMenu(null);
                  }}
                >
                  <Eraser aria-hidden="true" />
                  {t("fileTree.removeIcon")}
                </button>
              ) : null}

              {contextMenu.kind === "file" ? (
                <button
                  type="button"
                  role="menuitem"
                  className="file-tree-context-menu__item"
                  disabled={!capabilities.create}
                  title={capabilities.create ? undefined : capabilityHint}
                  onClick={() => {
                    onDuplicateFileRequest(contextMenu.filePath);
                    setContextMenu(null);
                  }}
                >
                  <Copy aria-hidden="true" />
                  {t("fileTree.duplicate")}
                </button>
              ) : null}

              {contextMenu.kind === "file" ? (
                isShownAsPinned(workingSetEntries, contextMenu.filePath, autoAdmitWorkingSet) ? (
                  <button
                    type="button"
                    role="menuitem"
                    className="file-tree-context-menu__item"
                    onClick={() => {
                      onCloseWorkingSetEntry(contextMenu.filePath);
                      setContextMenu(null);
                    }}
                  >
                    <PinOff aria-hidden="true" />
                    {t("fileTree.unpinWorkingSet")}
                  </button>
                ) : (
                  <button
                    type="button"
                    role="menuitem"
                    className="file-tree-context-menu__item"
                    onClick={() => {
                      onPinWorkingSetEntry(contextMenu.filePath);
                      setContextMenu(null);
                    }}
                  >
                    <Pin aria-hidden="true" />
                    {t("fileTree.pinWorkingSet")}
                  </button>
                )
              ) : null}

              {/* A draft closes from here too, with the section folded away. */}
              {contextMenu.kind === "file" && dirtyFilePaths.includes(contextMenu.filePath) ? (
                <button
                  type="button"
                  role="menuitem"
                  className="file-tree-context-menu__item"
                  onClick={() => {
                    onDiscardChangesRequest(contextMenu.filePath);
                    setContextMenu(null);
                  }}
                >
                  <Undo2 aria-hidden="true" />
                  {t("fileTree.discardChanges")}
                </button>
              ) : null}

              <button
                type="button"
                role="menuitem"
                className="file-tree-context-menu__item"
                disabled={!capabilities.move}
                title={capabilities.move ? undefined : capabilityHint}
                onClick={() => {
                  if (contextMenu.kind === "folder") {
                    void join(folderPath, contextMenu.relativePath).then((path) =>
                      onMoveRequest([{ kind: "folder", path }])
                    );
                  } else {
                    onMoveRequest([{ kind: "file", path: contextMenu.filePath }]);
                  }

                  setContextMenu(null);
                }}
              >
                <FolderInput aria-hidden="true" />
                {t("fileTree.moveTo")}
              </button>

              {offersExport ? (
                <>
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
                </>
              ) : null}

              {contextMenu.kind === "file" && offersMarkdownDownload ? (
                <button
                  type="button"
                  role="menuitem"
                  className="file-tree-context-menu__item"
                  onClick={() => {
                    onDownloadMarkdownRequest(contextMenu.filePath);
                    setContextMenu(null);
                  }}
                >
                  <FileDown aria-hidden="true" />
                  {t("fileTree.downloadMarkdown")}
                </button>
              ) : null}

              {contextMenu.kind === "folder" && offersFolderArchive ? (
                <button
                  type="button"
                  role="menuitem"
                  className="file-tree-context-menu__item"
                  onClick={() => {
                    const archiveName = contextMenu.relativePath.split("/").pop() ?? contextMenu.relativePath;

                    void join(folderPath, contextMenu.relativePath).then((path) =>
                      onDownloadFolderArchiveRequest(path, archiveName)
                    );
                    setContextMenu(null);
                  }}
                >
                  <FolderArchive aria-hidden="true" />
                  {t("fileTree.downloadFolderArchive")}
                </button>
              ) : null}

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

              {contextMenu.kind === "folder" && offersRevealInFileManager ? (
                <button
                  type="button"
                  role="menuitem"
                  className="file-tree-context-menu__item"
                  onClick={() => {
                    void join(folderPath, contextMenu.relativePath).then((path) =>
                      platform.shell.openFolderInFileManager?.(path)
                    );
                    setContextMenu(null);
                  }}
                >
                  <ExternalLink aria-hidden="true" />
                  {t("fileTree.revealInFileManager")}
                </button>
              ) : null}

              <button
                type="button"
                role="menuitem"
                className="file-tree-context-menu__item file-tree-context-menu__item--danger"
                disabled={!capabilities.delete}
                title={capabilities.delete ? undefined : capabilityHint}
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

      {iconPicker ? (
        <EmojiPickerPopover
          anchor={iconPicker.anchor}
          onSelect={(emoji) => {
            void join(folderPath, iconPicker.relativePath).then((path) =>
              onSetVaultIcon(path, emoji)
            );
          }}
          onClose={() => setIconPicker(null)}
        />
      ) : null}
    </>
  );
}
