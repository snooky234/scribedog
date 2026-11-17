/**
 * What folder notes are in a vault that has never had the switch touched (no
 * .scribedog/folder-notes.json): on for a fresh installation, off for one that
 * was in use before folder notes became the default. Turning them on under an
 * existing user would change what a click on a folder does in every vault they
 * never touched the switch in, which nobody asked for.
 *
 * "In use before" is read from what the app only writes once a vault or a note
 * has been opened (the last and recent folders on the desktop, the last note of
 * a vault in both editions), so nothing written at startup can blur it. The
 * answer is decided on the first start and kept, because those same keys exist
 * on a fresh installation from its first opened vault on.
 *
 * Pure, with the storage passed in: the store calls it once at module load.
 */

export const FOLDER_NOTES_DEFAULT_STORAGE_KEY = "scribedog-folder-notes-default";

// Spelled out rather than imported: the modules that own these keys pull in
// the filesystem layer. They are the keys of lib/fileSystem.ts (last and
// recent folder) and lib/lastOpenedFile.ts (last note per vault).
const USAGE_KEYS = ["scribedog:lastFolderPath", "scribedog:recentFolderPaths"];
const USAGE_KEY_PREFIX = "scribedog-last-file:";

export type FolderNotesDefaultStorage = Pick<Storage, "getItem" | "setItem" | "key" | "length">;

function hasBeenUsed(storage: FolderNotesDefaultStorage): boolean {
  if (USAGE_KEYS.some((key) => storage.getItem(key) !== null)) {
    return true;
  }

  for (let index = 0; index < storage.length; index += 1) {
    if (storage.key(index)?.startsWith(USAGE_KEY_PREFIX)) {
      return true;
    }
  }

  return false;
}

export function resolveFolderNotesDefault(storage: FolderNotesDefaultStorage | null): boolean {
  if (!storage) {
    return false;
  }

  try {
    const stored = storage.getItem(FOLDER_NOTES_DEFAULT_STORAGE_KEY);

    if (stored === "on" || stored === "off") {
      return stored === "on";
    }

    const enabled = !hasBeenUsed(storage);
    storage.setItem(FOLDER_NOTES_DEFAULT_STORAGE_KEY, enabled ? "on" : "off");

    return enabled;
  } catch {
    // Without storage the decision could not be kept; the old default is the
    // one that changes nothing for anybody.
    return false;
  }
}
