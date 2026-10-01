import { join } from "@tauri-apps/api/path";
import {
  exists,
  mkdir,
  readDir,
  readFile,
  readTextFile,
  remove,
  rename,
  stat,
  writeFile,
  writeTextFile
} from "@tauri-apps/plugin-fs";

import {
  getRelativeDisplayPath,
  isMarkdownFileName,
  sortMarkdownRecords,
  VAULT_META_DIR_NAME
} from "@/lib/vaultPaths";
import { contentVersion, contentVersionOfText } from "@/platform/contentVersion";
import {
  ALL_VAULT_CAPABILITIES,
  type DirectoryEntry,
  type FileSystemApi,
  type MarkdownFileRecord,
  type VaultStorage,
  type VersionedText
} from "@/platform/types";

/**
 * The machine's filesystem through Tauri's fs plugin. Tauri's own scope (the
 * folder the user opened, widened by `allow_folder_scope`) is what keeps this
 * inside the vault; the frontend adds no second check of its own.
 */
export const localFs: FileSystemApi = {
  exists: (path) => exists(path),
  stat: (path) => stat(path),
  readDir: (path) => readDir(path) as Promise<DirectoryEntry[]>,
  mkdir: (path, options) => mkdir(path, options),
  readTextFile: (path) => readTextFile(path),
  writeTextFile: (path, contents) => writeTextFile(path, contents),
  readFile: (path) => readFile(path),
  writeFile: (path, data) => writeFile(path, data),
  rename: (oldPath, newPath) => rename(oldPath, newPath),
  remove: (path, options) => remove(path, options)
};

async function collectMarkdownFiles(
  rootPath: string,
  currentPath: string,
  accumulator: MarkdownFileRecord[]
): Promise<void> {
  let entries: DirectoryEntry[];

  try {
    entries = await localFs.readDir(currentPath);
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

    if ((entry.isFile || entry.isSymlink) && isMarkdownFileName(entry.name)) {
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

async function readLocalVersioned(path: string): Promise<VersionedText> {
  const bytes = await localFs.readFile(path);

  // The same decoding as the fs plugin's readTextFile, so a versioned read
  // and a plain one return the same string.
  return { content: new TextDecoder("utf-8").decode(bytes), version: await contentVersion(bytes) };
}

/** A local folder as the vault: the filesystem above plus the recursive listing. */
export const localVaultStorage: VaultStorage = {
  capabilities: ALL_VAULT_CAPABILITIES,
  ...localFs,
  // The files are on this machine; the file manager is the archive.
  packFolder: null,
  readTextFileVersioned: (path) => readLocalVersioned(path),
  // One process writes here, so checking directly before the write is enough;
  // what remains is a sync client landing in the few milliseconds between
  // the two, which no check on this side can rule out.
  async writeTextFileIfMatch(path, contents, expectedVersion) {
    const current = (await localFs.exists(path)) ? await readLocalVersioned(path) : null;

    if ((current?.version ?? null) !== expectedVersion) {
      return { ok: false, current };
    }

    await localFs.writeTextFile(path, contents);

    return { ok: true, version: await contentVersionOfText(contents) };
  },
  async listMarkdownFiles(rootPath) {
    const accumulator: MarkdownFileRecord[] = [];
    await collectMarkdownFiles(rootPath, rootPath, accumulator);

    return sortMarkdownRecords(accumulator);
  }
};
