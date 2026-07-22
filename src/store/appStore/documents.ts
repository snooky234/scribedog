import { readMarkdownFile } from "@/lib/fileSystem";

import type { FileDocumentState } from "./types";

export function isDocumentDirty(document: FileDocumentState): boolean {
  return document.content !== document.baseContent;
}

export function pruneDocumentsToCurrentFolder(
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

export async function refreshCleanDocumentsFromDisk(
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
