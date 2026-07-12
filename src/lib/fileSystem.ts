import { dirname, join } from "@tauri-apps/api/path";
import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";

import i18n from "@/i18n";
import {
  exists,
  mkdir,
  readDir,
  readTextFile,
  remove,
  rename,
  stat,
  writeFile,
  writeTextFile
} from "@tauri-apps/plugin-fs";

export const ABSOLUTE_URL_PATTERN = /^[a-z][a-z0-9+.-]*:/i;

export const FOLDER_FILES_CHANGED_EVENT = "scribedog-folder-files-changed";

const IMAGES_FOLDER_NAME = "images";

export const VAULT_META_DIR_NAME = ".scribedog";

const EXTENSION_BY_MIME_TYPE: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/gif": "gif",
  "image/webp": "webp",
  "image/svg+xml": "svg",
  "image/bmp": "bmp"
};

const MIME_TYPE_BY_EXTENSION: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  svg: "image/svg+xml",
  bmp: "image/bmp"
};

export function guessImageMimeType(filePath: string): string {
  const extension = filePath.split(".").pop()?.toLowerCase() ?? "";
  return MIME_TYPE_BY_EXTENSION[extension] ?? "application/octet-stream";
}

const LAST_FOLDER_PATH_STORAGE_KEY = "scribedog:lastFolderPath";

type DirectoryEntry = {
  name: string;
  isDirectory: boolean;
  isFile: boolean;
  isSymlink: boolean;
};

export type MarkdownFileRecord = {
  filePath: string;
  relativePath: string;
  mtimeMs: number;
};

function isMarkdownFile(name: string): boolean {
  return name.toLowerCase().endsWith(".md");
}

function normalizeDisplayPath(path: string): string {
  return path.replace(/\\/g, "/").replace(/\/+$/, "");
}

export function getRelativeDisplayPath(rootPath: string, filePath: string): string {
  const normalizedRootPath = normalizeDisplayPath(rootPath);
  const normalizedFilePath = normalizeDisplayPath(filePath);

  if (normalizedFilePath === normalizedRootPath) {
    return "";
  }

  if (normalizedFilePath.startsWith(`${normalizedRootPath}/`)) {
    return normalizedFilePath.slice(normalizedRootPath.length + 1);
  }

  return normalizedFilePath;
}

async function collectMarkdownFiles(
  rootPath: string,
  currentPath: string,
  accumulator: MarkdownFileRecord[]
): Promise<void> {
  let entries: DirectoryEntry[];

  try {
    entries = (await readDir(currentPath)) as DirectoryEntry[];
  } catch {
    return;
  }

  for (const entry of entries) {
    const entryPath = await join(currentPath, entry.name);

    if (entry.isDirectory && !entry.isSymlink) {
      if (entry.name === VAULT_META_DIR_NAME) {
        continue;
      }

      await collectMarkdownFiles(rootPath, entryPath, accumulator);
      continue;
    }

    if ((entry.isFile || entry.isSymlink) && isMarkdownFile(entry.name)) {
      const mtimeMs = await stat(entryPath)
        .then((info) => info.mtime?.getTime() ?? 0)
        .catch(() => 0);

      accumulator.push({
        filePath: entryPath,
        relativePath: getRelativeDisplayPath(rootPath, entryPath),
        mtimeMs
      });
    }
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
  const selectedFolder = await open({
    directory: true,
    recursive: true,
    title: i18n.t("fileSystem.chooseFolderTitle")
  });

  return typeof selectedFolder === "string" ? selectedFolder : null;
}

export async function allowMarkdownFolderAccess(folderPath: string): Promise<void> {
  await invoke("allow_folder_scope", { folderPath });
}

export async function watchMarkdownFolder(folderPath: string): Promise<void> {
  await invoke("watch_folder", { folderPath });
}

export async function listMarkdownFiles(rootPath: string): Promise<MarkdownFileRecord[]> {
  const accumulator: MarkdownFileRecord[] = [];

  await collectMarkdownFiles(rootPath, rootPath, accumulator);

  return accumulator.sort((left, right) =>
    left.relativePath.localeCompare(right.relativePath, undefined, {
      numeric: true,
      sensitivity: "base"
    })
  );
}

export async function readMarkdownFile(filePath: string): Promise<string> {
  return readTextFile(filePath);
}

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

export function formatFolderLabel(folderPath: string | null): string {
  if (!folderPath) {
    return i18n.t("fileSystem.noFolderOpen");
  }

  return `${normalizeDisplayPath(folderPath)}/`;
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

async function resolveImageRootRelativePaths(
  markdown: string,
  fileDirPath: string,
  folderPath: string
): Promise<Set<string>> {
  const rootRelativePaths = new Set<string>();

  for (const rawSrc of extractImageReferences(markdown)) {
    if (ABSOLUTE_URL_PATTERN.test(rawSrc)) {
      continue;
    }

    try {
      const absolutePath = await join(fileDirPath, rawSrc);
      rootRelativePaths.add(getRelativeDisplayPath(folderPath, absolutePath));
    } catch {
      // Invalid path — ignore.
    }
  }

  return rootRelativePaths;
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

  const removedRefs = [...previousRefs].filter((path) => !nextRefs.has(path));

  if (removedRefs.length === 0) {
    return;
  }

  const stillReferenced = new Set(nextRefs);
  const markdownFiles = await listMarkdownFiles(folderPath);
  const normalizedCurrentFilePath = normalizeDisplayPath(filePath);

  await Promise.all(
    markdownFiles
      .filter((record) => normalizeDisplayPath(record.filePath) !== normalizedCurrentFilePath)
      .map(async (record) => {
        try {
          const otherMarkdown = await readMarkdownFile(record.filePath);
          const otherDirPath = await dirname(record.filePath);
          const otherRefs = await resolveImageRootRelativePaths(otherMarkdown, otherDirPath, folderPath);
          otherRefs.forEach((ref) => stillReferenced.add(ref));
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