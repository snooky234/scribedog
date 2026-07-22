import type { MarkdownFileRecord } from "@/lib/fileSystem";
import { readManualOrder, readSortMode } from "@/lib/vaultMeta";

import { reconcileManualOrder } from "./manualOrder";
import type { FileDocumentState } from "./types";

export function buildFileMtimeMap(markdownFiles: MarkdownFileRecord[]): Record<string, number> {
  const map: Record<string, number> = {};

  for (const record of markdownFiles) {
    map[record.filePath] = record.mtimeMs;
  }

  return map;
}

/**
 * The complete state of a freshly opened vault: file list, mtimes, the
 * persisted sort mode and a manual order reconciled against what is actually
 * on disk. Every selection and document state is reset along with it.
 */
export async function createLoadedFolderState(
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
