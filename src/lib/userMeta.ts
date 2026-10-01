import { join } from "@/platform/paths";

import { VAULT_META_DIR_NAME } from "@/lib/vaultPaths";

/**
 * Where a vault keeps the sidecars that belong to one person rather than to
 * the vault: chat history, the agent's pending proposals and its checkpoints,
 * the "In progress" list and the sort mode.
 *
 * In a vault that one person uses they sit in `.scribedog/` next to the shared
 * ones (versions, manual order, icons), as they always have. A vault shared
 * between several people gives each of them a folder of their own,
 * `.scribedog/users/<user>/`: otherwise one person would read the other's
 * chat history and proposals, and both would keep overwriting the same
 * staging file. Only shared vaults get that folder, so a vault that is not
 * shared never needs a migration.
 *
 * Whoever opens a shared vault registers the person it is opened as
 * (`setVaultUser`); every module that reads or writes one of these sidecars
 * asks `userMetaDirPath` instead of joining `.scribedog` itself, which is what
 * keeps a shared vault from ever falling back to the common folder.
 */

const USERS_DIR_NAME = "users";

/**
 * A user name becomes a folder name, so it is held to a plain slug: lowercase
 * letters, digits, "-" and "_", starting with a letter or digit. No dots, no
 * separators, nothing a path could be steered with.
 */
const USER_NAME_PATTERN = /^[a-z0-9][a-z0-9_-]{0,31}$/;

export class InvalidVaultUserError extends Error {}

export function isValidVaultUserName(name: string): boolean {
  return USER_NAME_PATTERN.test(name);
}

/** The person's sidecar folder relative to the vault root, as path segments. */
export function userMetaSegments(user: string | null): string[] {
  if (user === null) {
    return [VAULT_META_DIR_NAME];
  }

  if (!isValidVaultUserName(user)) {
    throw new InvalidVaultUserError(`"${user}" is not a valid user name.`);
  }

  return [VAULT_META_DIR_NAME, USERS_DIR_NAME, user];
}

// Keyed by the vault root as the store spells it, trailing separators aside;
// remote roots are POSIX and case-sensitive, so no case folding.
function vaultKey(folderPath: string): string {
  return folderPath.replace(/[\\/]+$/, "");
}

const usersByVault = new Map<string, string>();

/** Registers the person a shared vault is opened as; null for a vault of one. */
export function setVaultUser(folderPath: string, user: string | null): void {
  if (user === null) {
    usersByVault.delete(vaultKey(folderPath));
    return;
  }

  // Validated here already, so a bad name fails when the vault is opened and
  // not later, on the first write of some sidecar.
  userMetaSegments(user);
  usersByVault.set(vaultKey(folderPath), user);
}

export function getVaultUser(folderPath: string): string | null {
  return usersByVault.get(vaultKey(folderPath)) ?? null;
}

/** The folder for this person's sidecars in the vault at `folderPath`. */
export async function userMetaDirPath(folderPath: string): Promise<string> {
  return join(folderPath, ...userMetaSegments(getVaultUser(folderPath)));
}
