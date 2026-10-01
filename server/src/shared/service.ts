import { randomBytes, randomUUID } from "node:crypto";
import { mkdir, rename, rm, stat } from "node:fs/promises";
import path from "node:path";

import type { AccessLoss } from "../vault/eventRoutes.js";
import { openVault, type Vault } from "../vault/files.js";
import { createVaultWatcher, type VaultWatcher } from "../vault/watcher.js";
import {
  createVault,
  dismissNotice,
  folderNameFor,
  isIdAvailable,
  isValidVaultId,
  leaveVault,
  normalizeVaultName,
  overviewFor,
  purgeDueAt,
  registerPerson,
  removeVaults,
  requireAccess,
  restoreVault,
  SharedVaultError,
  trashVault,
  updateVault,
  vaultsDueForPurge,
  type SharedOverview,
  type SharedRegistry,
  type SharedVaultView
} from "./model.js";
import { createPresence, type PresenceEditor, type PresenceSession } from "./presence.js";
import { createRegistryStore, SHARED_TRASH_DIR_NAME } from "./registryStore.js";

export type SharedVaults = {
  /** The person this instance serves. */
  readonly user: string;
  overview(): Promise<SharedOverview>;
  create(input: { name: unknown; members: unknown }): Promise<SharedVaultView>;
  update(id: string, changes: { name?: unknown; members?: unknown }): Promise<SharedVaultView>;
  leave(id: string): Promise<void>;
  /** Into the trash; returns when it will be purged. */
  remove(id: string): Promise<{ purgeAt: number }>;
  restore(id: string): Promise<SharedVaultView>;
  dismissNotice(id: string): Promise<void>;
  /** The vault behind a request, after the access check for that kind of request. */
  open(id: unknown, action: "read" | "write"): Promise<Vault>;
  /** "files changed" for one vault, with one native watcher however many sockets listen. */
  subscribeFiles(id: string, handler: () => void): () => void;
  /**
   * Calls `onLost` once when this person can no longer open the vault: removed
   * by the creator, left it themselves on another device, or it was deleted.
   * The registry is written by other containers too, so it is polled.
   */
  watchAccess(id: string, onLost: (reason: AccessLoss) => void): () => void;
  /** Reports which note a socket has open and hears who else has which note open. */
  joinPresence(id: string, push: (editors: PresenceEditor[]) => void): PresenceSession;
  /** Purges trashed vaults whose time is up; safe to run in several containers at once. */
  purgeExpired(): Promise<string[]>;
  close(): void;
};

export type SharedVaultsOptions = {
  root: string;
  user: string;
  log: { info(message: string): void; warn(message: string): void };
  /** How often open sockets re-check their access; short in tests. */
  accessPollMs?: number;
  now?: () => number;
};

const DEFAULT_ACCESS_POLL_MS = 2_000;
const MAX_ID_ATTEMPTS = 20;

function newVaultId(): string {
  return randomBytes(2).toString("hex");
}

/**
 * Shared vaults on disk: one folder per vault below `root`, the registry in
 * `root/.scribedog/`, deleted vaults in `root/.trash/` until they are purged.
 * Registers the instance's person as selectable for membership right away, so
 * someone whose container has started once can be added by the others.
 */
