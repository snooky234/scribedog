/**
 * The virtual root of a server vault opened from the desktop app.
 *
 * The store thinks in absolute folder paths and keys everything per vault by
 * that path: the last opened note, the recent list, the startup vault. A
 * server vault therefore gets a path too, one that names the server rather
 * than a place on disk: `/@remote/notes.example.com/anna`. Host and base path
 * are the identity, so a server that is removed and added again finds its
 * markers, and two instances behind one host stay apart.
 *
 * No local path ever looks like this: on Windows an absolute path starts with
 * a drive letter or `\\`, and a real `/@remote` folder on Linux or macOS is
 * harmless, because POSIX path arithmetic is the right one there anyway.
 */

export const REMOTE_VAULT_ROOT_PREFIX = "/@remote/";

export function isRemoteVaultPath(path: string): boolean {
  return path.replace(/\\/g, "/").startsWith(REMOTE_VAULT_ROOT_PREFIX);
}

/** `/@remote/<host[:port]><base path>` for a normalized server URL (see lib/remoteVaults.ts). */
export function remoteVaultRootFor(serverUrl: string): string {
  const url = new URL(serverUrl);
  const basePath = url.pathname.replace(/\/+$/, "");

  return `${REMOTE_VAULT_ROOT_PREFIX}${url.host}${basePath}`;
}

/**
 * The marker that turns a server's root into one of its shared vaults:
 * `/@remote/notes.example.com/anna/@shared/7f3a` (server/docs/multiuser.md).
 * A vault of its own, so every per-vault marker (last note, recent list) is
 * its own, and the server's root stays the identity of the instance it
 * belongs to: tokens and the device list are per instance, not per vault.
 */
const SHARED_SEGMENT = "/@shared/";
const SHARED_ROOT_PATTERN = /^(.+)\/@shared\/([0-9a-f]{4,16})$/;

export function sharedVaultRootFor(serverRoot: string, vaultId: string): string {
  return `${serverRoot}${SHARED_SEGMENT}${vaultId}`;
}

/** The server root and vault id behind a shared vault's root; null for any other path. */
export function parseSharedVaultRoot(path: string): { serverRoot: string; vaultId: string } | null {
  const match = SHARED_ROOT_PATTERN.exec(path.replace(/\\/g, "/"));

  return match ? { serverRoot: match[1], vaultId: match[2] } : null;
}

/** The server root a remote path belongs to: the path itself, or the instance behind a shared vault. */
export function serverRootOf(path: string): string {
  return parseSharedVaultRoot(path)?.serverRoot ?? path;
}
