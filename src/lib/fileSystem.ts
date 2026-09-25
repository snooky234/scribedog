import i18n from "@/i18n";
import { getVaultStorage, platform } from "@/platform";
import { activateVaultStorage, isRemoteVaultPath, remoteVaultFor, watchRemoteVault } from "@/lib/remoteVaults";
import { dirname, join } from "@/platform/paths";
import { exists, mkdir, readTextFile, remove, rename, stat, writeFile, writeTextFile } from "@/platform/vaultFs";
import {
  getRelativeDisplayPath,
  isPathInsideVault,
  normalizeDisplayPath,
  VAULT_META_DIR_NAME
} from "@/lib/vaultPaths";
import type { MarkdownFileRecord } from "@/platform/types";
import { guessImageMimeType } from "@/lib/imageMimeTypes";

export { getRelativeDisplayPath, guessImageMimeType, isPathInsideVault, VAULT_META_DIR_NAME };
export type { MarkdownFileRecord };

export const ABSOLUTE_URL_PATTERN = /^[a-z][a-z0-9+.-]*:/i;

const IMAGES_FOLDER_NAME = "images";

const EXTENSION_BY_MIME_TYPE: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/gif": "gif",
  "image/webp": "webp",
  "image/svg+xml": "svg",
  "image/bmp": "bmp"
};

const LAST_FOLDER_PATH_STORAGE_KEY = "scribedog:lastFolderPath";
const RECENT_FOLDER_PATHS_STORAGE_KEY = "scribedog:recentFolderPaths";
export const RECENT_FOLDER_PATHS_MAX = 8;

export type FileTimestamps = {
  /** Creation time; null where the platform does not report one. */
  createdMs: number | null;
  modifiedMs: number | null;
};

/**
 * Creation and modification time of a file for the details panel. Not every
 * filesystem records a birth time (and some report the epoch instead), so a
 * missing value is null rather than a misleading 1970 date.
 */
export async function getFileTimestamps(path: string): Promise<FileTimestamps> {
  try {
    const info = await stat(path);
    const toMs = (value: Date | null | undefined): number | null => {
      const ms = value?.getTime() ?? 0;
      return ms > 0 ? ms : null;
    };

    return { createdMs: toMs(info.birthtime), modifiedMs: toMs(info.mtime) };
  } catch {
    return { createdMs: null, modifiedMs: null };
  }
}

export async function getPathMtimeMs(path: string): Promise<number> {
  try {
    const info = await stat(path);
    return info.mtime?.getTime() ?? 0;
  } catch {
    return 0;
  }
}

export async function chooseMarkdownFolder(): Promise<string | null> {
  if (!platform.dialogs) {
    return null;
  }

  return platform.dialogs.chooseFolder({ title: i18n.t("fileSystem.chooseFolderTitle") });
}

/**
 * The first step of every open: installs the storage the vault lives on (a
 * server, or the platform's own) and, for a local folder, widens the shell's
 * filesystem scope to it.
 */
export async function allowMarkdownFolderAccess(folderPath: string): Promise<void> {
  await activateVaultStorage(folderPath);

  if (!isRemoteVaultPath(folderPath)) {
    await platform.vault.allowFolderAccess(folderPath);
  }
}

export async function allowFileAccess(filePath: string): Promise<void> {
  await platform.vault.allowFileAccess(filePath);
}

export async function watchMarkdownFolder(folderPath: string): Promise<void> {
  if (isRemoteVaultPath(folderPath)) {
    await watchRemoteVault(folderPath);
    return;
  }

  await platform.vault.watchFolder(folderPath);
}

export async function listMarkdownFiles(rootPath: string): Promise<MarkdownFileRecord[]> {
  return getVaultStorage().listMarkdownFiles(rootPath);
}

export async function readMarkdownFile(filePath: string): Promise<string> {
  return readTextFile(filePath);
}

/** The file's mtime in ms, or null when it cannot be read (missing, no access). */
export async function readMarkdownFileMtime(filePath: string): Promise<number | null> {
  try {
    const info = await stat(filePath);
    return info.mtime ? info.mtime.getTime() : null;
  } catch {
    return null;
  }
}

/**
 * Every write to a vault markdown file goes through here. Versioning is not
 * wired in at this level (that would make the filesystem layer depend on the
 * store), so each caller pairs its write with `snapshotFileVersion` from
 * store/appStore/versioning.ts — a new call site has to do the same.
 */
export async function writeMarkdownFile(filePath: string, markdown: string): Promise<void> {
  await writeTextFile(filePath, markdown);
}

export async function renameMarkdownFile(oldPath: string, newPath: string): Promise<void> {
  await rename(oldPath, newPath);
}

export async function deleteMarkdownFile(filePath: string): Promise<void> {
  await remove(filePath);
}

