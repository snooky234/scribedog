import type { SharedOverview } from "@/platform/types";

import { REMOTE_VAULT_ROOT } from "./remoteStorage";
import { sharedVaultIdOf } from "./sharedVaultRoot";

/**
 * Which vault the tab had open last, so a start (a reload, a home screen
 * shortcut) lands in the shared vault the work stopped in rather than always
 * in the instance's own one. Kept per device, like the last note of each
 * vault (lastOpenedFile.ts), which then takes over inside the vault.
 */

const STORAGE_KEY = "scribedog-web-last-vault";

export function rememberOpenedVault(folderPath: string): void {
  try {
    if (sharedVaultIdOf(folderPath)) {
      window.localStorage.setItem(STORAGE_KEY, folderPath);
    } else {
      window.localStorage.removeItem(STORAGE_KEY);
    }
  } catch {
    // Storage may be unavailable (private mode); the own vault is the fallback.
  }
}

function readRememberedVault(): string | null {
  try {
    return window.localStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}

/**
 * The remembered shared vault only while the person is still in it: one that
 * was deleted or that they were taken off since would otherwise fail the
 * start instead of leading to their own vault.
 */
export function pickStartupVault(remembered: string | null, overview: SharedOverview | null): string {
  const id = remembered ? sharedVaultIdOf(remembered) : null;

  if (remembered && id && overview?.vaults.some((vault) => vault.id === id)) {
    return remembered;
  }

  return REMOTE_VAULT_ROOT;
}

export async function getStartupVault(loadOverview: () => Promise<SharedOverview | null>): Promise<string> {
  const remembered = readRememberedVault();

  if (!remembered) {
    return REMOTE_VAULT_ROOT;
  }

  try {
    return pickStartupVault(remembered, await loadOverview());
  } catch {
    // Not signed in yet, or the server is away: the own vault, whose open
    // leads to the sign-in like any other start.
    return REMOTE_VAULT_ROOT;
  }
}
