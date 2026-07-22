import { dirname, join } from "@tauri-apps/api/path";

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
import { getChildBasenamesByParent, isDescendantRelativePath } from "@/lib/fileTree";
import { writeManualOrder, writeSortMode, type SortMode } from "@/lib/vaultMeta";

import { isDocumentDirty } from "./documents";
import { toErrorMessage } from "./errors";
import {
  getBasename,
  isPathInsideFolder,
  normalizePathKey,
  remapPathUnderRenamedFolder
} from "./pathUtils";
import type { AppSlice, FileDocumentState, MoveTreeEntryInput, TreeSlice } from "./types";

export const createTreeSlice: AppSlice<TreeSlice> = (set, get) => ({
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

            // The rewritten paths have to reach disk, not just this map:
            // correcting only in memory leaves the document clean, so nothing
            // would ever save it — and the folder watcher's refresh reloads
            // clean documents from disk, discarding the correction again.
            // Only baseContent is written; content may hold unsaved edits,
            // which stay unsaved (both sides were rewritten, so a dirty
            // document stays dirty).
            if (correctedBaseContent !== preMoveContentByPath.get(path)) {
              await writeMarkdownFile(mappedPath, correctedBaseContent).catch(() => undefined);
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

      // The editor renders selectedFileContent, not fileDocuments. Without
      // mirroring the moved document into these fields, an open file keeps
      // showing its pre-move markdown — with the image paths that the move
      // just corrected — and writes that stale text back on the next edit.
      const nextSelectedDocument = nextSelectedFilePath
        ? nextDocuments[nextSelectedFilePath]
        : undefined;

      set({
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
});
