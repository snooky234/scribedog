import { getRelativeDisplayPath } from "@/lib/fileSystem";
import {
  createFileVersion,
  deleteFileVersions,
  deleteFolderVersions,
  moveFileVersions,
  moveFolderVersions
} from "@/lib/fileVersions";
import { useVersioningSettingsStore } from "@/store/useVersioningSettingsStore";

/**
 * Bridges the store slices to the version storage. Creating versions is gated
 * by the setting; keeping an *existing* history in sync with renames, moves
 * and deletions is not — turning versioning off only stops new snapshots, the
 * history that is already on disk must not rot.
 *
 * Every write of a vault markdown file is snapshotted, not just the save
 * path: file creation, project-wide replace, import and the image-path
 * rewrite after a move all change what is on disk, and each of them is a
 * state a user may want back. See writeMarkdownFile in lib/fileSystem.ts for
 * the list of call sites this has to stay in sync with.
 *
 * Every call is fire-and-forget: versioning must never slow down or fail a
 * save, a rename or a delete.
 */

export function snapshotFileVersion(
  folderPath: string | null,
  filePath: string,
  content: string
): void {
  const { versioningEnabled, maxVersionsPerFile } = useVersioningSettingsStore.getState();

  if (!folderPath || !versioningEnabled) {
    return;
  }

  void createFileVersion(
    folderPath,
    getRelativeDisplayPath(folderPath, filePath),
    content,
    maxVersionsPerFile
  ).catch(() => undefined);
}

export function moveFileVersionHistory(
  folderPath: string | null,
  oldFilePath: string,
  newFilePath: string
): void {
  if (!folderPath) {
    return;
  }

  void moveFileVersions(
    folderPath,
    getRelativeDisplayPath(folderPath, oldFilePath),
    getRelativeDisplayPath(folderPath, newFilePath)
  ).catch(() => undefined);
}

export function moveFolderVersionHistory(
  folderPath: string | null,
  oldFolderPath: string,
  newFolderPath: string
): void {
  if (!folderPath) {
    return;
  }

  void moveFolderVersions(
    folderPath,
    getRelativeDisplayPath(folderPath, oldFolderPath),
    getRelativeDisplayPath(folderPath, newFolderPath)
  ).catch(() => undefined);
}

export function deleteFileVersionHistory(folderPath: string | null, filePath: string): void {
  if (!folderPath) {
    return;
  }

  void deleteFileVersions(folderPath, getRelativeDisplayPath(folderPath, filePath)).catch(
    () => undefined
  );
}

export function deleteFolderVersionHistory(
  folderPath: string | null,
  deletedFolderPath: string
): void {
  if (!folderPath) {
    return;
  }

  void deleteFolderVersions(
    folderPath,
    getRelativeDisplayPath(folderPath, deletedFolderPath)
  ).catch(() => undefined);
}
