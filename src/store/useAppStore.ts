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
  setLastOpenedFolderPath,
  watchMarkdownFolder,
  writeMarkdownFile
} from "@/lib/fileSystem";

type FileDocumentState = {
  content: string;
  baseContent: string;
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
  openFolder: () => Promise<boolean>;
  openFolderAtPath: (folderPath: string) => Promise<boolean>;
  refreshFolderFiles: () => Promise<boolean>;
  selectFilePath: (filePath: string) => Promise<boolean>;
  updateSelectedFileContent: (markdown: string) => void;
  discardSelectedFileChanges: () => boolean;
  saveSelectedFile: () => Promise<boolean>;
  createNewFile: (targetDirectory?: string) => Promise<string | null>;
  createNewFolder: () => Promise<string | null>;
  renameSelectedFile: (newBaseName: string) => Promise<boolean>;
  renameFilePath: (filePath: string, newBaseName: string) => Promise<boolean>;
  renameFolderPath: (folderPath: string, newBaseName: string) => Promise<boolean>;
  deleteFilePath: (filePath: string) => Promise<boolean>;
  deleteFolderPath: (folderPath: string) => Promise<boolean>;
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

function createLoadedFolderState(
  folderPath: string,
  markdownFiles: MarkdownFileRecord[]
) {
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
    saveError: null
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

      set({
        ...createLoadedFolderState(folderPath, markdownFiles),
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

      set({
        ...createLoadedFolderState(folderPath, markdownFiles),
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
    const { folderPath, selectedFilePath, fileDocuments } = get();

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

      set({
        filePaths: nextFilePaths,
        fileDocuments: nextDocuments,
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

      set({
        filePaths: insertFilePathSorted(filePaths, newFilePath),
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

      set({
        emptyFolderPaths: [...emptyFolderPaths, newFolderPath],
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

      set({
        filePaths: nextFilePaths,
        emptyFolderPaths: nextEmptyFolderPaths,
        fileDocuments: nextDocuments,
        selectedFilePath: nextSelectedFilePath,
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

      set({
        filePaths: currentState.filePaths.filter((path) => path !== filePath),
        fileDocuments: nextDocuments,
        selectedFilePath: isSelected ? null : currentState.selectedFilePath,
        selectedFileContent: isSelected ? null : currentState.selectedFileContent,
        selectedFileBaseContent: isSelected ? null : currentState.selectedFileBaseContent,
        isDirty: isSelected ? false : currentState.isDirty,
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
        fileError: null
      });

      return true;
    } catch (error) {
      set({
        fileError: toErrorMessage(error, i18n.t("store.folderDeleteError"))
      });

      return false;
    }
  }
}));