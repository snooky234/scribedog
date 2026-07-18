import { create } from "zustand";
import { dirname, join } from "@tauri-apps/api/path";

import i18n from "@/i18n";
import {
  allowMarkdownFolderAccess,
  chooseMarkdownFolder,
  cleanupOrphanedImages,
  createUniqueMarkdownFolder,
  deleteMarkdownFile,
  deleteMarkdownFolder,
  type MarkdownFileRecord,
  getRelativeDisplayPath,
  listMarkdownFiles,
  markdownFolderExists,
  readMarkdownFile,
  renameMarkdownFile,
  renameMarkdownFolder,
  rewriteRelativeImagePaths,
  setLastOpenedFolderPath,
  watchMarkdownFolder,
  writeMarkdownFile
} from "@/lib/fileSystem";
import { getChildBasenamesByParent, isDescendantRelativePath } from "@/lib/fileTree";
import {
  readManualOrder,
  readSortMode,
  writeManualOrder,
  writeSortMode,
  type ManualOrderMap,
  type SortMode
} from "@/lib/vaultMeta";

type FileDocumentState = {
  content: string;
  baseContent: string;
};

export type MoveTreeEntryInput = {
  kind: "file" | "folder";
  sourcePath: string;
  targetParentDirectory: string;
  targetIndex: number;
};

type AppState = {
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
  openFolder: () => Promise<boolean>;
  openFolderAtPath: (folderPath: string) => Promise<boolean>;
  refreshFolderFiles: () => Promise<boolean>;
  selectFilePath: (filePath: string) => Promise<boolean>;
  updateSelectedFileContent: (markdown: string) => void;
  discardSelectedFileChanges: () => boolean;
  saveSelectedFile: () => Promise<boolean>;
  createNewFile: (targetDirectory?: string) => Promise<string | null>;
  registerImportedFiles: (importedFilePaths: string[]) => void;
  createNewFolder: () => Promise<string | null>;
  renameSelectedFile: (newBaseName: string) => Promise<boolean>;
  renameFilePath: (filePath: string, newBaseName: string) => Promise<boolean>;
  renameFolderPath: (folderPath: string, newBaseName: string) => Promise<boolean>;
  deleteFilePath: (filePath: string) => Promise<boolean>;
  deleteFolderPath: (folderPath: string) => Promise<boolean>;
  setSortMode: (mode: SortMode) => Promise<void>;
  reorderWithinFolder: (parentDirectory: string, orderedBasenames: string[]) => Promise<boolean>;
  moveTreeEntry: (input: MoveTreeEntryInput) => Promise<boolean>;
};

function toErrorMessage(error: unknown, fallbackMessage: string): string {
  if (error instanceof Error) {
    return error.message;
  }

  return fallbackMessage;
}

function isDocumentDirty(document: FileDocumentState): boolean {
  return document.content !== document.baseContent;
}

function pruneDocumentsToCurrentFolder(
  fileDocuments: Record<string, FileDocumentState>,
  filePaths: string[],
  selectedFilePath: string | null
): Record<string, FileDocumentState> {
  const filePathSet = new Set(filePaths);
  const nextDocuments: Record<string, FileDocumentState> = {};

  for (const [filePath, document] of Object.entries(fileDocuments)) {
    if (filePathSet.has(filePath) || isDocumentDirty(document)) {
      nextDocuments[filePath] = document;
    }
  }

  if (selectedFilePath && !filePathSet.has(selectedFilePath)) {
    const selectedDocument = nextDocuments[selectedFilePath];

    if (!selectedDocument || !isDocumentDirty(selectedDocument)) {
      delete nextDocuments[selectedFilePath];
    }
  }

  return nextDocuments;
}

async function refreshCleanDocumentsFromDisk(
  fileDocuments: Record<string, FileDocumentState>,
  filePaths: string[]
): Promise<Record<string, FileDocumentState>> {
  const filePathSet = new Set(filePaths);
  const nextDocuments: Record<string, FileDocumentState> = { ...fileDocuments };
  const cleanPathsToReload = Object.entries(fileDocuments)
    .filter(([filePath, document]) => filePathSet.has(filePath) && !isDocumentDirty(document))
    .map(([filePath]) => filePath);

  await Promise.all(
    cleanPathsToReload.map(async (filePath) => {
      try {
        const markdown = await readMarkdownFile(filePath);
        nextDocuments[filePath] = {
          content: markdown,
          baseContent: markdown
        };
      } catch {
        delete nextDocuments[filePath];
      }
    })
  );

  return nextDocuments;
}

function normalizePathKey(path: string): string {
  return path.replace(/\\/g, "/").toLowerCase();
}

function insertFilePathSorted(filePaths: string[], newPath: string): string[] {
  return [...filePaths, newPath].sort((left, right) =>
    left.localeCompare(right, undefined, {
      numeric: true,
      sensitivity: "base"
    })
  );
}