export async function openSharedVaults(options: SharedVaultsOptions): Promise<SharedVaults> {
  const { user, log } = options;
  const now = options.now ?? Date.now;
  const accessPollMs = options.accessPollMs ?? DEFAULT_ACCESS_POLL_MS;
  const root = path.resolve(options.root);

  try {
    if (!(await stat(root)).isDirectory()) {
      throw new Error("not a directory");
    }
  } catch {
    throw new Error(`Shared vault folder "${root}" does not exist or is not a directory.`);
  }

  const registry = createRegistryStore(root);
  const trashRoot = path.join(root, SHARED_TRASH_DIR_NAME);
  const vaults = new Map<string, { folder: string; vault: Vault }>();
  const watchers = new Map<string, { watcher: VaultWatcher; handlers: Set<() => void> }>();
  const accessWatchers = new Set<{ id: string; onLost: (reason: AccessLoss) => void }>();
  let accessTimer: NodeJS.Timeout | null = null;
  const presence = createPresence({ root, user, pollMs: accessPollMs, now, log });

  const vaultDir = (folder: string) => path.join(root, folder);
  const trashDir = (folder: string) => path.join(trashRoot, folder);

  await registry.update((current) => ({ registry: registerPerson(current, user, now()), result: undefined }));

  function lossFor(current: SharedRegistry, id: string): AccessLoss | null {
    const record = current.vaults.find((vault) => vault.id === id);

    if (!record || record.deletedAt !== null) {
      return "deleted";
    }

    return record.members.some((member) => member.user === user) ? null : "removed";
  }

  async function checkAccessWatchers(): Promise<void> {
    if (accessWatchers.size === 0) {
      return;
    }

    let current: SharedRegistry;

    try {
      current = await registry.read();
    } catch {
      // A registry that cannot be read right now (being replaced, a hiccup on
      // the mount) is no reason to throw anybody out.
      return;
    }

    for (const watcher of [...accessWatchers]) {
      const loss = lossFor(current, watcher.id);

      if (loss) {
        accessWatchers.delete(watcher);
        watcher.onLost(loss);
      }
    }

    if (accessWatchers.size === 0 && accessTimer) {
      clearInterval(accessTimer);
      accessTimer = null;
    }
  }

  /** After a change made here, sockets learn about it at once rather than on the next poll. */
  function afterChange(id: string): void {
    vaults.delete(id);
    void checkAccessWatchers();
  }

  async function view(id: string): Promise<SharedVaultView> {
    const found = overviewFor(await registry.read(), user).vaults.find((vault) => vault.id === id);

    if (!found) {
      throw new SharedVaultError("not_found", "There is no such shared vault.");
    }

    return found;
  }

  return {
    user,

    async overview() {
      return overviewFor(await registry.read(), user);
    },

    async create(input) {
      const id = await registry.update(async (current) => {
        // Name problems surface before any id is tried or folder made.
        const name = normalizeVaultName(input.name);

        for (let attempt = 0; attempt < MAX_ID_ATTEMPTS; attempt += 1) {
          const candidate = newVaultId();

          if (!isIdAvailable(current, candidate, folderNameFor(name, candidate))) {
            continue;
          }

          const created = createVault(current, { id: candidate, name, creator: user, members: input.members, now: now() });

          // Not recursive: an existing folder of that name (left over, made
          // by hand) is not taken over, a fresh id is picked instead.
          try {
            await mkdir(vaultDir(created.vault.folder));
          } catch (error) {
            if ((error as NodeJS.ErrnoException).code === "EEXIST") {
              continue;
            }

            throw error;
          }

          return { registry: created.registry, result: candidate };
        }

        throw new SharedVaultError("invalid", "Could not pick a folder for this vault. Try again.");
      });

      log.info(`shared vault ${id} created by ${user}`);

      return view(id);
    },

    async update(id, changes) {
      await registry.update((current) => {
        const { registry: next } = updateVault(current, id, user, changes, now());
        return { registry: next, result: undefined };
      });
      afterChange(id);

      return view(id);
    },

    async leave(id) {
      await registry.update((current) => ({ registry: leaveVault(current, id, user, now()), result: undefined }));
      afterChange(id);
    },

    async remove(id) {
      const purgeAt = await registry.update(async (current) => {
        const { registry: next, vault } = trashVault(current, id, user, { now: now(), noticeId: randomUUID() });

        await mkdir(trashRoot, { recursive: true });
        await rename(vaultDir(vault.folder), trashDir(vault.folder)).catch((error: NodeJS.ErrnoException) => {
          // Already gone from its place (moved by hand): the registry still
          // records the deletion, there is just nothing to move.
          if (error.code !== "ENOENT") {
            throw error;
          }
        });

        return { registry: next, result: purgeDueAt(vault)! };
      });
      afterChange(id);
      log.info(`shared vault ${id} moved to the trash by ${user}`);

      return { purgeAt };
    },

    async restore(id) {
      await registry.update(async (current) => {
        const { registry: next, vault } = restoreVault(current, id, user, now());

        try {
          await rename(trashDir(vault.folder), vaultDir(vault.folder));
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code === "ENOENT") {
            throw new SharedVaultError("gone", `"${vault.name}" is no longer in the trash.`);
          }

          throw error;
        }

        return { registry: next, result: undefined };
      });
      afterChange(id);

      return view(id);
    },

    async dismissNotice(id) {
      await registry.update((current) => ({ registry: dismissNotice(current, id, user), result: undefined }));
    },

    async open(id, action) {
      if (!isValidVaultId(id)) {
        throw new SharedVaultError("not_found", "There is no such shared vault.");
      }

      const record = requireAccess(await registry.read(), id, user, action);
      const cached = vaults.get(id);

      if (cached && cached.folder === record.folder) {
        return cached.vault;
      }

      const vault = await openVault(vaultDir(record.folder), { user });
      vaults.set(id, { folder: record.folder, vault });

      return vault;
    },

    subscribeFiles(id, handler) {
      let entry = watchers.get(id);

      if (!entry) {
        const cached = vaults.get(id);

        if (!cached) {
          // open() runs before every subscription, so this does not happen;
          // without a vault there is nothing to watch.
          return () => undefined;
        }

        entry = { watcher: createVaultWatcher(cached.vault.realPath, log), handlers: new Set() };
        watchers.set(id, entry);
      }

      const current = entry;
      const unsubscribe = current.watcher.subscribe(handler);
      current.handlers.add(handler);

      return () => {
        unsubscribe();
        current.handlers.delete(handler);

        if (current.handlers.size === 0) {
          current.watcher.close();
          watchers.delete(id);
        }
      };
    },

    watchAccess(id, onLost) {
      const watcher = { id, onLost };
      accessWatchers.add(watcher);

      if (!accessTimer) {
        accessTimer = setInterval(() => void checkAccessWatchers(), accessPollMs);
        accessTimer.unref();
      }

      return () => {
        accessWatchers.delete(watcher);
      };
    },

    joinPresence: (id, push) => presence.join(id, push),

    async purgeExpired() {
      const purged = await registry.update(async (current) => {
        const due = vaultsDueForPurge(current, now());

        for (const vault of due) {
          await rm(trashDir(vault.folder), { recursive: true, force: true });
        }

        return due.length
          ? { registry: removeVaults(current, due.map((vault) => vault.id)), result: due.map((vault) => vault.id) }
          : { registry: current, result: [] as string[] };
      });

      for (const id of purged) {
        afterChange(id);
        log.info(`shared vault ${id} purged from the trash`);
      }

      return purged;
    },

    close() {
      presence.close();

      if (accessTimer) {
        clearInterval(accessTimer);
        accessTimer = null;
      }

      accessWatchers.clear();

      for (const entry of watchers.values()) {
        entry.watcher.close();
      }

      watchers.clear();
    }
  };
}
