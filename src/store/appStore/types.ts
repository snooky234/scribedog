import type { StateCreator } from "zustand";

import type { ManualOrderMap, SortMode } from "@/lib/vaultMeta";
import type { VaultIconMap } from "@/lib/vaultIcons";

import type { VersionedText } from "@/platform/types";

import type { WorkingSetEntry } from "./workingSet";

export type FileDocumentState = {
  content: string;
  baseContent: string;
  /**
   * mtime of the file when `baseContent` was read from it, or null when the
   * file did not exist then. Undefined means unknown (the document came from
   * a write whose mtime nobody looked up), which skips the save-time conflict
   * check until the next reload sets it.
   */
  baseMtimeMs?: number | null;
  /**
   * Version token of the file `baseContent` was read from (see
   * `VersionedText`), null when the file did not exist. A save writes only
   * while the disk still holds this version; undefined means nobody recorded
   * one, and the save writes over whatever is there.
   */
  baseVersion?: string | null;
};

/**
 * A save whose changes overlap with someone else's write to the same note.
 * Changes at different places never get here; saveWithMerge merges them.
 *
 * A manual save asks (`prompt`); an auto-save only marks the note, since a
 * timer must not open a dialog mid-sentence, and the save button then says
 * there is a conflict to resolve. Overwriting goes through
 * saveSelectedFile({ force: true }), reviewing through startMergeReview.
 */
export type SaveConflict = {
  filePath: string;
  prompt: boolean;
  /** Number of overlapping passages. */
  conflicts: number;
  /** The version on disk that the review builds on. */
  theirs: VersionedText;
  /** What the editor held when the save ran. */
  ours: string;
  /** The merge with their / our text at every overlapping passage. */
  theirsText: string;
  oursText: string;
};

/**
 * A conflict being resolved in the editor. The document holds the merge with
 * their text at the overlapping passages, its baseline is their version, and
 * each passage is offered as a proposal (red theirs, green ours) to accept or
 * discard. Saving waits until none is left.
 */
export type MergeReview = {
  filePath: string;
  theirsText: string;
  oursText: string;
};

export type MoveTreeEntryInput = {
  kind: "file" | "folder";
  sourcePath: string;
  targetParentDirectory: string;
  targetIndex: number;
};

/**
 * The data half of the store. `fileDocuments` keeps content vs. baseContent
 * per path so switching between several dirty files never loses unsaved
 * edits; the `selectedFile*` fields mirror the entry of the open file.
 */
export type AppData = {
  folderPath: string | null;
  filePaths: string[];
  emptyFolderPaths: string[];
  selectedFilePath: string | null;
  selectedFileContent: string | null;
  selectedFileBaseContent: string | null;
  fileDocuments: Record<string, FileDocumentState>;
  isLoading: boolean;
  isFileLoading: boolean;
  isSaving: boolean;
  isRefreshing: boolean;
  isDirty: boolean;
  folderError: string | null;
  fileError: string | null;
  saveError: string | null;
  saveConflict: SaveConflict | null;
  mergeReview: MergeReview | null;
  /** The "In progress" list above the tree; see workingSet.ts for the rules. */
  workingSet: WorkingSetEntry[];
  sortMode: SortMode;
  manualOrder: ManualOrderMap;
  /** Per-entry emoji icons, keyed by vault-relative path (lib/vaultIcons.ts). */
  vaultIcons: VaultIconMap;
  fileMtimeMs: Record<string, number>;
  emptyFolderMtimeMs: Record<string, number>;
};

/** Opening, refreshing and mutating folders. */
export type FolderSlice = {
  openFolder: () => Promise<boolean>;
  openFolderAtPath: (folderPath: string) => Promise<boolean>;
  /** Closes the open vault without opening another; the app shows the empty state. */
  closeFolder: () => void;
  refreshFolderFiles: () => Promise<boolean>;
  createNewFolder: (targetDirectory?: string, insertAfterBasename?: string | null) => Promise<string | null>;
  /** Creates a folder at exactly this path (see createFileAtPath for the why). */
  createFolderAtPath: (folderPath: string) => Promise<boolean>;
  renameFolderPath: (folderPath: string, newBaseName: string) => Promise<boolean>;
  deleteFolderPath: (folderPath: string) => Promise<boolean>;
};

export type SaveOptions = { trigger?: "manual" | "auto"; force?: boolean };

