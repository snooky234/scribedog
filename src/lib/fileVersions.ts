import { join } from "@tauri-apps/api/path";
import { exists, mkdir, readTextFile, remove, writeTextFile } from "@tauri-apps/plugin-fs";

import { VAULT_META_DIR_NAME } from "@/lib/fileSystem";

/**
 * Automatic per-file version history, stored inside the vault's `.scribedog/`
 * metadata folder next to the other per-vault state.
 *
 * Layout:
 *   .scribedog/versions/index.json   -> { files: { "<vault-relative path>": [entry, ...] } }
 *   .scribedog/versions/<id>.md      -> full copy of the file content
 *
 * Full copies rather than patch chains: with a small per-file cap the size is
 * uncritical, and restoring stays trivially correct.
 */

export type FileVersion = {
  id: string;
  createdAt: number;
};

/** Vault-relative path (forward slashes) -> versions, newest first. */
export type VersionIndex = {
  files: Record<string, FileVersion[]>;
};

const VERSIONS_DIR_NAME = "versions";
const INDEX_FILE_NAME = "index.json";

export const MAX_VERSIONS_PER_FILE_MIN = 1;
export const MAX_VERSIONS_PER_FILE_MAX = 200;
export const MAX_VERSIONS_PER_FILE_DEFAULT = 10;

export function clampMaxVersionsPerFile(value: number): number {
  if (!Number.isFinite(value)) {
    return MAX_VERSIONS_PER_FILE_DEFAULT;
  }

  return Math.min(MAX_VERSIONS_PER_FILE_MAX, Math.max(MAX_VERSIONS_PER_FILE_MIN, Math.round(value)));
}

async function versionsDirPath(folderPath: string): Promise<string> {
  return join(folderPath, VAULT_META_DIR_NAME, VERSIONS_DIR_NAME);
}

async function indexFilePath(folderPath: string): Promise<string> {
  return join(await versionsDirPath(folderPath), INDEX_FILE_NAME);
}

async function versionContentPath(folderPath: string, versionId: string): Promise<string> {
  return join(await versionsDirPath(folderPath), `${versionId}.md`);
}

/**
 * Index reads/writes are read-modify-write cycles; two saves finishing at the
 * same time would otherwise interleave and drop one of them. Every mutation
 * goes through this single chain.
 */
let indexWriteQueue: Promise<unknown> = Promise.resolve();

function enqueue<T>(task: () => Promise<T>): Promise<T> {
  const result = indexWriteQueue.then(task, task);
  indexWriteQueue = result.catch(() => undefined);
  return result;
}

function normalizeRelativePath(relativePath: string): string {
  return relativePath.replace(/\\/g, "/").replace(/^\/+/, "");
}

/** Windows paths are case-insensitive, so index lookups have to be too. */
function pathKey(relativePath: string): string {
  return normalizeRelativePath(relativePath).toLowerCase();
}

function findIndexKey(index: VersionIndex, relativePath: string): string | null {
  const wanted = pathKey(relativePath);

  return Object.keys(index.files).find((key) => pathKey(key) === wanted) ?? null;
}

function isFileVersion(value: unknown): value is FileVersion {
  if (typeof value !== "object" || value === null) {
    return false;
  }

  const candidate = value as { id?: unknown; createdAt?: unknown };

  return typeof candidate.id === "string" && candidate.id.length > 0 && typeof candidate.createdAt === "number";
}

function normalizeIndex(parsed: unknown): VersionIndex {
  if (typeof parsed !== "object" || parsed === null) {
    return { files: {} };
  }

  const rawFiles = (parsed as { files?: unknown }).files;

  if (typeof rawFiles !== "object" || rawFiles === null || Array.isArray(rawFiles)) {
    return { files: {} };
  }

  const files: Record<string, FileVersion[]> = {};

  for (const [rawPath, rawVersions] of Object.entries(rawFiles as Record<string, unknown>)) {
    if (!Array.isArray(rawVersions)) {
      continue;
    }

    const versions = rawVersions
      .filter(isFileVersion)
      .map((version) => ({ id: version.id, createdAt: version.createdAt }))
      .sort((left, right) => right.createdAt - left.createdAt);

    if (versions.length > 0) {
      files[normalizeRelativePath(rawPath)] = versions;
    }
  }

  return { files };
}

async function readIndex(folderPath: string): Promise<VersionIndex> {
  try {
    const filePath = await indexFilePath(folderPath);

    if (!(await exists(filePath))) {
      return { files: {} };
    }

    return normalizeIndex(JSON.parse(await readTextFile(filePath)));
  } catch {
    return { files: {} };
  }
}

async function writeIndex(folderPath: string, index: VersionIndex): Promise<void> {
  const dirPath = await versionsDirPath(folderPath);
  await mkdir(dirPath, { recursive: true });
  await writeTextFile(await join(dirPath, INDEX_FILE_NAME), JSON.stringify(index, null, 2));
}

async function removeVersionContent(folderPath: string, versionId: string): Promise<void> {
  try {
    await remove(await versionContentPath(folderPath, versionId));
  } catch {
    // Content file already gone — the index entry is what matters.
  }
}

function createVersionId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

/**
 * Goes through the same queue as the mutations so a list opened right after
 * a save (which snapshots in the background) already sees the new version.
 */
export async function listFileVersions(
  folderPath: string,
  relativePath: string
): Promise<FileVersion[]> {
  return enqueue(async () => {
    const index = await readIndex(folderPath);
    const key = findIndexKey(index, relativePath);

    return key ? index.files[key] : [];
  });
}