const INVALID_FILE_NAME_CHARS = /[\\/:*?"<>|]/;

async function remapPathUnderRenamedFolder(
  path: string,
  oldFolderPath: string,
  newFolderPath: string
): Promise<string> {
  const normalizedOldFolderPath = normalizePathKey(oldFolderPath);
  const normalizedPath = normalizePathKey(path);

  if (
    normalizedPath !== normalizedOldFolderPath &&
    !normalizedPath.startsWith(`${normalizedOldFolderPath}/`)
  ) {
    return path;
  }

  const relativePath = getRelativeDisplayPath(oldFolderPath, path);

  return relativePath ? join(newFolderPath, relativePath) : newFolderPath;
}

function isPathInsideFolder(path: string, folderPath: string): boolean {
  return normalizePathKey(path).startsWith(`${normalizePathKey(folderPath)}/`);
}

function getBasename(path: string): string {
  return path.replace(/\\/g, "/").split("/").pop() ?? path;
}

function buildFileMtimeMap(markdownFiles: MarkdownFileRecord[]): Record<string, number> {
  const map: Record<string, number> = {};

  for (const record of markdownFiles) {
    map[record.filePath] = record.mtimeMs;
  }

  return map;
}

/**
 * Diffs a manual-order sidecar against what actually exists on disk: appends
 * children that showed up externally (e.g. created outside the app) at the
 * end (alphabetically among themselves), and drops entries for basenames or
 * folders that no longer exist. No-ops (and never touches disk) when there
 * is no manual order yet, so vaults that never use Manual mode never get a
 * `.scribedog/` folder created for them.
 */
async function reconcileManualOrder(
  vaultFolderPath: string,
  manualOrder: ManualOrderMap,
  markdownFiles: MarkdownFileRecord[],
  emptyFolderRelativePaths: string[]
): Promise<ManualOrderMap> {
  if (Object.keys(manualOrder).length === 0) {
    return manualOrder;
  }

  const actualChildrenByParent = getChildBasenamesByParent(markdownFiles, emptyFolderRelativePaths);
  const next: ManualOrderMap = {};
  let didChange = false;

  for (const [parentRelativePath, storedOrder] of Object.entries(manualOrder)) {
    const actualChildren = actualChildrenByParent.get(parentRelativePath);

    if (!actualChildren) {
      didChange = true;
      continue;
    }

    const actualSet = new Set(actualChildren);
    const filtered = storedOrder.filter((name) => actualSet.has(name));

    if (filtered.length !== storedOrder.length) {
      didChange = true;
    }

    const knownSet = new Set(filtered);
    const missing = actualChildren
      .filter((name) => !knownSet.has(name))
      .sort((left, right) => left.localeCompare(right, undefined, { numeric: true, sensitivity: "base" }));

    if (missing.length > 0) {
      didChange = true;
    }

    next[parentRelativePath] = [...filtered, ...missing];
  }

  if (!didChange) {
    return manualOrder;
  }

  void writeManualOrder(vaultFolderPath, next).catch(() => undefined);

  return next;
}

function persistManualOrderIfChanged(
  vaultFolderPath: string,
  previous: ManualOrderMap,
  next: ManualOrderMap
): void {
  if (next !== previous) {
    void writeManualOrder(vaultFolderPath, next).catch(() => undefined);
  }
}

function appendManualOrderEntry(
  manualOrder: ManualOrderMap,
  parentRelativePath: string,
  basename: string
): ManualOrderMap {
  const entry = manualOrder[parentRelativePath];

  if (!entry) {
    return manualOrder;
  }

  return { ...manualOrder, [parentRelativePath]: [...entry, basename] };
}

function removeManualOrderEntry(
  manualOrder: ManualOrderMap,
  parentRelativePath: string,
  basename: string
): ManualOrderMap {
  const entry = manualOrder[parentRelativePath];

  if (!entry) {
    return manualOrder;
  }

  return { ...manualOrder, [parentRelativePath]: entry.filter((name) => name !== basename) };
}

function renameManualOrderEntry(
  manualOrder: ManualOrderMap,
  parentRelativePath: string,
  oldBasename: string,
  newBasename: string
): ManualOrderMap {
  const entry = manualOrder[parentRelativePath];

  if (!entry) {
    return manualOrder;
  }

  return {
    ...manualOrder,
    [parentRelativePath]: entry.map((name) => (name === oldBasename ? newBasename : name))
  };
}

function rekeyManualOrderFolderPrefix(
  manualOrder: ManualOrderMap,
  oldRelativePath: string,
  newRelativePath: string
): ManualOrderMap {
  const next: ManualOrderMap = {};
  let didChange = false;

  for (const [key, value] of Object.entries(manualOrder)) {
    if (key === oldRelativePath) {
      next[newRelativePath] = value;
      didChange = true;
    } else if (key.startsWith(`${oldRelativePath}/`)) {
      next[`${newRelativePath}${key.slice(oldRelativePath.length)}`] = value;
      didChange = true;
    } else {
      next[key] = value;
    }
  }

  return didChange ? next : manualOrder;
}

function removeManualOrderFolderPrefix(
  manualOrder: ManualOrderMap,
  relativePath: string
): ManualOrderMap {
  const next: ManualOrderMap = {};

  for (const [key, value] of Object.entries(manualOrder)) {
    if (key !== relativePath && !key.startsWith(`${relativePath}/`)) {
      next[key] = value;
    }
  }

  return next;
}

async function createLoadedFolderState(
  folderPath: string,
  markdownFiles: MarkdownFileRecord[]
) {
  const [sortMode, storedManualOrder] = await Promise.all([
    readSortMode(folderPath),
    readManualOrder(folderPath)
  ]);

  const manualOrder = await reconcileManualOrder(folderPath, storedManualOrder, markdownFiles, []);

  return {
    folderPath,
    filePaths: markdownFiles.map((record) => record.filePath),
    emptyFolderPaths: [] as string[],
    fileDocuments: {} as Record<string, FileDocumentState>,
    selectedFilePath: null,
    selectedFileContent: null,
    selectedFileBaseContent: null,
    isFileLoading: false,
    isSaving: false,
    isRefreshing: false,
    isDirty: false,
    fileError: null,
    saveError: null,
    sortMode,
    manualOrder,
    fileMtimeMs: buildFileMtimeMap(markdownFiles),
    emptyFolderMtimeMs: {} as Record<string, number>
  };
}

export const useAppStore = create<AppState>((set, get) => ({
  folderPath: null,
  filePaths: [],
  emptyFolderPaths: [],
  selectedFilePath: null,
  selectedFileContent: null,
  selectedFileBaseContent: null,
  fileDocuments: {},
  isLoading: false,
  isFileLoading: false,
  isSaving: false,
  isRefreshing: false,
  isDirty: false,
  folderError: null,
  fileError: null,
  saveError: null,
  sortMode: "name",
  manualOrder: {},
  fileMtimeMs: {},
  emptyFolderMtimeMs: {},
  openFolder: async () => {
    set({ isLoading: true, folderError: null });

    try {
      const folderPath = await chooseMarkdownFolder();

      if (folderPath === null) {
        set({ isLoading: false });
        return false;
      }

      await allowMarkdownFolderAccess(folderPath);
      const markdownFiles = await listMarkdownFiles(folderPath);
      const loadedState = await createLoadedFolderState(folderPath, markdownFiles);

      set({
        ...loadedState,
        isLoading: false,
        folderError: null
      });

      setLastOpenedFolderPath(folderPath);
      void watchMarkdownFolder(folderPath).catch(() => undefined);

      return true;
    } catch (error) {
      set({
        isLoading: false,
        folderError: toErrorMessage(error, i18n.t("store.folderLoadError"))
      });

      return false;
    }
  },
  openFolderAtPath: async (folderPath: string) => {
    if (!folderPath) {
      return false;
    }

    set({ isLoading: true, folderError: null });

    try {
      await allowMarkdownFolderAccess(folderPath);
      const markdownFiles = await listMarkdownFiles(folderPath);
      const loadedState = await createLoadedFolderState(folderPath, markdownFiles);

      set({
        ...loadedState,
        isLoading: false,
        folderError: null
      });

      setLastOpenedFolderPath(folderPath);
      void watchMarkdownFolder(folderPath).catch(() => undefined);

      return true;
    } catch (error) {
      set({
        isLoading: false,
        folderError: toErrorMessage(error, i18n.t("store.folderLoadError"))
      });

      return false;
    }
  },
  refreshFolderFiles: async () => {
    const { folderPath, selectedFilePath, fileDocuments, manualOrder, emptyFolderPaths } = get();

    if (!folderPath) {
      return false;
    }

    set({ isRefreshing: true, folderError: null });

    try {
      const markdownFiles = await listMarkdownFiles(folderPath);
      const nextFilePaths = markdownFiles.map((record) => record.filePath);
      const refreshedDocuments = await refreshCleanDocumentsFromDisk(
        fileDocuments,
        nextFilePaths
      );
      const nextDocuments = pruneDocumentsToCurrentFolder(
        refreshedDocuments,
        nextFilePaths,
        selectedFilePath
      );
      const selectedDocument = selectedFilePath ? nextDocuments[selectedFilePath] : null;
      const emptyFolderRelativePaths = emptyFolderPaths.map((path) =>
        getRelativeDisplayPath(folderPath, path)
      );
      const nextManualOrder = await reconcileManualOrder(
        folderPath,
        manualOrder,
        markdownFiles,
        emptyFolderRelativePaths
      );

      set({
        filePaths: nextFilePaths,
        fileDocuments: nextDocuments,
        fileMtimeMs: buildFileMtimeMap(markdownFiles),
        manualOrder: nextManualOrder,
        selectedFilePath: selectedDocument ? selectedFilePath : null,
        selectedFileContent: selectedDocument ? selectedDocument.content : null,
        selectedFileBaseContent: selectedDocument ? selectedDocument.baseContent : null,
        isFileLoading: false,
        isDirty: selectedDocument ? isDocumentDirty(selectedDocument) : false,
        isRefreshing: false,
        folderError: null
      });

      return true;
    } catch (error) {
      set({
        isRefreshing: false,
        folderError: toErrorMessage(error, i18n.t("store.fileListRefreshError"))
      });

      return false;
    }
  },
  selectFilePath: async (filePath: string) => {
    const existingDocument = get().fileDocuments[filePath];

    if (existingDocument) {
      set({
        selectedFilePath: filePath,
        selectedFileContent: existingDocument.content,
        selectedFileBaseContent: existingDocument.baseContent,
        isFileLoading: false,
        isSaving: false,
        isDirty: existingDocument.content !== existingDocument.baseContent,
        fileError: null,
        saveError: null
      });

      return true;
    }

    set({
      selectedFilePath: filePath,
      selectedFileContent: null,
      selectedFileBaseContent: null,
      isFileLoading: true,
      isSaving: false,
      isDirty: false,
      fileError: null,
      saveError: null
    });

    try {
      const markdown = await readMarkdownFile(filePath);

      const currentState = get();
      const nextDocumentState = {
        content: markdown,
        baseContent: markdown
      };

      if (currentState.selectedFilePath !== filePath) {
        set({
          fileDocuments: {
            ...currentState.fileDocuments,
            [filePath]: nextDocumentState
          }
        });

        return true;
      }

      set({
        fileDocuments: {
          ...currentState.fileDocuments,
          [filePath]: nextDocumentState
        },
        selectedFileContent: markdown,
        selectedFileBaseContent: markdown,
        isFileLoading: false,
        isSaving: false,
        isDirty: false,
        fileError: null,
        saveError: null
      });

      return true;
    } catch (error) {
      const currentState = get();

      if (currentState.selectedFilePath === filePath) {
        set({
          selectedFileContent: null,
          selectedFileBaseContent: null,
          isFileLoading: false,
          fileError: toErrorMessage(error, i18n.t("store.fileLoadError"))
        });
      }

      return false;
    }
  },
  updateSelectedFileContent: (markdown: string) => {
    const { selectedFilePath, selectedFileBaseContent, fileDocuments } = get();

    if (!selectedFilePath) {
      return;
    }

    const currentDocument = fileDocuments[selectedFilePath];
    const baseContent = currentDocument?.baseContent ?? selectedFileBaseContent ?? markdown;

    set({
      selectedFileContent: markdown,
      selectedFileBaseContent: baseContent,
      isDirty: markdown !== baseContent,
      fileDocuments: {
        ...fileDocuments,
        [selectedFilePath]: {
          content: markdown,
          baseContent
        }
      },
      saveError: null
    });
  },
  discardSelectedFileChanges: () => {
    const { selectedFilePath, selectedFileBaseContent, fileDocuments } = get();

    if (!selectedFilePath || selectedFileBaseContent === null) {
      return false;
    }

    set({
      selectedFileContent: selectedFileBaseContent,
      selectedFileBaseContent,
      isDirty: false,
      fileDocuments: {
        ...fileDocuments,
        [selectedFilePath]: {
          content: selectedFileBaseContent,
          baseContent: selectedFileBaseContent
        }
      },
      saveError: null
    });

    return true;
  },
  saveSelectedFile: async () => {
    const { selectedFilePath, selectedFileContent, folderPath, fileDocuments } = get();

    if (!selectedFilePath || selectedFileContent === null) {
      return false;
    }

    const previousBaseContent = fileDocuments[selectedFilePath]?.baseContent ?? selectedFileContent;

    set({ isSaving: true, saveError: null });

    try {
      await writeMarkdownFile(selectedFilePath, selectedFileContent);

      if (folderPath) {
        void cleanupOrphanedImages(
          folderPath,
          selectedFilePath,
          previousBaseContent,
          selectedFileContent
        ).catch(() => undefined);
      }

      const currentState = get();
      const currentDocument = currentState.fileDocuments[selectedFilePath];
      const nextSelectedContent =
        currentState.selectedFilePath === selectedFilePath
          ? currentState.selectedFileContent ?? selectedFileContent
          : currentDocument?.content ?? selectedFileContent;

      set({
        fileDocuments: {
          ...currentState.fileDocuments,
          [selectedFilePath]: {
            content: nextSelectedContent,
            baseContent: selectedFileContent
          }
        },
        selectedFileBaseContent:
          currentState.selectedFilePath === selectedFilePath
            ? selectedFileContent
            : currentState.selectedFileBaseContent,
        isSaving: false,
        isDirty:
          currentState.selectedFilePath === selectedFilePath
            ? nextSelectedContent !== selectedFileContent
            : currentState.isDirty,
        saveError: null
      });

      return true;
    } catch (error) {
      set({
        isSaving: false,
        saveError: toErrorMessage(error, i18n.t("store.fileSaveError"))
      });

      return false;
    }
  },
  createNewFile: async (targetDirectory?: string) => {
    const { folderPath, selectedFilePath, filePaths, fileDocuments } = get();

    if (!folderPath) {
      return null;
    }

    try {
      const resolvedTargetDirectory =
        targetDirectory ?? (selectedFilePath ? await dirname(selectedFilePath) : folderPath);

      const newFileBaseName = i18n.t("store.newFileBaseName");
      const existingPathKeys = new Set(filePaths.map(normalizePathKey));
      let newFilePath = await join(resolvedTargetDirectory, `${newFileBaseName}.md`);
      let suffix = 2;

      while (existingPathKeys.has(normalizePathKey(newFilePath))) {
        newFilePath = await join(resolvedTargetDirectory, `${newFileBaseName} ${suffix}.md`);
        suffix += 1;
      }

      await writeMarkdownFile(newFilePath, "");

      const parentRelativePath = getRelativeDisplayPath(folderPath, resolvedTargetDirectory);
      const currentManualOrder = get().manualOrder;
      const nextManualOrder = appendManualOrderEntry(
        currentManualOrder,
        parentRelativePath,
        getBasename(newFilePath)
      );
      persistManualOrderIfChanged(folderPath, currentManualOrder, nextManualOrder);

      set({
        filePaths: insertFilePathSorted(filePaths, newFilePath),
        manualOrder: nextManualOrder,
        fileDocuments: {
          ...fileDocuments,
          [newFilePath]: { content: "", baseContent: "" }
        },
        selectedFilePath: newFilePath,
        selectedFileContent: "",
        selectedFileBaseContent: "",
        isFileLoading: false,
        isSaving: false,
        isDirty: false,
        fileError: null,
        saveError: null
      });

      return newFilePath;
    } catch (error) {
      set({
        fileError: toErrorMessage(error, i18n.t("store.fileCreateError"))
      });

      return null;
    }
  },
  // Optimistically registers files the import wrote to the vault root: adds
  // them to the tree and appends them to the manual sort order (mirroring
  // createNewFile), without selecting them or touching the open editor.
  registerImportedFiles: (importedFilePaths: string[]) => {
    const { folderPath } = get();

    if (!folderPath || importedFilePaths.length === 0) {
      return;
    }

    let nextFilePaths = get().filePaths;
    const existingPathKeys = new Set(nextFilePaths.map(normalizePathKey));
    const currentManualOrder = get().manualOrder;
    let nextManualOrder = currentManualOrder;

    for (const importedFilePath of importedFilePaths) {
      if (existingPathKeys.has(normalizePathKey(importedFilePath))) {
        continue;
      }

      existingPathKeys.add(normalizePathKey(importedFilePath));
      nextFilePaths = insertFilePathSorted(nextFilePaths, importedFilePath);
      nextManualOrder = appendManualOrderEntry(nextManualOrder, "", getBasename(importedFilePath));
    }

    persistManualOrderIfChanged(folderPath, currentManualOrder, nextManualOrder);

    set({
      filePaths: nextFilePaths,
      manualOrder: nextManualOrder
    });
  },
  createNewFolder: async () => {
    const { folderPath, selectedFilePath, emptyFolderPaths } = get();

    if (!folderPath) {
      return null;
    }

    try {
      const targetDirectory = selectedFilePath
        ? await dirname(selectedFilePath)
        : folderPath;

      const newFolderPath = await createUniqueMarkdownFolder(
        targetDirectory,
        i18n.t("store.newFolderBaseName")
      );

      const parentRelativePath = getRelativeDisplayPath(folderPath, targetDirectory);
      const currentManualOrder = get().manualOrder;
      const nextManualOrder = appendManualOrderEntry(
        currentManualOrder,
        parentRelativePath,
        getBasename(newFolderPath)
      );
      persistManualOrderIfChanged(folderPath, currentManualOrder, nextManualOrder);

      set({
        emptyFolderPaths: [...emptyFolderPaths, newFolderPath],
        manualOrder: nextManualOrder,
        fileError: null
      });

      return newFolderPath;
    } catch (error) {
      set({
        fileError: toErrorMessage(error, i18n.t("store.folderCreateError"))
      });

      return null;
    }
  },
  renameFolderPath: async (folderPath: string, newBaseName: string) => {
    const trimmedBaseName = newBaseName.trim();

    if (!trimmedBaseName || INVALID_FILE_NAME_CHARS.test(trimmedBaseName)) {
      set({ fileError: i18n.t("store.invalidFileName") });
      return false;
    }

    try {
      const parentDirectory = await dirname(folderPath);
      const newFolderPath = await join(parentDirectory, trimmedBaseName);

      if (normalizePathKey(newFolderPath) === normalizePathKey(folderPath)) {
        return true;
      }

      if (await markdownFolderExists(newFolderPath)) {
        set({ fileError: i18n.t("store.folderAlreadyExists") });
        return false;
      }

      await renameMarkdownFolder(folderPath, newFolderPath);

      const currentState = get();
      const nextFilePaths = await Promise.all(
        currentState.filePaths.map((path) =>
          remapPathUnderRenamedFolder(path, folderPath, newFolderPath)
        )
      );
      const nextEmptyFolderPaths = await Promise.all(
        currentState.emptyFolderPaths.map((path) =>
          remapPathUnderRenamedFolder(path, folderPath, newFolderPath)
        )
      );

      const nextDocuments: Record<string, FileDocumentState> = {};

      for (const [path, document] of Object.entries(currentState.fileDocuments)) {
        const oldIndex = currentState.filePaths.indexOf(path);
        nextDocuments[oldIndex === -1 ? path : nextFilePaths[oldIndex]] = document;
      }

      const nextSelectedFilePath = currentState.selectedFilePath
        ? await remapPathUnderRenamedFolder(currentState.selectedFilePath, folderPath, newFolderPath)
        : currentState.selectedFilePath;

      let nextManualOrder = currentState.manualOrder;

      if (currentState.folderPath) {
        const vaultRootPath = currentState.folderPath;
        const oldRelativePath = getRelativeDisplayPath(vaultRootPath, folderPath);
        const newRelativePath = getRelativeDisplayPath(vaultRootPath, newFolderPath);
        const parentRelativePath = getRelativeDisplayPath(vaultRootPath, parentDirectory);

        nextManualOrder = renameManualOrderEntry(
          nextManualOrder,
          parentRelativePath,
          getBasename(folderPath),
          getBasename(newFolderPath)
        );
        nextManualOrder = rekeyManualOrderFolderPrefix(nextManualOrder, oldRelativePath, newRelativePath);

        persistManualOrderIfChanged(vaultRootPath, currentState.manualOrder, nextManualOrder);
      }

      set({
        filePaths: nextFilePaths,
        emptyFolderPaths: nextEmptyFolderPaths,
        fileDocuments: nextDocuments,
        selectedFilePath: nextSelectedFilePath,
        manualOrder: nextManualOrder,
        fileError: null
      });

      return true;
    } catch (error) {
      set({
        fileError: toErrorMessage(error, i18n.t("store.folderRenameError"))
      });

      return false;
    }
  },
  renameSelectedFile: async (newBaseName: string) => {
    const { selectedFilePath } = get();

    if (!selectedFilePath) {
      return false;
    }

    return get().renameFilePath(selectedFilePath, newBaseName);
  },
  renameFilePath: async (filePath: string, newBaseName: string) => {
    const { filePaths, fileDocuments } = get();

    const trimmedBaseName = newBaseName.trim();

    if (!trimmedBaseName || INVALID_FILE_NAME_CHARS.test(trimmedBaseName)) {
      set({ fileError: i18n.t("store.invalidFileName") });
      return false;
    }

    try {
      const targetDirectory = await dirname(filePath);
      const newFilePath = await join(targetDirectory, `${trimmedBaseName}.md`);

      if (normalizePathKey(newFilePath) === normalizePathKey(filePath)) {
        return true;
      }

      const existingPathKeys = new Set(filePaths.map(normalizePathKey));

      if (existingPathKeys.has(normalizePathKey(newFilePath))) {
        set({ fileError: i18n.t("store.fileAlreadyExists") });
        return false;
      }

      await renameMarkdownFile(filePath, newFilePath);

      const currentState = get();
      const nextDocuments = { ...currentState.fileDocuments };
      const movedDocument = nextDocuments[filePath] ?? fileDocuments[filePath];

      delete nextDocuments[filePath];

      if (movedDocument) {
        nextDocuments[newFilePath] = movedDocument;
      }

      let nextManualOrder = currentState.manualOrder;

      if (currentState.folderPath) {
        const parentRelativePath = getRelativeDisplayPath(currentState.folderPath, targetDirectory);

        nextManualOrder = renameManualOrderEntry(
          nextManualOrder,
          parentRelativePath,
          getBasename(filePath),
          getBasename(newFilePath)
        );

        persistManualOrderIfChanged(currentState.folderPath, currentState.manualOrder, nextManualOrder);
      }

      set({
        filePaths: insertFilePathSorted(
          currentState.filePaths.filter((path) => path !== filePath),
          newFilePath
        ),
        fileDocuments: nextDocuments,
        selectedFilePath:
          currentState.selectedFilePath === filePath
            ? newFilePath
            : currentState.selectedFilePath,
        manualOrder: nextManualOrder,
        fileError: null
      });

      return true;
    } catch (error) {
      set({
        fileError: toErrorMessage(error, i18n.t("store.fileRenameError"))
      });

      return false;
    }
  },
  deleteFilePath: async (filePath: string) => {
    const { fileDocuments, selectedFilePath, folderPath } = get();

    try {
      const contentBeforeDelete =
        fileDocuments[filePath]?.baseContent ?? (await readMarkdownFile(filePath).catch(() => ""));

      await deleteMarkdownFile(filePath);

      if (folderPath) {
        void cleanupOrphanedImages(folderPath, filePath, contentBeforeDelete, "").catch(() => undefined);
      }

      const nextDocuments = { ...fileDocuments };
      delete nextDocuments[filePath];

      const isSelected = selectedFilePath === filePath;
      const currentState = get();

      let nextManualOrder = currentState.manualOrder;

      if (folderPath) {
        const parentDirectory = await dirname(filePath);
        const parentRelativePath = getRelativeDisplayPath(folderPath, parentDirectory);

        nextManualOrder = removeManualOrderEntry(nextManualOrder, parentRelativePath, getBasename(filePath));
        persistManualOrderIfChanged(folderPath, currentState.manualOrder, nextManualOrder);
      }

      set({
        filePaths: currentState.filePaths.filter((path) => path !== filePath),
        fileDocuments: nextDocuments,
        selectedFilePath: isSelected ? null : currentState.selectedFilePath,
        selectedFileContent: isSelected ? null : currentState.selectedFileContent,
        selectedFileBaseContent: isSelected ? null : currentState.selectedFileBaseContent,
        isDirty: isSelected ? false : currentState.isDirty,
        manualOrder: nextManualOrder,
        fileError: null
      });

      return true;
    } catch (error) {
      set({
        fileError: toErrorMessage(error, i18n.t("store.fileDeleteError"))
      });

      return false;
    }
  },
  deleteFolderPath: async (folderPath: string) => {
    try {
      await deleteMarkdownFolder(folderPath);

      const currentState = get();
      const isSelectedInside =
        currentState.selectedFilePath !== null &&
        isPathInsideFolder(currentState.selectedFilePath, folderPath);
      const nextDocuments = { ...currentState.fileDocuments };

      for (const path of currentState.filePaths) {
        if (isPathInsideFolder(path, folderPath)) {
          delete nextDocuments[path];
        }
      }

      let nextManualOrder = currentState.manualOrder;

      if (currentState.folderPath) {
        const vaultRootPath = currentState.folderPath;
        const parentDirectory = await dirname(folderPath);
        const parentRelativePath = getRelativeDisplayPath(vaultRootPath, parentDirectory);
        const ownRelativePath = getRelativeDisplayPath(vaultRootPath, folderPath);

        nextManualOrder = removeManualOrderEntry(nextManualOrder, parentRelativePath, getBasename(folderPath));
        nextManualOrder = removeManualOrderFolderPrefix(nextManualOrder, ownRelativePath);

        persistManualOrderIfChanged(vaultRootPath, currentState.manualOrder, nextManualOrder);
      }

      set({
        filePaths: currentState.filePaths.filter((path) => !isPathInsideFolder(path, folderPath)),
        emptyFolderPaths: currentState.emptyFolderPaths.filter(
          (path) =>
            normalizePathKey(path) !== normalizePathKey(folderPath) &&
            !isPathInsideFolder(path, folderPath)
        ),
        fileDocuments: nextDocuments,
        selectedFilePath: isSelectedInside ? null : currentState.selectedFilePath,
        selectedFileContent: isSelectedInside ? null : currentState.selectedFileContent,
        selectedFileBaseContent: isSelectedInside ? null : currentState.selectedFileBaseContent,
        isDirty: isSelectedInside ? false : currentState.isDirty,
        manualOrder: nextManualOrder,
        fileError: null
      });

      return true;
    } catch (error) {
      set({
        fileError: toErrorMessage(error, i18n.t("store.folderDeleteError"))
      });

      return false;
    }
  },
  setSortMode: async (mode: SortMode) => {
    const { folderPath } = get();

    set({ sortMode: mode });

    if (!folderPath) {
      return;
    }

    void writeSortMode(folderPath, mode).catch(() => undefined);
  },
  reorderWithinFolder: async (parentDirectory: string, orderedBasenames: string[]) => {
    const { folderPath, manualOrder } = get();

    if (!folderPath) {
      return false;
    }

    const parentRelativePath = getRelativeDisplayPath(folderPath, parentDirectory);
    const nextManualOrder = { ...manualOrder, [parentRelativePath]: orderedBasenames };

    set({ manualOrder: nextManualOrder });
    void writeManualOrder(folderPath, nextManualOrder).catch(() => undefined);

    return true;
  },
  moveTreeEntry: async (input: MoveTreeEntryInput) => {
    const { kind, sourcePath, targetParentDirectory, targetIndex } = input;
    const state = get();
    const { folderPath, filePaths, emptyFolderPaths, fileDocuments, manualOrder } = state;

    if (!folderPath) {
      return false;
    }

    try {
      const basename = getBasename(sourcePath);
      const sourceParentDirectory = await dirname(sourcePath);
      const isSameParent =
        normalizePathKey(sourceParentDirectory) === normalizePathKey(targetParentDirectory);

      if (kind === "folder" && !isSameParent) {
        const sourceRelativePath = getRelativeDisplayPath(folderPath, sourcePath);
        const targetRelativePath = getRelativeDisplayPath(folderPath, targetParentDirectory);

        if (isDescendantRelativePath(sourceRelativePath, targetRelativePath)) {
          set({ fileError: i18n.t("store.folderMoveIntoDescendantError") });
          return false;
        }
      }

      let newPath = sourcePath;

      if (!isSameParent) {
        newPath = await join(targetParentDirectory, basename);

        const destinationExists =
          kind === "folder"
            ? await markdownFolderExists(newPath)
            : filePaths.some((path) => normalizePathKey(path) === normalizePathKey(newPath));

        if (destinationExists) {
          set({
            fileError: i18n.t(kind === "folder" ? "store.folderAlreadyExists" : "store.fileAlreadyExists")
          });
          return false;
        }
      }

      const sourceParentRelativePath = getRelativeDisplayPath(folderPath, sourceParentDirectory);
      const targetParentRelativePath = getRelativeDisplayPath(folderPath, targetParentDirectory);

      // Lazily seed manual order for both parents from the current on-screen
      // order, so unrelated siblings don't visually reshuffle.
      const childrenByParent = getChildBasenamesByParent(
        filePaths.map((filePath) => ({
          filePath,
          relativePath: getRelativeDisplayPath(folderPath, filePath),
          mtimeMs: 0
        })),
        emptyFolderPaths.map((path) => getRelativeDisplayPath(folderPath, path))
      );

      let seededManualOrder = manualOrder;

      for (const parentRelativePath of new Set([sourceParentRelativePath, targetParentRelativePath])) {
        if (seededManualOrder[parentRelativePath]) {
          continue;
        }

        const currentChildren = childrenByParent.get(parentRelativePath) ?? [];
        seededManualOrder = {
          ...seededManualOrder,
          [parentRelativePath]: [...currentChildren].sort((left, right) =>
            left.localeCompare(right, undefined, { numeric: true, sensitivity: "base" })
          )
        };
      }

      let nextFilePaths = filePaths;
      let nextEmptyFolderPaths = emptyFolderPaths;
      let nextDocuments = fileDocuments;
      let nextSelectedFilePath = state.selectedFilePath;

      if (!isSameParent) {
        const affectedFilePaths =
          kind === "file" ? [sourcePath] : filePaths.filter((path) => isPathInsideFolder(path, sourcePath));

        const preMoveContentByPath = new Map<string, string>();

        for (const path of affectedFilePaths) {
          const baseContent = fileDocuments[path]?.baseContent;
          preMoveContentByPath.set(path, baseContent ?? (await readMarkdownFile(path).catch(() => "")));
        }

        if (kind === "folder") {
          await renameMarkdownFolder(sourcePath, newPath);
        } else {
          await renameMarkdownFile(sourcePath, newPath);
        }

        nextFilePaths = await Promise.all(
          filePaths.map((path) => remapPathUnderRenamedFolder(path, sourcePath, newPath))
        );
        nextEmptyFolderPaths = await Promise.all(
          emptyFolderPaths.map((path) => remapPathUnderRenamedFolder(path, sourcePath, newPath))
        );

        const rewrittenDocuments: Record<string, FileDocumentState> = {};

        for (const [path, document] of Object.entries(fileDocuments)) {
          const oldIndex = filePaths.indexOf(path);
          const mappedPath =
            oldIndex === -1
              ? await remapPathUnderRenamedFolder(path, sourcePath, newPath)
              : nextFilePaths[oldIndex];

          if (preMoveContentByPath.has(path)) {
            const oldDirPath = await dirname(path);
            const correctedBaseContent = await rewriteRelativeImagePaths(
              preMoveContentByPath.get(path) ?? "",
              oldDirPath,
              mappedPath,
              folderPath
            );
            const correctedContent =
              document.content === document.baseContent
                ? correctedBaseContent
                : await rewriteRelativeImagePaths(document.content, oldDirPath, mappedPath, folderPath);

            rewrittenDocuments[mappedPath] = {
              content: correctedContent,
              baseContent: correctedBaseContent
            };
          } else {
            rewrittenDocuments[mappedPath] = document;
          }
        }

        nextDocuments = rewrittenDocuments;

        await Promise.all(
          affectedFilePaths
            .filter((path) => !(path in fileDocuments))
            .map(async (path) => {
              const mappedPath = await remapPathUnderRenamedFolder(path, sourcePath, newPath);
              const oldDirPath = await dirname(path);
              const preMoveContent = preMoveContentByPath.get(path) ?? "";
              const correctedContent = await rewriteRelativeImagePaths(
                preMoveContent,
                oldDirPath,
                mappedPath,
                folderPath
              );

              if (correctedContent !== preMoveContent) {
                await writeMarkdownFile(mappedPath, correctedContent).catch(() => undefined);
              }
            })
        );

        nextSelectedFilePath = state.selectedFilePath
          ? await remapPathUnderRenamedFolder(state.selectedFilePath, sourcePath, newPath)
          : state.selectedFilePath;
      }

      const finalBasename = getBasename(newPath);
      const withoutSource = { ...seededManualOrder };

      if (withoutSource[sourceParentRelativePath]) {
        withoutSource[sourceParentRelativePath] = withoutSource[sourceParentRelativePath].filter(
          (name) => name !== basename
        );
      }

      const targetArray = [...(withoutSource[targetParentRelativePath] ?? [])];
      const clampedIndex = Math.max(0, Math.min(targetIndex, targetArray.length));
      targetArray.splice(clampedIndex, 0, finalBasename);
      withoutSource[targetParentRelativePath] = targetArray;

      void writeManualOrder(folderPath, withoutSource).catch(() => undefined);

      set({
        filePaths: nextFilePaths,
        emptyFolderPaths: nextEmptyFolderPaths,
        fileDocuments: nextDocuments,
        selectedFilePath: nextSelectedFilePath,
        manualOrder: withoutSource,
        fileError: null
      });

      return true;
    } catch (error) {
      set({
        fileError: toErrorMessage(error, i18n.t("store.entryMoveError"))
      });

      return false;
    }
  }
}));