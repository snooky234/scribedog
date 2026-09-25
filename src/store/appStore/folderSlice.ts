import { platform, setActiveVaultStorage } from "@/platform";
import { dirname, join } from "@/platform/paths";
import { isRemoteVaultPath } from "@/platform/remote/vaultRoot";

import i18n from "@/i18n";
import {
  addRecentFolderPath,
  allowMarkdownFolderAccess,
  chooseMarkdownFolder,
  cleanupImagesOfDeletedFiles,
  clearLastOpenedFolderPath,
  createMarkdownFolderAtPath,
  createUniqueMarkdownFolder,
  deleteMarkdownFolder,
  getRelativeDisplayPath,
  listMarkdownFiles,
  markdownFolderExists,
  readMarkdownFile,
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
import { deleteFolderDraftsFor, flushDrafts, moveFolderDraftsFor } from "./drafts";
import { toErrorMessage } from "./errors";
import { buildFileMtimeMap, createLoadedFolderState } from "./folderState";
import { dropVaultIcons, moveVaultIcons } from "./icons";
import { initialAppData } from "./initialState";
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
  remapPathUnderRenamedFolder,
  resolveTargetDirectoryInVault
} from "./pathUtils";
import type { AppSlice, FileDocumentState, FolderSlice } from "./types";
import { deleteFolderVersionHistory, moveFolderVersionHistory } from "./versioning";
import { pruneWorkingSet } from "./workingSet";
import { persistWorkingSet } from "./workingSetSlice";

