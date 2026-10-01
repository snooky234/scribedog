import { dirname, join } from "@/platform/paths";

import i18n from "@/i18n";
import {
  getRelativeDisplayPath,
  markdownFolderExists,
  readMarkdownFile,
  renameMarkdownFile,
  renameMarkdownFolder,
  rewriteRelativeImagePaths,
  writeMarkdownFile
} from "@/lib/fileSystem";
import { isDescendantRelativePath } from "@/lib/fileTree";
import { setVaultIcon } from "@/lib/vaultIcons";
import { writeManualOrder, writeSortMode, type SortMode } from "@/lib/vaultMeta";

import { isDocumentDirty } from "./documents";
import { moveDraftFor, moveFolderDraftsFor, scheduleDraft } from "./drafts";
import { toErrorMessage } from "./errors";
import { moveVaultIcons, persistVaultIconsIfChanged } from "./icons";
import { currentChildBasenames, ensureManualOrderEntry } from "./manualOrder";
import {
  getBasename,
  isPathInsideFolder,
  normalizePathKey,
  remapPathUnderRenamedFolder
} from "./pathUtils";
import type { AppSlice, FileDocumentState, MoveTreeEntryInput, TreeSlice } from "./types";
import {
  moveFileVersionHistory,
  moveFolderVersionHistory,
  snapshotFileVersion
} from "./versioning";
import { persistWorkingSet } from "./workingSetSlice";

export const createTreeSlice: AppSlice<TreeSlice> = (set, get) => ({
  setSortMode: async (mode: SortMode) => {
    const { folderPath } = get();

    set({ sortMode: mode });

    if (!folderPath) {
      return;
    }

    void writeSortMode(folderPath, mode).catch(() => undefined);
  },
  setVaultIconFor: (entryPath: string, icon: string | null) => {
    const { folderPath, vaultIcons } = get();

    if (!folderPath) {
      return;
    }

    const nextVaultIcons = setVaultIcon(
      vaultIcons,
      getRelativeDisplayPath(folderPath, entryPath),
      icon
    );

    if (nextVaultIcons === vaultIcons) {
      return;
    }

    set({ vaultIcons: nextVaultIcons });
    persistVaultIconsIfChanged(folderPath, vaultIcons, nextVaultIcons);
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
      let seededManualOrder = manualOrder;

      for (const parentRelativePath of new Set([sourceParentRelativePath, targetParentRelativePath])) {
        seededManualOrder = ensureManualOrderEntry(
          seededManualOrder,
          parentRelativePath,
          currentChildBasenames(folderPath, filePaths, emptyFolderPaths, parentRelativePath)
        );
      }

      let nextFilePaths = filePaths;
      let nextEmptyFolderPaths = emptyFolderPaths;
      let nextDocuments = fileDocuments;
      let nextSelectedFilePath = state.selectedFilePath;
      let nextWorkingSet = state.workingSet;

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
          moveFolderVersionHistory(folderPath, sourcePath, newPath);
          moveFolderDraftsFor(folderPath, sourcePath, newPath);
        } else {
          await renameMarkdownFile(sourcePath, newPath);
          moveFileVersionHistory(folderPath, sourcePath, newPath);
          moveDraftFor(folderPath, sourcePath, newPath);
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

            // A rename keeps mtime and version; a rewrite of the image paths
            // below produces new ones nobody looks up here, so they are unknown.
            const isUnchangedOnDisk = correctedBaseContent === preMoveContentByPath.get(path);
            const baseMtimeMs = isUnchangedOnDisk ? document.baseMtimeMs : undefined;

            rewrittenDocuments[mappedPath] = {
              content: correctedContent,
              baseContent: correctedBaseContent,
              baseMtimeMs,
              baseVersion: isUnchangedOnDisk ? document.baseVersion : undefined
            };

            // The moved draft still holds the old image paths; the rewritten
            // unsaved edits are what has to survive a restart now.
            if (correctedContent !== correctedBaseContent) {
              scheduleDraft(folderPath, mappedPath, correctedContent, baseMtimeMs ?? null);
            }

            // The rewritten paths have to reach disk, not just this map:
            // correcting only in memory leaves the document clean, so nothing
            // would ever save it — and the folder watcher's refresh reloads
            // clean documents from disk, discarding the correction again.
            // Only baseContent is written; content may hold unsaved edits,
            // which stay unsaved (both sides were rewritten, so a dirty
            // document stays dirty).
            if (correctedBaseContent !== preMoveContentByPath.get(path)) {
              // Snapshot runs after the version history has been carried over
              // to the new path above, so it lands on the right file.
              await writeMarkdownFile(mappedPath, correctedBaseContent)
                .then(() => snapshotFileVersion(folderPath, mappedPath, correctedBaseContent))
                .catch(() => undefined);
            }
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
                await writeMarkdownFile(mappedPath, correctedContent)
                  .then(() => snapshotFileVersion(folderPath, mappedPath, correctedContent))
                  .catch(() => undefined);
              }
            })
        );

        nextSelectedFilePath = state.selectedFilePath
          ? await remapPathUnderRenamedFolder(state.selectedFilePath, sourcePath, newPath)
          : state.selectedFilePath;

        const remappedWorkingSetPaths = await Promise.all(
          state.workingSet.map((entry) => remapPathUnderRenamedFolder(entry.filePath, sourcePath, newPath))
        );
        nextWorkingSet = state.workingSet.map((entry, index) =>
          remappedWorkingSetPaths[index] === entry.filePath ? entry : { ...entry, filePath: remappedWorkingSetPaths[index] }
        );
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

      // Only a move between folders changes a path; a drop inside the same
      // parent is a reorder, and the icons are keyed by path.
      const nextVaultIcons = isSameParent
        ? state.vaultIcons
        : moveVaultIcons(folderPath, state.vaultIcons, sourcePath, newPath);

      // The editor renders selectedFileContent, not fileDocuments. Without
      // mirroring the moved document into these fields, an open file keeps
      // showing its pre-move markdown — with the image paths that the move
      // just corrected — and writes that stale text back on the next edit.
      const nextSelectedDocument = nextSelectedFilePath
        ? nextDocuments[nextSelectedFilePath]
        : undefined;

      set({
        vaultIcons: nextVaultIcons,
        filePaths: nextFilePaths,
        emptyFolderPaths: nextEmptyFolderPaths,
        fileDocuments: nextDocuments,
        selectedFilePath: nextSelectedFilePath,
        selectedFileContent: nextSelectedDocument
          ? nextSelectedDocument.content
          : state.selectedFileContent,
        selectedFileBaseContent: nextSelectedDocument
          ? nextSelectedDocument.baseContent
          : state.selectedFileBaseContent,
        isDirty: nextSelectedDocument ? isDocumentDirty(nextSelectedDocument) : state.isDirty,
        manualOrder: withoutSource,
        workingSet: nextWorkingSet,
        fileError: null
      });

      if (nextWorkingSet !== state.workingSet) {
        persistWorkingSet(folderPath, nextWorkingSet);
      }

      return true;
    } catch (error) {
      set({
        fileError: toErrorMessage(error, i18n.t("store.entryMoveError"))
      });

      return false;
    }
  }
});
