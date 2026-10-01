import { readMarkdownFile, type MarkdownFileRecord } from "@/lib/fileSystem";
import { readManualOrder, readSortMode, readVaultIcons } from "@/lib/vaultMeta";

import { loadDraftDocuments } from "./drafts";
import { reconcileManualOrder } from "./manualOrder";
import type { FileDocumentState } from "./types";
import { loadInitialWorkingSet } from "./workingSetSlice";

export function buildFileMtimeMap(markdownFiles: MarkdownFileRecord[]): Record<string, number> {
  const map: Record<string, number> = {};

  for (const record of markdownFiles) {
    map[record.filePath] = record.mtimeMs;
  }

  return map;
}

/**
 * The complete state of a freshly opened vault: file list, mtimes, the
 * persisted sort mode, the per-entry icons and a manual order reconciled
 * against what is actually on disk. The selection is reset; the document map
 * starts with the drafts left behind last time (hot exit), so those notes come
 * back dirty.
 */
export async function createLoadedFolderState(
  folderPath: string,
  markdownFiles: MarkdownFileRecord[]
) {
  const [sortMode, storedManualOrder, vaultIcons, fileDocuments] = await Promise.all([
    readSortMode(folderPath),
    readManualOrder(folderPath),
    readVaultIcons(folderPath),
    loadDraftDocuments(folderPath, markdownFiles, readMarkdownFile)
  ]);

  const manualOrder = await reconcileManualOrder(folderPath, storedManualOrder, markdownFiles, []);
  const filePaths = markdownFiles.map((record) => record.filePath);
  const workingSet = await loadInitialWorkingSet(folderPath, filePaths, fileDocuments);

  return {
    folderPath,
    filePaths,
    emptyFolderPaths: [] as string[],
    fileDocuments: fileDocuments as Record<string, FileDocumentState>,
    selectedFilePath: null,
    selectedFileContent: null,
    selectedFileBaseContent: null,
    isFileLoading: false,
    isSaving: false,
    isRefreshing: false,
    isDirty: false,
    fileError: null,
    saveError: null,
    saveConflict: null,
    mergeReview: null,
    workingSet,
    sortMode,
    manualOrder,
    vaultIcons,
    fileMtimeMs: buildFileMtimeMap(markdownFiles),
    emptyFolderMtimeMs: {} as Record<string, number>
  };
}