export async function createUniqueMarkdownFolder(
  targetDirectory: string,
  baseName: string
): Promise<string> {
  let candidatePath = await join(targetDirectory, baseName);
  let suffix = 2;

  while (await exists(candidatePath)) {
    candidatePath = await join(targetDirectory, `${baseName} ${suffix}`);
    suffix += 1;
  }

  await mkdir(candidatePath, { recursive: true });

  return candidatePath;
}

/**
 * Creates a folder at exactly this path, parents included. Unlike
 * createUniqueMarkdownFolder it does not invent a free name: the agent's
 * create_folder names the folder, and silently getting "Ideen 2" instead of
 * "Ideen" would leave every path it writes afterwards pointing nowhere.
 */
export async function createMarkdownFolderAtPath(folderPath: string): Promise<void> {
  await mkdir(folderPath, { recursive: true });
}

export async function renameMarkdownFolder(oldPath: string, newPath: string): Promise<void> {
  await rename(oldPath, newPath);
}

export async function deleteMarkdownFolder(folderPath: string): Promise<void> {
  await remove(folderPath, { recursive: true });
}

export async function markdownFolderExists(folderPath: string): Promise<boolean> {
  return exists(folderPath);
}

export function getLastOpenedFolderPath(): string | null {
  try {
    return window.localStorage.getItem(LAST_FOLDER_PATH_STORAGE_KEY);
  } catch {
    return null;
  }
}

export function setLastOpenedFolderPath(folderPath: string): void {
  try {
    window.localStorage.setItem(LAST_FOLDER_PATH_STORAGE_KEY, folderPath);
  } catch {
    // localStorage may be unavailable in some environments.
  }
}

export function clearLastOpenedFolderPath(): void {
  try {
    window.localStorage.removeItem(LAST_FOLDER_PATH_STORAGE_KEY);
  } catch {
    // localStorage may be unavailable in some environments.
  }
}

/** Most-recently-used first; capped at {@link RECENT_FOLDER_PATHS_MAX}. */
export function getRecentFolderPaths(): string[] {
  try {
    const raw = window.localStorage.getItem(RECENT_FOLDER_PATHS_STORAGE_KEY);

    if (!raw) {
      return [];
    }

    const parsed: unknown = JSON.parse(raw);

    if (!Array.isArray(parsed)) {
      return [];
    }

    return parsed.filter((entry): entry is string => typeof entry === "string");
  } catch {
    return [];
  }
}

function writeRecentFolderPaths(folderPaths: string[]): void {
  try {
    window.localStorage.setItem(RECENT_FOLDER_PATHS_STORAGE_KEY, JSON.stringify(folderPaths));
  } catch {
    // localStorage may be unavailable in some environments.
  }
}

/** Moves the path to the front, dropping any prior (case-insensitive) duplicate. */
export function addRecentFolderPath(folderPath: string): void {
  const normalizedTarget = normalizeDisplayPath(folderPath).toLowerCase();
  const deduped = getRecentFolderPaths().filter(
    (existing) => normalizeDisplayPath(existing).toLowerCase() !== normalizedTarget
  );

  writeRecentFolderPaths([folderPath, ...deduped].slice(0, RECENT_FOLDER_PATHS_MAX));
}

export function removeRecentFolderPath(folderPath: string): void {
  const normalizedTarget = normalizeDisplayPath(folderPath).toLowerCase();

  writeRecentFolderPaths(
    getRecentFolderPaths().filter(
      (existing) => normalizeDisplayPath(existing).toLowerCase() !== normalizedTarget
    )
  );
}

/**
 * Drops recent local vaults whose folder was deleted or moved and returns
 * the paths it dropped. Server vaults are left alone: a server that is away
 * right now is still the user's server. A failed check keeps the entry, since
 * losing a vault from the list is worse than showing one too many.
 */
export async function pruneMissingRecentFolderPaths(): Promise<string[]> {
  const localPaths = getRecentFolderPaths().filter((path) => !isRemoteVaultPath(path));
  const existsByPath = await Promise.all(
    localPaths.map((path) => platform.vault.folderExists(path).catch(() => true))
  );
  const missingPaths = localPaths.filter((_, index) => !existsByPath[index]);

  missingPaths.forEach(removeRecentFolderPath);

  return missingPaths;
}

export function formatFolderLabel(folderPath: string | null): string {
  if (!folderPath) {
    return i18n.t("fileSystem.noFolderOpen");
  }

  return remoteVaultFor(folderPath)?.name ?? platform.vault.displayName(folderPath);
}

export function getFolderBasename(folderPath: string): string {
  const remote = remoteVaultFor(folderPath);

  if (remote) {
    return remote.name;
  }

  return normalizeDisplayPath(folderPath).split("/").pop() ?? folderPath;
}