export async function readVersionContent(folderPath: string, versionId: string): Promise<string> {
  return readTextFile(await versionContentPath(folderPath, versionId));
}

/**
 * Snapshots `content` as the newest version of the file. Returns false when
 * nothing was written because the newest existing version already holds
 * exactly this content — repeatedly saving an unchanged document must not
 * push the real history out of the ring buffer.
 */
export async function createFileVersion(
  folderPath: string,
  relativePath: string,
  content: string,
  maxVersions: number
): Promise<boolean> {
  return enqueue(async () => {
    const index = await readIndex(folderPath);
    const key = findIndexKey(index, relativePath) ?? normalizeRelativePath(relativePath);
    const versions = index.files[key] ?? [];
    const newest = versions[0];

    if (newest) {
      const newestContent = await readVersionContent(folderPath, newest.id).catch(() => null);

      if (newestContent === content) {
        return false;
      }
    }

    const version: FileVersion = { id: createVersionId(), createdAt: Date.now() };
    const dirPath = await versionsDirPath(folderPath);
    await mkdir(dirPath, { recursive: true });
    await writeTextFile(await join(dirPath, `${version.id}.md`), content);

    const cap = clampMaxVersionsPerFile(maxVersions);
    const nextVersions = [version, ...versions];
    const dropped = nextVersions.slice(cap);

    index.files[key] = nextVersions.slice(0, cap);
    await writeIndex(folderPath, index);

    await Promise.all(dropped.map((entry) => removeVersionContent(folderPath, entry.id)));

    return true;
  });
}

/** Carries the history along when a file is renamed or moved inside the vault. */
export async function moveFileVersions(
  folderPath: string,
  oldRelativePath: string,
  newRelativePath: string
): Promise<void> {
  return enqueue(async () => {
    const index = await readIndex(folderPath);
    const key = findIndexKey(index, oldRelativePath);

    if (!key) {
      return;
    }

    const versions = index.files[key];
    delete index.files[key];

    // A stale history can already sit at the destination when a file was
    // deleted outside the app and a new one took its name. The move wins;
    // the shadowed versions are dropped rather than left as orphans.
    const targetKey = findIndexKey(index, newRelativePath);
    const shadowedVersions = targetKey ? index.files[targetKey] : [];

    if (targetKey) {
      delete index.files[targetKey];
    }

    index.files[normalizeRelativePath(newRelativePath)] = versions;
    await writeIndex(folderPath, index);
    await Promise.all(shadowedVersions.map((version) => removeVersionContent(folderPath, version.id)));
  });
}

/** Carries the history of every file inside a renamed or moved folder along. */
export async function moveFolderVersions(
  folderPath: string,
  oldFolderRelativePath: string,
  newFolderRelativePath: string
): Promise<void> {
  return enqueue(async () => {
    const index = await readIndex(folderPath);
    const normalizedOldPrefix = normalizeRelativePath(oldFolderRelativePath);
    const oldPrefix = `${pathKey(oldFolderRelativePath)}/`;
    const newPrefix = normalizeRelativePath(newFolderRelativePath);
    const nextFiles: Record<string, FileVersion[]> = {};
    let changed = false;

    for (const [key, versions] of Object.entries(index.files)) {
      if (pathKey(key).startsWith(oldPrefix)) {
        const suffix = normalizeRelativePath(key).slice(normalizedOldPrefix.length + 1);
        nextFiles[`${newPrefix}/${suffix}`] = versions;
        changed = true;
      } else {
        nextFiles[key] = versions;
      }
    }

    if (!changed) {
      return;
    }

    await writeIndex(folderPath, { files: nextFiles });
  });
}

export async function deleteFileVersions(folderPath: string, relativePath: string): Promise<void> {
  return enqueue(async () => {
    const index = await readIndex(folderPath);
    const key = findIndexKey(index, relativePath);

    if (!key) {
      return;
    }

    const versions = index.files[key];
    delete index.files[key];

    await writeIndex(folderPath, index);
    await Promise.all(versions.map((version) => removeVersionContent(folderPath, version.id)));
  });
}

/** Deletes the history of every file inside a deleted folder. */
export async function deleteFolderVersions(
  folderPath: string,
  folderRelativePath: string
): Promise<void> {
  return enqueue(async () => {
    const index = await readIndex(folderPath);
    const prefix = `${pathKey(folderRelativePath)}/`;
    const nextFiles: Record<string, FileVersion[]> = {};
    const removedVersions: FileVersion[] = [];

    for (const [key, versions] of Object.entries(index.files)) {
      if (pathKey(key).startsWith(prefix)) {
        removedVersions.push(...versions);
      } else {
        nextFiles[key] = versions;
      }
    }

    if (removedVersions.length === 0) {
      return;
    }

    await writeIndex(folderPath, { files: nextFiles });
    await Promise.all(removedVersions.map((version) => removeVersionContent(folderPath, version.id)));
  });
}

/** Drops the version history of every file in the vault. */
export async function deleteAllVersions(folderPath: string): Promise<void> {
  return enqueue(async () => {
    const dirPath = await versionsDirPath(folderPath);

    if (!(await exists(dirPath))) {
      return;
    }

    await remove(dirPath, { recursive: true });
  });
}

export async function countAllVersions(folderPath: string): Promise<number> {
  const index = await readIndex(folderPath);

  return Object.values(index.files).reduce((total, versions) => total + versions.length, 0);
}