export const createFolderSlice: AppSlice<FolderSlice> = (set, get) => ({
  openFolder: async () => {
    set({ isLoading: true, folderError: null });

    try {
      const folderPath = await chooseMarkdownFolder();

      if (folderPath === null) {
        set({ isLoading: false });
        return false;
      }

      // The document map is about to be replaced; nothing may still sit in
      // the draft timer when it goes.
      await flushDrafts();
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
      await flushDrafts();
      await allowMarkdownFolderAccess(folderPath);
      const markdownFiles = await listMarkdownFiles(folderPath);
      const loadedState = await createLoadedFolderState(folderPath, markdownFiles);

      set({
        ...loadedState,
        isLoading: false,
        folderError: null
      });

      // The recent-folders list is a list of local folders; a server vault
      // (the browser, later the desktop as remote client) has no place in it.
      if (platform.features.localFolders) {
        setLastOpenedFolderPath(folderPath);
        addRecentFolderPath(folderPath);
      }

      void watchMarkdownFolder(folderPath).catch(() => undefined);

      return true;
    } catch (error) {
      // The folder may have been moved/deleted since it was last opened — a
      // stale recent-folders entry the user can never successfully pick again
      // is worse than silently dropping it. A server vault is different: a
      // server that is away or refusing the token right now is still the
      // user's server, and the entry stays.
      if (!isRemoteVaultPath(folderPath)) {
        removeRecentFolderPath(folderPath);
      }

      set({
        isLoading: false,
        folderError: toErrorMessage(error, i18n.t("store.folderLoadError"))
      });

      return false;
    }
  },
  closeFolder: () => {
    // Pending drafts carry their own vault path, so they can still go out
    // after the store has forgotten the folder.
    void flushDrafts();
    setActiveVaultStorage(null);
    clearLastOpenedFolderPath();
    set({ ...initialAppData });
  },
  refreshFolderFiles: async () => {
    const { folderPath, fileDocuments, manualOrder, emptyFolderPaths } = get();

    if (!folderPath) {
      return false;
    }

    set({ isRefreshing: true, folderError: null });

    try {
      // Empty folders are not in the markdown listing, so a folder deleted
      // outside the app would otherwise stay in the tree for the whole
      // session. A failed check keeps the folder: hiding one that is still
      // there is worse than showing one a moment too long.
      const [markdownFiles, emptyFolderExists] = await Promise.all([
        listMarkdownFiles(folderPath),
        Promise.all(emptyFolderPaths.map((path) => markdownFolderExists(path).catch(() => true)))
      ]);
      const nextFilePaths = markdownFiles.map((record) => record.filePath);
      const refreshedDocuments = await refreshCleanDocumentsFromDisk(fileDocuments, markdownFiles);

      // The reads above take time (a round trip per file on a server vault),
      // and the user keeps typing meanwhile. Anything that changed in the
      // store since the snapshot was taken wins over the snapshot: writing
      // the stale copy back would undo those keystrokes in the open editor.
      const latestState = get();
      const mergedDocuments: Record<string, FileDocumentState> = { ...refreshedDocuments };

      for (const [path, latestDocument] of Object.entries(latestState.fileDocuments)) {
        const snapshot = fileDocuments[path];

        if (
          !snapshot ||
          latestDocument.content !== snapshot.content ||
          latestDocument.baseContent !== snapshot.baseContent
        ) {
          mergedDocuments[path] = latestDocument;
        }
      }

      const currentSelectedFilePath = latestState.selectedFilePath;
      const nextDocuments = pruneDocumentsToCurrentFolder(
        mergedDocuments,
        nextFilePaths,
        currentSelectedFilePath
      );
      const selectedDocument = currentSelectedFilePath ? nextDocuments[currentSelectedFilePath] : null;
      // Filtered against the latest list, so a folder created while the
      // checks were in flight survives.
      const vanishedEmptyFolderKeys = new Set(
        emptyFolderPaths.filter((_, index) => !emptyFolderExists[index]).map(normalizePathKey)
      );
      const nextEmptyFolderPaths =
        vanishedEmptyFolderKeys.size === 0
          ? latestState.emptyFolderPaths
          : latestState.emptyFolderPaths.filter((path) => !vanishedEmptyFolderKeys.has(normalizePathKey(path)));
      const emptyFolderRelativePaths = nextEmptyFolderPaths.map((path) =>
        getRelativeDisplayPath(folderPath, path)
      );
      const nextManualOrder = await reconcileManualOrder(
        folderPath,
        manualOrder,
        markdownFiles,
        emptyFolderRelativePaths
      );
      // An entry survives exactly as long as its document would: on disk,
      // or dirty, or a proposal / unwritten folder note the pruning kept.
      const nextFilePathSet = new Set(nextFilePaths);
      const nextWorkingSet = pruneWorkingSet(
        latestState.workingSet,
        (path) => nextFilePathSet.has(path) || path in nextDocuments
      );

      set({
        filePaths: nextFilePaths,
        emptyFolderPaths: nextEmptyFolderPaths,
        fileDocuments: nextDocuments,
        fileMtimeMs: buildFileMtimeMap(markdownFiles),
        manualOrder: nextManualOrder,
        workingSet: nextWorkingSet,
        selectedFilePath: selectedDocument ? currentSelectedFilePath : null,
        selectedFileContent: selectedDocument ? selectedDocument.content : null,
        selectedFileBaseContent: selectedDocument ? selectedDocument.baseContent : null,
        isFileLoading: false,
        isDirty: selectedDocument ? isDocumentDirty(selectedDocument) : false,
        isRefreshing: false,
        folderError: null
      });

      if (nextWorkingSet.length !== latestState.workingSet.length) {
        persistWorkingSet(folderPath, nextWorkingSet);
      }

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
      const resolvedTargetDirectory = resolveTargetDirectoryInVault(folderPath, targetDirectory);

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
      moveFolderDraftsFor(get().folderPath, folderPath, newFolderPath);

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
      const remappedWorkingSetPaths = await Promise.all(
        currentState.workingSet.map((entry) => remapPathUnderRenamedFolder(entry.filePath, folderPath, newFolderPath))
      );
      const nextWorkingSet = currentState.workingSet.map((entry, index) =>
        remappedWorkingSetPaths[index] === entry.filePath ? entry : { ...entry, filePath: remappedWorkingSetPaths[index] }
      );

      let nextManualOrder = currentState.manualOrder;
      let nextVaultIcons = currentState.vaultIcons;

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
        nextVaultIcons = moveVaultIcons(
          vaultRootPath,
          currentState.vaultIcons,
          folderPath,
          newFolderPath
        );
      }

      set({
        filePaths: nextFilePaths,
        emptyFolderPaths: nextEmptyFolderPaths,
        fileDocuments: nextDocuments,
        selectedFilePath: nextSelectedFilePath,
        manualOrder: nextManualOrder,
        vaultIcons: nextVaultIcons,
        workingSet: nextWorkingSet,
        fileError: null
      });

      if (nextWorkingSet !== currentState.workingSet) {
        persistWorkingSet(currentState.folderPath, nextWorkingSet);
      }

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
      // The notes' images live in the vault-root images/ folder, not in the
      // folder being deleted, so they have to be collected before the notes
      // are gone — same as deleting the notes one by one.
      const { fileDocuments, filePaths } = get();
      const deletedDocuments = await Promise.all(
        filePaths
          .filter((path) => isPathInsideFolder(path, folderPath))
          .map(async (path) => ({
            filePath: path,
            markdown:
              fileDocuments[path]?.baseContent ?? (await readMarkdownFile(path).catch(() => ""))
          }))
      );

      await deleteMarkdownFolder(folderPath);
      deleteFolderVersionHistory(get().folderPath, folderPath);
      deleteFolderDraftsFor(get().folderPath, folderPath);

      const vaultRootPath = get().folderPath;

      if (vaultRootPath && deletedDocuments.length > 0) {
        void cleanupImagesOfDeletedFiles(vaultRootPath, deletedDocuments).catch(() => undefined);
      }

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
      let nextVaultIcons = currentState.vaultIcons;

      if (currentState.folderPath) {
        const vaultRootPath = currentState.folderPath;
        const parentDirectory = await dirname(folderPath);
        const parentRelativePath = getRelativeDisplayPath(vaultRootPath, parentDirectory);
        const ownRelativePath = getRelativeDisplayPath(vaultRootPath, folderPath);

        nextManualOrder = removeManualOrderEntry(nextManualOrder, parentRelativePath, getBasename(folderPath));
        nextManualOrder = removeManualOrderFolderPrefix(nextManualOrder, ownRelativePath);

        persistManualOrderIfChanged(vaultRootPath, currentState.manualOrder, nextManualOrder);
        nextVaultIcons = dropVaultIcons(vaultRootPath, currentState.vaultIcons, folderPath);
      }

      const nextWorkingSet = pruneWorkingSet(
        currentState.workingSet,
        (path) => !isPathInsideFolder(path, folderPath)
      );

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
        vaultIcons: nextVaultIcons,
        workingSet: nextWorkingSet,
        fileError: null
      });

      if (nextWorkingSet.length !== currentState.workingSet.length) {
        persistWorkingSet(currentState.folderPath, nextWorkingSet);
      }

      return true;
    } catch (error) {
      set({
        fileError: toErrorMessage(error, i18n.t("store.folderDeleteError"))
      });

      return false;
    }
  }
});
