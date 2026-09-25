import { readMarkdownFile, type OpenDocument } from "@/lib/fileSystem";
import { isFolderNotePath } from "@/lib/folderNotes";
import type { MarkdownFileRecord } from "@/platform/types";

import { normalizePathKey } from "./pathUtils";
import { stagedOnlyPathKeys } from "./stagedPaths";
import type { AppData, FileDocumentState } from "./types";

export function isDocumentDirty(document: FileDocumentState): boolean {
  return document.content !== document.baseContent;
}

/**
 * Filesystems round mtimes differently (FAT to two seconds, some sync clients
 * rewrite them on the way through), so the comparison has slack rather than
 * demanding equality.
 */
export const EXTERNAL_CHANGE_TOLERANCE_MS = 1_000;

/**
 * Whether the file on disk is a different one from the one the document was
 * read from. Unknown on either side (never looked up, file missing) is "no":
 * a missing file has nothing to protect, and a baseline nobody recorded
 * cannot be compared, so the save goes ahead as it always did.
 */
export function isExternallyModified(
  baseMtimeMs: number | null | undefined,
  currentMtimeMs: number | null | undefined,
  toleranceMs: number = EXTERNAL_CHANGE_TOLERANCE_MS
): boolean {
  if (baseMtimeMs == null || currentMtimeMs == null) {
    return false;
  }

  return Math.abs(currentMtimeMs - baseMtimeMs) > toleranceMs;
}

export function pruneDocumentsToCurrentFolder(
  fileDocuments: Record<string, FileDocumentState>,
  filePaths: string[],
  selectedFilePath: string | null
): Record<string, FileDocumentState> {
  const filePathSet = new Set(filePaths);
  // A note the agent has only proposed is not on disk, and its document is not
  // dirty either — so both rules below would throw it away, and the file the
  // user just opened to review would close itself on the next watcher tick.
  // "Not on disk" means deleted for every other file and "not written yet" for
  // this one, which is the whole distinction.
  const stagedOnly = stagedOnlyPathKeys();
  const isStagedOnly = (filePath: string) => stagedOnly.has(normalizePathKey(filePath));
  // A folder note that has not been written yet is the same case, but only
  // while it is the one on screen: opened from the tree, empty and clean, and
  // nothing on disk until the first save. Unselected and clean it is dropped
  // like any other — reopening the folder starts it empty again anyway.
  const isOpenUnwrittenFolderNote = (filePath: string) =>
    filePath === selectedFilePath && isFolderNotePath(filePath);
  const nextDocuments: Record<string, FileDocumentState> = {};

  for (const [filePath, document] of Object.entries(fileDocuments)) {
    if (
      filePathSet.has(filePath) ||
      isDocumentDirty(document) ||
      isStagedOnly(filePath) ||
      isOpenUnwrittenFolderNote(filePath)
    ) {
      nextDocuments[filePath] = document;
    }
  }

  if (
    selectedFilePath &&
    !filePathSet.has(selectedFilePath) &&
    !isStagedOnly(selectedFilePath) &&
    !isOpenUnwrittenFolderNote(selectedFilePath)
  ) {
    const selectedDocument = nextDocuments[selectedFilePath];

    if (!selectedDocument || !isDocumentDirty(selectedDocument)) {
      delete nextDocuments[selectedFilePath];
    }
  }

  return nextDocuments;
}

export async function refreshCleanDocumentsFromDisk(
  fileDocuments: Record<string, FileDocumentState>,
  markdownFiles: MarkdownFileRecord[]
): Promise<Record<string, FileDocumentState>> {
  const mtimeByPath = new Map(markdownFiles.map((record) => [record.filePath, record.mtimeMs]));
  const nextDocuments: Record<string, FileDocumentState> = { ...fileDocuments };
  const cleanPathsToReload = Object.entries(fileDocuments)
    .filter(([filePath, document]) => mtimeByPath.has(filePath) && !isDocumentDirty(document))
    .map(([filePath]) => filePath);

  await Promise.all(
    cleanPathsToReload.map(async (filePath) => {
      try {
        const markdown = await readMarkdownFile(filePath);
        nextDocuments[filePath] = {
          content: markdown,
          baseContent: markdown,
          baseMtimeMs: mtimeByPath.get(filePath) ?? null
        };
      } catch {
        delete nextDocuments[filePath];
      }
    })
  );

  return nextDocuments;
}

/**
 * The unsaved edits of every open note, for the image cleanup (see
 * `OpenDocument`): an image pasted into a note that has not been saved yet is
 * referenced there and nowhere on disk. The open note's own copy is the one
 * the editor is showing, like in saveFilePath.
 */
export function collectUnsavedDocuments(
  state: Pick<AppData, "fileDocuments" | "selectedFilePath" | "selectedFileContent">
): OpenDocument[] {
  const documents: OpenDocument[] = [];

  for (const [filePath, document] of Object.entries(state.fileDocuments)) {
    const markdown =
      filePath === state.selectedFilePath && state.selectedFileContent !== null
        ? state.selectedFileContent
        : document.content;

    if (markdown !== document.baseContent) {
      documents.push({ filePath, markdown });
    }
  }

  return documents;
}
