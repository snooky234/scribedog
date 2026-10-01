import { randomBytes } from "node:crypto";
import { mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";

import { createFileLocks } from "../vault/fileLock.js";
import { emptyRegistry, normalizeRegistry, type SharedRegistry } from "./model.js";
import { replaceFile } from "./replaceFile.js";

/** The shared root's own metadata, out of reach of every vault's file API. */
export const SHARED_META_DIR_NAME = ".scribedog";
/** Deleted vaults wait here until they are purged. */
export const SHARED_TRASH_DIR_NAME = ".trash";

const REGISTRY_FILE_NAME = "registry.json";
const REGISTRY_LOCK_KEY = "registry";

export type RegistryStore = {
  /** The registry as it is on disk now; cheap when nothing changed since the last read. */
  read(): Promise<SharedRegistry>;
  /**
   * Read-modify-write under the registry lock. `mutate` gets the current
   * registry and returns the next one (the same object when nothing changes,
   * which skips the write) together with whatever the caller wants back.
   */
  update<T>(mutate: (registry: SharedRegistry) => Promise<{ registry: SharedRegistry; result: T }> | { registry: SharedRegistry; result: T }): Promise<T>;
};

/**
 * The registry of the shared vaults, one JSON file that every container of
 * the setup reads and writes. Reads are not locked: every write replaces the
 * file in one rename, so a reader sees the old or the new registry, never
 * half of one. Writes are serialized with the same cross-process lock the
 * conditional note writes use, because two containers changing it at once
 * would otherwise each write back their own copy and drop the other's change.
 */
export function createRegistryStore(sharedRoot: string): RegistryStore {
  const metaDir = path.join(sharedRoot, SHARED_META_DIR_NAME);
  const registryPath = path.join(metaDir, REGISTRY_FILE_NAME);
  const locks = createFileLocks(path.join(metaDir, "locks"));
  let cache: { ino: number; mtimeMs: number; size: number; registry: SharedRegistry } | null = null;

  async function readFresh(): Promise<SharedRegistry> {
    let info: { ino: number; mtimeMs: number; size: number };

    try {
      info = await stat(registryPath);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        cache = null;
        return emptyRegistry();
      }

      throw error;
    }

    // Every write replaces the file by a rename, so a new inode is the
    // surest sign of a change; mtime and size cover filesystems without one.
    if (cache && cache.ino === info.ino && cache.mtimeMs === info.mtimeMs && cache.size === info.size) {
      return cache.registry;
    }

    const registry = normalizeRegistry(JSON.parse(await readFile(registryPath, "utf8")));
    cache = { ino: info.ino, mtimeMs: info.mtimeMs, size: info.size, registry };

    return registry;
  }

  async function write(registry: SharedRegistry): Promise<void> {
    await mkdir(metaDir, { recursive: true });
    const tempPath = path.join(metaDir, `.${REGISTRY_FILE_NAME}.${randomBytes(6).toString("hex")}.tmp`);

    try {
      await writeFile(tempPath, `${JSON.stringify(registry, null, 2)}\n`, "utf8");
      await replaceFile(tempPath, registryPath);
    } catch (error) {
      await rm(tempPath, { force: true }).catch(() => undefined);
      throw error;
    }

    cache = null;
  }

  return {
    read: readFresh,

    update(mutate) {
      return locks.withLock(REGISTRY_LOCK_KEY, async () => {
        // Read past the cache: under the lock, the file on disk is the only truth.
        cache = null;
        const current = await readFresh();
        const { registry, result } = await mutate(current);

        if (registry !== current) {
          await write(registry);
        }

        return result;
      });
    }
  };
}
