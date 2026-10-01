import { getVaultStorage } from "@/platform";
import type { ConditionalWriteResult, DirectoryEntry, FileInfo, VersionedText } from "@/platform/types";

/**
 * Filesystem primitives on the *open vault*, with the names and signatures
 * of `@tauri-apps/plugin-fs`. Every module that reads or writes inside the
 * vault (notes, images, `.scribedog/` sidecars) imports these instead of the
 * plugin, and thereby works on a local folder and on a server vault alike.
 *
 * Not for files outside the vault (export targets, import sources, the
 * app's own config directory): those go through `platform.localFs`.
 */

export function exists(path: string): Promise<boolean> {
  return getVaultStorage().exists(path);
}

export function stat(path: string): Promise<FileInfo> {
  return getVaultStorage().stat(path);
}

export function readDir(path: string): Promise<DirectoryEntry[]> {
  return getVaultStorage().readDir(path);
}

export function mkdir(path: string, options?: { recursive?: boolean }): Promise<void> {
  return getVaultStorage().mkdir(path, options);
}

export function readTextFile(path: string): Promise<string> {
  return getVaultStorage().readTextFile(path);
}

export function writeTextFile(path: string, contents: string): Promise<void> {
  return getVaultStorage().writeTextFile(path, contents);
}

export function readTextFileVersioned(path: string): Promise<VersionedText> {
  return getVaultStorage().readTextFileVersioned(path);
}

export function writeTextFileIfMatch(
  path: string,
  contents: string,
  expectedVersion: string | null
): Promise<ConditionalWriteResult> {
  return getVaultStorage().writeTextFileIfMatch(path, contents, expectedVersion);
}

export function readFile(path: string): Promise<Uint8Array> {
  return getVaultStorage().readFile(path);
}

export function writeFile(path: string, data: Uint8Array): Promise<void> {
  return getVaultStorage().writeFile(path, data);
}

export function rename(oldPath: string, newPath: string): Promise<void> {
  return getVaultStorage().rename(oldPath, newPath);
}

export function remove(path: string, options?: { recursive?: boolean }): Promise<void> {
  return getVaultStorage().remove(path, options);
}