function sanitizeImageFileName(fileName: string, mimeType: string): string {
  const baseNameOnly = fileName.replace(/\\/g, "/").split("/").pop() ?? "";
  const sanitized = baseNameOnly.replace(/[^a-zA-Z0-9._-]/g, "_").replace(/^\.+/, "");

  if (sanitized) {
    return sanitized;
  }

  const fallbackExtension = EXTENSION_BY_MIME_TYPE[mimeType] ?? "png";
  return `bild-${Date.now()}.${fallbackExtension}`;
}

function splitFileNameParts(fileName: string): { base: string; ext: string } {
  const lastDot = fileName.lastIndexOf(".");

  if (lastDot <= 0) {
    return { base: fileName, ext: "" };
  }

  return { base: fileName.slice(0, lastDot), ext: fileName.slice(lastDot) };
}

async function resolveUniqueImagePath(
  imagesDirPath: string,
  fileName: string
): Promise<{ filePath: string; fileName: string }> {
  const { base, ext } = splitFileNameParts(fileName);
  let candidateName = fileName;
  let suffix = 1;

  while (await exists(await join(imagesDirPath, candidateName))) {
    candidateName = `${base}-${suffix}${ext}`;
    suffix += 1;
  }

  return { filePath: await join(imagesDirPath, candidateName), fileName: candidateName };
}

/**
 * Saves image data into the "images" folder at the root of the open folder
 * and returns the root-relative path (e.g. "images/foto.png").
 */
export async function saveImageToFolder(
  folderPath: string,
  fileName: string,
  mimeType: string,
  data: Uint8Array
): Promise<string> {
  const imagesDirPath = await join(folderPath, IMAGES_FOLDER_NAME);
  await mkdir(imagesDirPath, { recursive: true });

  const sanitizedFileName = sanitizeImageFileName(fileName, mimeType);
  const { filePath, fileName: uniqueFileName } = await resolveUniqueImagePath(
    imagesDirPath,
    sanitizedFileName
  );

  await writeFile(filePath, data);

  return `${IMAGES_FOLDER_NAME}/${uniqueFileName}`;
}

/**
 * Computes the markdown image path relative to the currently open file,
 * since "images/" always sits at the root while the markdown file itself
 * can be in a subfolder (e.g. "../images/foto.png").
 */
export async function getRelativeImageMarkdownPath(
  folderPath: string,
  currentFilePath: string,
  rootRelativeImagePath: string
): Promise<string> {
  const currentFileDir = await dirname(currentFilePath);
  const currentDirRelative = getRelativeDisplayPath(folderPath, currentFileDir);

  if (!currentDirRelative) {
    return rootRelativeImagePath;
  }

  const depth = currentDirRelative.split("/").length;
  return `${"../".repeat(depth)}${rootRelativeImagePath}`;
}

const IMAGE_MARKDOWN_PATTERN = /!\[[^\]]*\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g;

function extractImageReferences(markdown: string): string[] {
  return Array.from(markdown.matchAll(IMAGE_MARKDOWN_PATTERN), (match) => match[1]);
}

type ResolvedImageRefs = {
  /** Root-relative paths of all references that resolve inside the vault. */
  paths: Set<string>;
  /**
   * At least one relative reference could not be resolved to a location
   * inside the vault — the document's image paths are in a broken state.
   */
  hasBrokenReference: boolean;
};

async function resolveImageRootRelativePaths(
  markdown: string,
  fileDirPath: string,
  folderPath: string
): Promise<ResolvedImageRefs> {
  const paths = new Set<string>();
  let hasBrokenReference = false;

  for (const rawSrc of extractImageReferences(markdown)) {
    if (ABSOLUTE_URL_PATTERN.test(rawSrc)) {
      continue;
    }

    try {
      const absolutePath = await join(fileDirPath, rawSrc);

      if (isPathInsideVault(folderPath, absolutePath)) {
        paths.add(getRelativeDisplayPath(folderPath, absolutePath));
      } else {
        hasBrokenReference = true;
      }
    } catch {
      hasBrokenReference = true;
    }
  }

  return { paths, hasBrokenReference };
}

/**
 * Rewrites relative image references in markdown so they keep pointing at
 * the correct location after the file itself moved to a different folder
 * depth (the "images/" folder always stays at the vault root).
 */
