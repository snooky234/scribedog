import { getRelativeDisplayPath } from "@/lib/fileSystem";
import {
  createFileVersion,
  deleteFileVersions,
  deleteFolderVersions,
  moveFileVersions,
  moveFolderVersions
} from "@/lib/fileVersions";
import { useVersioningSettingsStore } from "@/store/useVersioningSettingsStore";

import { isPathInsideFolder } from "./pathUtils";

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

/**
 * Auto-save writes after every pause in typing. Snapshotting each of those
 * would push the states worth going back to out of a capped history within
 * minutes, and a snapshot taken on a timer catches a note mid-sentence. So an
 * auto-save only remembers what it wrote, and the version is taken when the
 * user leaves the note (another note, another folder, closing the app): the
 * state they were done with. A deliberate save supersedes the pending state,
 * since it is itself a snapshot of something newer.
 *
 * Keyed by the note's path as the store spells it; the vault root travels
 * along, so a pending version still lands in its own vault after a switch.
 */
type PendingVersion = { folderPath: string; content: string };

const pendingVersionByFile = new Map<string, PendingVersion>();

function writeVersion(folderPath: string, filePath: string, content: string): Promise<boolean> {
  const { maxVersionsPerFile } = useVersioningSettingsStore.getState();

  return createFileVersion(
    folderPath,
    getRelativeDisplayPath(folderPath, filePath),
    content,
    maxVersionsPerFile
  ).catch(() => false);
}

export function snapshotFileVersion(
  folderPath: string | null,
  filePath: string,
  content: string,
  options?: { deferred?: boolean }
): void {
  const { versioningEnabled } = useVersioningSettingsStore.getState();

  if (!folderPath || !versioningEnabled) {
    return;
  }

  if (options?.deferred) {
    pendingVersionByFile.set(filePath, { folderPath, content });
    return;
  }

  // Anything else that writes the note (replace across the vault, an image
  // path rewrite) must not swallow the state the user left there; the
  // pending version goes first, into the same queue, so the order holds.
  void flushPendingFileVersion(filePath);
  void writeVersion(folderPath, filePath, content);
}

/**
 * A deliberate save snapshots the newer state right after this; the pending
 * one would only be a near-duplicate a second older.
 */
export function discardPendingFileVersion(filePath: string): void {
  pendingVersionByFile.delete(filePath);
}

/** Leaving a note: what auto-save last wrote there becomes a version. */
export async function flushPendingFileVersion(filePath: string): Promise<void> {
  const pending = pendingVersionByFile.get(filePath);

  if (!pending) {
    return;
  }

  pendingVersionByFile.delete(filePath);

  if (!useVersioningSettingsStore.getState().versioningEnabled) {
    return;
  }

  await writeVersion(pending.folderPath, filePath, pending.content);
}

/**
 * Closing the app or switching the vault. Awaited there: a vault switch
 * installs another storage, and a version written after it would go to the
 * wrong place.
 */
export async function flushPendingFileVersions(): Promise<void> {
  await Promise.all([...pendingVersionByFile.keys()].map(flushPendingFileVersion));
}

function movePendingVersion(oldFilePath: string, newFilePath: string): void {
  const pending = pendingVersionByFile.get(oldFilePath);

  if (pending) {
    pendingVersionByFile.delete(oldFilePath);
    pendingVersionByFile.set(newFilePath, pending);
  }
}

/**
 * The one snapshot that is awaited: the disk version about to be overwritten
 * by a save over an external change. Fire-and-forget would race the write it
 * is meant to protect against. Same gate as snapshotFileVersion, never deferred.
 */
export async function snapshotFileVersionNow(
  folderPath: string | null,
  filePath: string,
  content: string
): Promise<void> {
  if (!folderPath || !useVersioningSettingsStore.getState().versioningEnabled) {
    return;
  }

  await writeVersion(folderPath, filePath, content);
}

export function moveFileVersionHistory(
  folderPath: string | null,
  oldFilePath: string,
  newFilePath: string
): void {
  // Renaming or moving the open note does not leave it.
  movePendingVersion(oldFilePath, newFilePath);

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
  for (const filePath of [...pendingVersionByFile.keys()]) {
    if (isPathInsideFolder(filePath, oldFolderPath)) {
      movePendingVersion(filePath, `${newFolderPath}${filePath.slice(oldFolderPath.length)}`);
    }
  }

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
  pendingVersionByFile.delete(filePath);

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
  for (const filePath of [...pendingVersionByFile.keys()]) {
    if (isPathInsideFolder(filePath, deletedFolderPath)) {
      pendingVersionByFile.delete(filePath);
    }
  }

  if (!folderPath) {
    return;
  }

  void deleteFolderVersions(
    folderPath,
    getRelativeDisplayPath(folderPath, deletedFolderPath)
  ).catch(() => undefined);
}
