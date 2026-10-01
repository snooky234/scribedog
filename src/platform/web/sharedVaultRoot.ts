/**
 * Virtual roots of shared vaults in the browser. The instance's own vault is
 * `/vault` (remoteStorage.ts); a shared vault is `/shared/<id>`, a root of
 * its own, so the store's absolute-path model and everything keyed by the
 * vault root (last note, recent list, sidecars) treat it as just another
 * vault. The id is the server's (four or more hex digits), which never
 * changes when the vault is renamed.
 */

const SHARED_ROOT_PREFIX = "/shared/";
const SHARED_ROOT_PATTERN = /^\/shared\/([0-9a-f]{4,16})\/?$/;

export function sharedVaultRoot(id: string): string {
  return `${SHARED_ROOT_PREFIX}${id}`;
}

/** The id behind a shared vault's root; null for any other path, including paths inside one. */
export function sharedVaultIdOf(folderPath: string): string | null {
  return SHARED_ROOT_PATTERN.exec(folderPath.replace(/\\/g, "/"))?.[1] ?? null;
}

/** The API path a shared vault's routes live under (server/src/app.ts). */
export function sharedVaultScope(id: string): string {
  return `/v/${id}`;
}
