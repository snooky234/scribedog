import i18n from "@/i18n";
import { sortMarkdownRecords } from "@/lib/vaultPaths";
import { PlatformUnavailableError } from "@/platform/errors";
import { ALL_VAULT_CAPABILITIES, type FileInfo, type VaultStorage } from "@/platform/types";

import { joinPosixPath } from "./paths";
import type { ServerApi } from "./serverApi";

function toDate(ms: number | null): Date | null {
  return ms === null ? null : new Date(ms);
}

/**
 * `VaultStorage` over the server's file API (server/src/vault/routes.ts),
 * seen through the store's absolute-path model. The store works with
 * absolute paths and derives the vault-relative ones from the root
 * (`getRelativeDisplayPath`), so a remote vault gets a virtual root and every
 * path below it maps 1:1 onto the `relativePath` the server API speaks. The
 * server never sees the root.
 *
 * One request per primitive. The server mirrors the semantics of Tauri's fs
 * plugin (no implicit parent folders on write, a folder is removed only when
 * empty or with `recursive`), so the shared vault logic behaves the same as
 * on a local folder.
 */
export function createRemoteVaultStorage(api: ServerApi, root: string): VaultStorage {
  function toVaultRelative(path: string): string {
    // The desktop store may hand over a path with the other separator; the
    // server speaks forward slashes only.
    const normalized = joinPosixPath(path.replace(/\\/g, "/"));

    if (normalized === root) {
      return "";
    }

    if (!normalized.startsWith(`${root}/`)) {
      throw new PlatformUnavailableError(i18n.t("platform.pathOutsideVault", { path }));
    }

    return normalized.slice(root.length + 1);
  }

  return {
    capabilities: ALL_VAULT_CAPABILITIES,

    async listMarkdownFiles(rootPath) {
      const records = (await api.listFiles()).map((file) => ({
        filePath: joinPosixPath(rootPath, file.relativePath),
        relativePath: file.relativePath,
        mtimeMs: file.mtimeMs
      }));

      return sortMarkdownRecords(records);
    },

    // All async so a path outside the root rejects instead of throwing
    // synchronously into a caller that expects a promise.
    exists: async (path) => api.exists(toVaultRelative(path)),

    async stat(path): Promise<FileInfo> {
      const info = await api.stat(toVaultRelative(path));

      return {
        isFile: info.isFile,
        isDirectory: info.isDirectory,
        isSymlink: info.isSymlink,
        size: info.size,
        mtime: toDate(info.mtimeMs),
        birthtime: toDate(info.birthtimeMs)
      };
    },

    readDir: async (path) => api.readDir(toVaultRelative(path)),
    mkdir: async (path, options) => api.mkdir(toVaultRelative(path), options?.recursive === true),
    readTextFile: async (path) => api.readText(toVaultRelative(path)),
    async writeTextFile(path, contents) {
      await api.writeText(toVaultRelative(path), contents);
    },
    readTextFileVersioned: async (path) => api.readTextVersioned(toVaultRelative(path)),
    writeTextFileIfMatch: async (path, contents, expectedVersion) =>
      api.writeTextIfMatch(toVaultRelative(path), contents, expectedVersion),
    readFile: async (path) => api.readBytes(toVaultRelative(path)),
    async writeFile(path, data) {
      await api.writeBytes(toVaultRelative(path), data);
    },
    rename: async (oldPath, newPath) => api.rename(toVaultRelative(oldPath), toVaultRelative(newPath)),
    remove: async (path, options) => api.remove(toVaultRelative(path), options?.recursive === true),
    packFolder: async (folderPath) => api.packFolder(toVaultRelative(folderPath))
  };
}
