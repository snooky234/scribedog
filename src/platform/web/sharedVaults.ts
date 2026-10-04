import { setVaultUser } from "@/lib/userMeta";
import { createRemoteVaultStorage } from "@/platform/remote/remoteStorage";
import { createServerApi, scopedTransport, type ServerTransport } from "@/platform/remote/serverApi";
import type { SharedOverview, SharedVaultLoss, SharedVaultsApi, VaultStorage } from "@/platform/types";

import { onPresenceChanged, onStreamAccessLost, setPresencePath } from "./liveUpdates";
import { REMOTE_VAULT_ROOT } from "./remoteStorage";
import { browserTransport, serverApi, unauthorizedHandlers } from "./serverApi";
import { sharedVaultIdOf, sharedVaultRoot, sharedVaultScope } from "./sharedVaultRoot";

/**
 * Shared vaults in the browser: the management calls go to `/api/shared`,
 * each vault's files to its own `/api/v/<id>/...`, through a client that
 * shares the sign-in handling with the instance's own one.
 */

let lastOverview: SharedOverview | null = null;
const storages = new Map<string, VaultStorage>();
const lossHandlers = new Set<(folderPath: string, reason: SharedVaultLoss) => void>();

function reportLoss(folderPath: string, reason: SharedVaultLoss): void {
  for (const handler of lossHandlers) {
    handler(folderPath, reason);
  }
}

onStreamAccessLost(reportLoss);

/**
 * A deleted vault answers 410 to every request (server/src/shared/model.ts);
 * the first one to meet it says so, whoever made it. A removed member gets
 * 404, which a missing note also gets, so that case is left to the event
 * stream, which the server closes with a code of its own.
 */
function transportFor(id: string): ServerTransport {
  const scoped = scopedTransport(browserTransport, sharedVaultScope(id));

  return {
    async fetch(apiPath, init) {
      const response = await scoped.fetch(apiPath, init);

      if (response.status === 410) {
        reportLoss(sharedVaultRoot(id), "deleted");
      }

      return response;
    }
  };
}

function storageForId(id: string): VaultStorage {
  let storage = storages.get(id);

  if (!storage) {
    const client = createServerApi(transportFor(id), { unauthorizedHandlers });
    storage = createRemoteVaultStorage(client.api, sharedVaultRoot(id));
    storages.set(id, storage);
  }

  return storage;
}

async function loadOverview(): Promise<SharedOverview | null> {
  lastOverview = await serverApi.sharedOverview();
  return lastOverview;
}

/**
 * The browser talks to exactly one server, the one it was served from, so
 * the server root is empty everywhere: there is nothing to tell apart.
 */
export const webSharedVaults: SharedVaultsApi = {
  async servers() {
    const overview = await loadOverview();

    return overview ? [{ root: REMOTE_VAULT_ROOT, name: "", overview }] : [];
  },

  // The browser is not connected to servers; it is served by one.
  connectedCount: () => 0,
  overview: loadOverview,
  create: (_serverRoot, name, members) => serverApi.createSharedVault(name, members),
  update: (_serverRoot, id, changes) => serverApi.updateSharedVault(id, changes),
  leave: (_serverRoot, id) => serverApi.leaveSharedVault(id),
  remove: (_serverRoot, id) => serverApi.deleteSharedVault(id),
  restore: (_serverRoot, id) => serverApi.restoreSharedVault(id),
  dismissNotice: (_serverRoot, id) => serverApi.dismissSharedNotice(id),
  rootFor: (_serverRoot, id) => sharedVaultRoot(id),
  parseRoot: (folderPath) => {
    const id = sharedVaultIdOf(folderPath);

    return id ? { serverRoot: REMOTE_VAULT_ROOT, id } : null;
  },

  async storageFor(folderPath) {
    const id = sharedVaultIdOf(folderPath);

    if (!id) {
      return null;
    }

    const overview = lastOverview ?? (await loadOverview());

    if (!overview) {
      throw new Error("Shared vaults are not set up on this server.");
    }

    setVaultUser(folderPath, overview.me);

    return storageForId(id);
  },

  setOpenNote: (folderPath, relativePath) => setPresencePath(folderPath, relativePath),
  onPresence: (handler) => onPresenceChanged(handler),

  onAccessLost(handler) {
    lossHandlers.add(handler);

    return () => {
      lossHandlers.delete(handler);
    };
  }
};
