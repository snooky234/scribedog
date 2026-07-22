import type { StateCreator } from "zustand";

import type { ManualOrderMap, SortMode } from "@/lib/vaultMeta";

export type FileDocumentState = {
  content: string;
  baseContent: string;
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
  sortMode: SortMode;
  manualOrder: ManualOrderMap;
  fileMtimeMs: Record<string, number>;
  emptyFolderMtimeMs: Record<string, number>;
};

/** Opening, refreshing and mutating folders. */
export type FolderSlice = {
  openFolder: () => Promise<boolean>;
  openFolderAtPath: (folderPath: string) => Promise<boolean>;
  refreshFolderFiles: () => Promise<boolean>;
  createNewFolder: () => Promise<string | null>;
  renameFolderPath: (folderPath: string, newBaseName: string) => Promise<boolean>;
  deleteFolderPath: (folderPath: string) => Promise<boolean>;
};

/** Selecting, editing, saving and mutating individual files. */
export type FileSlice = {
  selectFilePath: (filePath: string) => Promise<boolean>;
  updateSelectedFileContent: (markdown: string) => void;
  discardSelectedFileChanges: () => boolean;
  saveSelectedFile: () => Promise<boolean>;
  createNewFile: (targetDirectory?: string) => Promise<string | null>;
  registerImportedFiles: (importedFilePaths: string[]) => void;
  renameSelectedFile: (newBaseName: string) => Promise<boolean>;
  renameFilePath: (filePath: string, newBaseName: string) => Promise<boolean>;
  deleteFilePath: (filePath: string) => Promise<boolean>;
  replaceFileContent: (filePath: string, newContent: string) => Promise<boolean>;
};

/** How the tree is ordered, and moving entries within it. */
export type TreeSlice = {
  setSortMode: (mode: SortMode) => Promise<void>;
  reorderWithinFolder: (parentDirectory: string, orderedBasenames: string[]) => Promise<boolean>;
  moveTreeEntry: (input: MoveTreeEntryInput) => Promise<boolean>;
};

export type AppState = AppData & FolderSlice & FileSlice & TreeSlice;

/**
 * Slices are typed against the *whole* AppState, not just their own part, so
 * `get()` still sees every field: moveTreeEntry reads filePaths and
 * manualOrder, deleteFolderPath reads fileDocuments, renameSelectedFile
 * delegates to renameFilePath. This is also what keeps the batch-delete
 * invariant intact — each action reads fresh state via get(), so callers must
 * run them sequentially rather than in parallel.
 */
export type AppSlice<TSlice> = StateCreator<AppState, [], [], TSlice>;