/** Selecting, editing, saving and mutating individual files. */
export type FileSlice = {
  selectFilePath: (filePath: string) => Promise<boolean>;
  /**
   * Opens a folder's own note (lib/folderNotes.ts). Reads the file when it
   * exists; otherwise starts an empty in-memory document at the note's path,
   * which saveSelectedFile writes to disk on the first save — so enabling the
   * feature never litters a vault with empty files.
   */
  openFolderNote: (folderPath: string) => Promise<boolean>;
  updateSelectedFileContent: (markdown: string) => void;
  adoptCanonicalFileContent: (filePath: string, markdown: string) => void;
  discardSelectedFileChanges: () => boolean;
  /**
   * Writes the open note. An auto-save (hooks/useAutoSave.ts) says so, because
   * it fires after every pause in typing and would otherwise fill the version
   * history with keystroke-sized snapshots; the versioning bridge holds the
   * last one back until the note is left, a deliberate save is always
   * snapshotted.
   *
   * The write goes through only while the file is still the version its
   * baseline was read from (saveWithMerge). Someone else's write in the
   * meantime is merged in when the changes sit at different places; when they
   * overlap, the save resolves false and sets `saveConflict` (see there).
   * `force` keeps this side's text: the version on disk is snapshotted first
   * (when versioning is on), then written over.
   */
  saveSelectedFile: (options?: SaveOptions) => Promise<boolean>;
  /**
   * The same save for any note that has a document, open or not: what
   * closing a dirty entry of the working set with "Save" needs.
   */
  saveFilePath: (filePath: string, options?: SaveOptions) => Promise<boolean>;
  /**
   * The user closed the question without deciding; the document stays dirty
   * and the conflict stays marked (prompt off) until the next save by hand.
   */
  dismissSaveConflict: () => void;
  /**
   * Resolves the pending conflict in the editor (see MergeReview). This
   * side's whole text goes into the version history first, so nothing is
   * lost whichever way each passage is decided.
   */
  startMergeReview: () => Promise<boolean>;
  /** No overlapping passage is left open; saving is possible again. */
  endMergeReview: () => void;
  restoreFileVersion: (versionId: string) => Promise<boolean>;
  createNewFile: (targetDirectory?: string, insertAfterBasename?: string | null) => Promise<string | null>;
  /**
   * Creates a file at exactly this path with this content, without selecting
   * it. What the vault agent's apply path needs and createNewFile cannot do:
   * the agent names the file, and it writes several of them in one batch
   * without the editor jumping to each in turn.
   */
  createFileAtPath: (filePath: string, content: string) => Promise<boolean>;
  /** Copies filePath to a sibling named after it plus a localized "(Copy)" suffix, and selects it. */
  duplicateFile: (filePath: string) => Promise<string | null>;
  registerImportedFiles: (
    importedFilePaths: string[],
    parentRelativePath: string,
    insertAfterBasename?: string | null
  ) => void;
  renameSelectedFile: (newBaseName: string) => Promise<boolean>;
  renameFilePath: (filePath: string, newBaseName: string) => Promise<boolean>;
  deleteFilePath: (filePath: string) => Promise<boolean>;
  replaceFileContent: (filePath: string, newContent: string) => Promise<boolean>;
};

/** How the tree is ordered, and moving entries within it. */
export type TreeSlice = {
  setSortMode: (mode: SortMode) => Promise<void>;
  /** Sets or, with a null icon, clears the icon of one file or folder (absolute path). */
  setVaultIconFor: (entryPath: string, icon: string | null) => void;

  reorderWithinFolder: (parentDirectory: string, orderedBasenames: string[]) => Promise<boolean>;
  moveTreeEntry: (input: MoveTreeEntryInput) => Promise<boolean>;
};

/** The "In progress" list: admission by pin, removal, and discard for any note. */
export type WorkingSetSlice = {
  pinWorkingSetEntry: (filePath: string) => void;
  /** Drag & drop in the list: the entry goes in front of the one at `beforeIndex`. */
  moveWorkingSetEntry: (filePath: string, beforeIndex: number) => void;
  /** Removes the entry; a dirty note has to be saved or discarded first (the UI asks). */
  closeWorkingSetEntry: (filePath: string) => void;
  /** Removes every clean, unpinned entry. */
  closeSavedWorkingSetEntries: () => void;
  /** Back to the saved state for any note with a document, open or not. */
  discardFileChanges: (filePath: string) => boolean;
};

export type AppState = AppData & FolderSlice & FileSlice & TreeSlice & WorkingSetSlice;

/**
 * Slices are typed against the *whole* AppState, not just their own part, so
 * `get()` still sees every field: moveTreeEntry reads filePaths and
 * manualOrder, deleteFolderPath reads fileDocuments, renameSelectedFile
 * delegates to renameFilePath. This is also what keeps the batch-delete
 * invariant intact — each action reads fresh state via get(), so callers must
 * run them sequentially rather than in parallel.
 */
export type AppSlice<TSlice> = StateCreator<AppState, [], [], TSlice>;
