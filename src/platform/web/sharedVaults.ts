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

export const webSharedVaults: SharedVaultsApi = {
  overview: loadOverview,
  create: (name, members) => serverApi.createSharedVault(name, members),
  update: (id, changes) => serverApi.updateSharedVault(id, changes),
  leave: (id) => serverApi.leaveSharedVault(id),
  remove: (id) => serverApi.deleteSharedVault(id),
  restore: (id) => serverApi.restoreSharedVault(id),
  dismissNotice: (id) => serverApi.dismissSharedNotice(id),
  homeRoot: REMOTE_VAULT_ROOT,
  rootFor: sharedVaultRoot,
  idOf: sharedVaultIdOf,

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
