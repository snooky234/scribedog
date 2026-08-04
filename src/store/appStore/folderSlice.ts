import { dirname, join } from "@tauri-apps/api/path";

import i18n from "@/i18n";
import {
  addRecentFolderPath,
  allowMarkdownFolderAccess,
  chooseMarkdownFolder,
  createMarkdownFolderAtPath,
  createUniqueMarkdownFolder,
  deleteMarkdownFolder,
  getRelativeDisplayPath,
  listMarkdownFiles,
  markdownFolderExists,
  removeRecentFolderPath,
  renameMarkdownFolder,
  setLastOpenedFolderPath,
  watchMarkdownFolder
} from "@/lib/fileSystem";

import {
  isDocumentDirty,
  pruneDocumentsToCurrentFolder,
  refreshCleanDocumentsFromDisk
} from "./documents";
import { toErrorMessage } from "./errors";
import { buildFileMtimeMap, createLoadedFolderState } from "./folderState";
import {
  currentChildBasenames,
  ensureManualOrderEntry,
  insertManualOrderEntry,
  persistManualOrderIfChanged,
  reconcileManualOrder,
  rekeyManualOrderFolderPrefix,
  removeManualOrderEntry,
  removeManualOrderFolderPrefix,
  renameManualOrderEntry,
  resolveManualOrderInsertIndex
} from "./manualOrder";
import {
  getBasename,
  INVALID_FILE_NAME_CHARS,
  isPathInsideFolder,
  normalizePathKey,
  remapPathUnderRenamedFolder
} from "./pathUtils";
import type { AppSlice, FileDocumentState, FolderSlice } from "./types";
import { deleteFolderVersionHistory, moveFolderVersionHistory } from "./versioning";

export const createFolderSlice: AppSlice<FolderSlice> = (set, get) => ({
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
      addRecentFolderPath(folderPath);
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
      addRecentFolderPath(folderPath);
      void watchMarkdownFolder(folderPath).catch(() => undefined);

      return true;
    } catch (error) {
      // The folder may have been moved/deleted since it was last opened — a
      // stale recent-folders entry the user can never successfully pick again
      // is worse than silently dropping it.
      removeRecentFolderPath(folderPath);

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
  createNewFolder: async (targetDirectory?: string, insertAfterBasename?: string | null) => {
    const { folderPath, filePaths, emptyFolderPaths } = get();

    if (!folderPath) {
      return null;
    }

    try {
      const resolvedTargetDirectory = targetDirectory ?? folderPath;

      const newFolderPath = await createUniqueMarkdownFolder(
        resolvedTargetDirectory,
        i18n.t("store.newFolderBaseName")
      );

      const parentRelativePath = getRelativeDisplayPath(folderPath, resolvedTargetDirectory);
      const currentManualOrder = get().manualOrder;
      const seededManualOrder = ensureManualOrderEntry(
        currentManualOrder,
        parentRelativePath,
        currentChildBasenames(folderPath, filePaths, emptyFolderPaths, parentRelativePath)
      );
      const insertIndex = resolveManualOrderInsertIndex(
        seededManualOrder,
        parentRelativePath,
        insertAfterBasename
      );
      const nextManualOrder = insertManualOrderEntry(
        seededManualOrder,
        parentRelativePath,
        getBasename(newFolderPath),
        insertIndex
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
  // The agent's create_folder: the folder gets the name it was given, and
  // registers as an empty folder so the tree shows it before anything is in it.
  createFolderAtPath: async (targetFolderPath: string) => {
    const { folderPath, filePaths, emptyFolderPaths } = get();

    if (!folderPath) {
      return false;
    }

    try {
      await createMarkdownFolderAtPath(targetFolderPath);

      const alreadyKnown = emptyFolderPaths.some(
        (path) => normalizePathKey(path) === normalizePathKey(targetFolderPath)
      );

      if (alreadyKnown) {
        return true;
      }

      const parentDirectory = await dirname(targetFolderPath);
      const parentRelativePath = getRelativeDisplayPath(folderPath, parentDirectory);
      const currentManualOrder = get().manualOrder;
      const seededManualOrder = ensureManualOrderEntry(
        currentManualOrder,
        parentRelativePath,
        currentChildBasenames(folderPath, filePaths, emptyFolderPaths, parentRelativePath)
      );
      const nextManualOrder = insertManualOrderEntry(
        seededManualOrder,
        parentRelativePath,
        getBasename(targetFolderPath),
        (seededManualOrder[parentRelativePath] ?? []).length
      );
      persistManualOrderIfChanged(folderPath, currentManualOrder, nextManualOrder);

      set({
        emptyFolderPaths: [...get().emptyFolderPaths, targetFolderPath],
        manualOrder: nextManualOrder,
        fileError: null
      });

      return true;
    } catch (error) {
      set({
        fileError: toErrorMessage(error, i18n.t("store.folderCreateError"))
      });

      return false;
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
      moveFolderVersionHistory(get().folderPath, folderPath, newFolderPath);

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
  deleteFolderPath: async (folderPath: string) => {
    try {
      await deleteMarkdownFolder(folderPath);
      deleteFolderVersionHistory(get().folderPath, folderPath);

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
  }
});