export async function rewriteRelativeImagePaths(
  markdown: string,
  oldFileDirPath: string,
  newFilePath: string,
  folderPath: string
): Promise<string> {
  const matches = Array.from(markdown.matchAll(IMAGE_MARKDOWN_PATTERN));

  if (matches.length === 0) {
    return markdown;
  }

  const replacements: Array<{ start: number; end: number; value: string }> = [];

  for (const match of matches) {
    const rawSrc = match[1];
    const matchIndex = match.index;

    if (matchIndex === undefined || ABSOLUTE_URL_PATTERN.test(rawSrc)) {
      continue;
    }

    const srcStart = matchIndex + match[0].indexOf("(") + 1;
    const srcEnd = srcStart + rawSrc.length;

    try {
      const absolutePath = await join(oldFileDirPath, rawSrc);

      // A reference that already resolves outside the vault is broken (an
      // image that was never there, or damage from an earlier move). Rewriting
      // it would only prepend more "../" and make it worse, so it is left
      // exactly as it is and stays visibly broken instead.
      if (!isPathInsideVault(folderPath, absolutePath)) {
        continue;
      }

      const rootRelativePath = getRelativeDisplayPath(folderPath, absolutePath);
      const newRelativeSrc = await getRelativeImageMarkdownPath(folderPath, newFilePath, rootRelativePath);

      if (newRelativeSrc !== rawSrc) {
        replacements.push({ start: srcStart, end: srcEnd, value: newRelativeSrc });
      }
    } catch {
      // Invalid path — leave the reference untouched.
    }
  }

  if (replacements.length === 0) {
    return markdown;
  }

  let result = "";
  let cursor = 0;

  for (const replacement of replacements) {
    result += markdown.slice(cursor, replacement.start) + replacement.value;
    cursor = replacement.end;
  }

  result += markdown.slice(cursor);

  return result;
}

/**
 * Deletes images from the "images" folder that were removed from the
 * markdown by saving this file — but only if no other document in the folder
 * still references them. Runs deliberately on save so undo before saving
 * still finds the file on disk.
 */
export async function cleanupOrphanedImages(
  folderPath: string,
  filePath: string,
  previousMarkdown: string,
  nextMarkdown: string
): Promise<void> {
  const fileDirPath = await dirname(filePath);
  const previousRefs = await resolveImageRootRelativePaths(previousMarkdown, fileDirPath, folderPath);
  const nextRefs = await resolveImageRootRelativePaths(nextMarkdown, fileDirPath, folderPath);

  // Deleting an image cannot be undone, so never act on a document whose image
  // paths are in a broken state. A reference resolving outside the vault (e.g.
  // "../images/x.png" in a file that has meanwhile moved to the root) cannot be
  // matched against previousRefs and would look exactly like "the image was
  // removed from this note" — leading to the image file being deleted. Leaving
  // an unused image behind is the harmless failure of the two.
  if (nextRefs.hasBrokenReference) {
    return;
  }

  const removedRefs = [...previousRefs.paths].filter((path) => !nextRefs.paths.has(path));

  await removeUnreferencedImages(folderPath, removedRefs, nextRefs.paths, [filePath]);
}

/**
 * Deletes the images the given (already deleted) documents referenced, e.g.
 * every note of a deleted folder, unless a document that is still in the vault
 * references them. One vault scan for the whole batch instead of one per note.
 */
export async function cleanupImagesOfDeletedFiles(
  folderPath: string,
  deletedDocuments: Array<{ filePath: string; markdown: string }>
): Promise<void> {
  const removedRefs = new Set<string>();

  for (const document of deletedDocuments) {
    const fileDirPath = await dirname(document.filePath);
    const refs = await resolveImageRootRelativePaths(document.markdown, fileDirPath, folderPath);
    refs.paths.forEach((ref) => removedRefs.add(ref));
  }

  await removeUnreferencedImages(
    folderPath,
    [...removedRefs],
    new Set(),
    deletedDocuments.map((document) => document.filePath)
  );
}

/**
 * Removes each candidate image (vault-root-relative) that neither
 * `alreadyReferenced` nor any vault document outside `excludedFilePaths`
 * references.
 */
async function removeUnreferencedImages(
  folderPath: string,
  removedRefs: string[],
  alreadyReferenced: Set<string>,
  excludedFilePaths: string[]
): Promise<void> {
  if (removedRefs.length === 0) {
    return;
  }

  const stillReferenced = new Set(alreadyReferenced);
  const markdownFiles = await listMarkdownFiles(folderPath);
  const excluded = new Set(excludedFilePaths.map(normalizeDisplayPath));

  await Promise.all(
    markdownFiles
      .filter((record) => !excluded.has(normalizeDisplayPath(record.filePath)))
      .map(async (record) => {
        try {
          const otherMarkdown = await readMarkdownFile(record.filePath);
          const otherDirPath = await dirname(record.filePath);
          const otherRefs = await resolveImageRootRelativePaths(otherMarkdown, otherDirPath, folderPath);
          otherRefs.paths.forEach((ref) => stillReferenced.add(ref));
        } catch {
          // File unreadable — ignore for the cleanup check.
        }
      })
  );

  await Promise.all(
    removedRefs
      .filter((path) => !stillReferenced.has(path))
      .map(async (path) => {
        try {
          await remove(await join(folderPath, path));
        } catch {
          // File already deleted or not found — ignore.
        }
      })
  );
}