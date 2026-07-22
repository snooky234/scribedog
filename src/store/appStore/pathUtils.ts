import { join } from "@tauri-apps/api/path";

import { getRelativeDisplayPath } from "@/lib/fileSystem";

export function normalizePathKey(path: string): string {
  return path.replace(/\\/g, "/").toLowerCase();
}

export function insertFilePathSorted(filePaths: string[], newPath: string): string[] {
  return [...filePaths, newPath].sort((left, right) =>
    left.localeCompare(right, undefined, {
      numeric: true,
      sensitivity: "base"
    })
  );
}

export const INVALID_FILE_NAME_CHARS = /[\\/:*?"<>|]/;

export async function remapPathUnderRenamedFolder(
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

export function isPathInsideFolder(path: string, folderPath: string): boolean {
  return normalizePathKey(path).startsWith(`${normalizePathKey(folderPath)}/`);
}

export function getBasename(path: string): string {
  return path.replace(/\\/g, "/").split("/").pop() ?? path;
}
