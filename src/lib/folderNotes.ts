/**
 * Folder notes: a folder's own text, stored *inside* the folder under one
 * reserved file name. That placement is the whole design — moving, renaming
 * or deleting the folder (in ScribeDog or in the OS) carries the note along
 * without any mapping, id or repair step. The file is a normal markdown file
 * for everything except the tree: search, versioning, export and the agent
 * treat it like any other note, only the sidebar attaches it to the folder
 * row instead of listing it next to its siblings.
 *
 * Pure path helpers only, no filesystem and no store: the tree builder, the
 * store slices and the agent tools all import from here, and several of
 * their tests mock the fs layer.
 */

export const FOLDER_NOTE_FILE_NAME = ".scribedog-foldernote.md";

function toPosix(path: string): string {
  return path.replace(/\\/g, "/");
}

function basenameOf(path: string): string {
  return toPosix(path).split("/").pop() ?? path;
}

/** Whether this path (absolute or vault-relative) is a folder note. Case-insensitive, because Windows is. */
export function isFolderNotePath(path: string): boolean {
  return basenameOf(path).toLowerCase() === FOLDER_NOTE_FILE_NAME;
}

/**
 * The folder a note belongs to, in the same spelling the note was given:
 * "Rezepte/.scribedog-foldernote.md" -> "Rezepte", "/v/Rezepte/.scribedog-foldernote.md"
 * -> "/v/Rezepte". A note directly in the vault root yields "" for a relative
 * path — the root has no folder row, so such a file is shown as an ordinary
 * note rather than hidden (see buildFileTree).
 */
export function getFolderNoteFolderPath(notePath: string): string {
  const posix = toPosix(notePath);
  const separator = notePath.includes("\\") ? "\\" : "/";
  const segments = posix.split("/");

  segments.pop();

  return segments.join(separator);
}

/**
 * The note path of a folder, using the folder path's own separator so the
 * result matches the spelling `filePaths` uses on this platform (a Tauri
 * `join` would do the same, but asynchronously).
 */
export function getFolderNotePath(folderPath: string): string {
  const separator = folderPath.includes("\\") ? "\\" : "/";
  const trimmed = folderPath.replace(/[\\/]+$/, "");

  return `${trimmed}${separator}${FOLDER_NOTE_FILE_NAME}`;
}

/**
 * The folder an ordinary note becomes when it is turned into a folder note:
 * a sibling folder named like the note, so the tree still shows the same name
 * in the same place ("/v/Rezepte.md" -> "/v/Rezepte"). Null for a path that
 * is no markdown note or already a folder note.
 */
export function getConversionFolderPath(notePath: string): string | null {
  if (isFolderNotePath(notePath) || !/\.md$/i.test(notePath)) {
    return null;
  }

  const folderPath = notePath.replace(/\.md$/i, "");

  return basenameOf(folderPath).trim() ? folderPath : null;
}

/**
 * What a note is called in the UI: the file name without ".md", or for a
 * folder note the folder's name — the technical file name is the same for
 * every folder and would tell the user nothing.
 */
export function getNoteDisplayName(path: string): string {
  if (isFolderNotePath(path)) {
    return basenameOf(getFolderNoteFolderPath(path)) || basenameOf(path);
  }

  return basenameOf(path).replace(/\.md$/i, "");
}

/** Number of folder notes in a list of paths (the settings dialog's "hidden" counter). */
export function countFolderNotes(paths: readonly string[]): number {
  return paths.reduce((total, path) => total + (isFolderNotePath(path) ? 1 : 0), 0);
}

/**
 * A vault-relative path the way lists name it: ordinary notes as they are, a
 * folder note through `labelFolderNote` (the caller supplies the translated
 * form, e.g. "Rezepte (folder note)") — the reserved file name would read as
 * a broken entry.
 */
export function describeNotePath(
  relativePath: string,
  labelFolderNote: (folderRelativePath: string) => string
): string {
  const folderRelativePath = isFolderNotePath(relativePath) ? getFolderNoteFolderPath(relativePath) : "";

  return folderRelativePath ? labelFolderNote(folderRelativePath) : relativePath;
}
