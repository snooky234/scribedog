import { create } from "zustand";

import i18n from "@/i18n";
import { platform } from "@/platform";
import type { SharedPresenceEditor, SharedVaultInfo, SharedVaultLoss, SharedVaultServer } from "@/platform/types";

/**
 * Which of the shared-vault dialogs is open. One at a time: creating and
 * editing share a form, managing lists everything, and a deletion is
 * confirmed in a dialog of its own because it names the date it becomes final.
 *
 * Every one of them names the server its vault lives on: the desktop app can
 * have several, and the menu lists them all, not only the open one.
 */
export type SharedVaultDialog =
  | { kind: "create"; serverRoot: string }
  | { kind: "edit"; serverRoot: string; id: string }
  | { kind: "manage" }
  | { kind: "delete"; serverRoot: string; id: string }
  /** A server itself: its display name, its devices, and disconnecting it. */
  | { kind: "server"; serverRoot: string };

/** The open shared vault became unusable while it was open. */
export type SharedVaultLostState = { folderPath: string; name: string; reason: SharedVaultLoss };

type SharedVaultsState = {
  /** "off": no server offers shared vaults (or the platform has none). */
  status: "idle" | "loading" | "ready" | "off" | "error";
  /** Every server that offers shared vaults, with the vaults this person is in. */
  servers: SharedVaultServer[];
  /** Servers this app is connected to at all; what decides whether there is anything to manage. */
  connectedCount: number;
  error: string | null;
  isBusy: boolean;
  dialog: SharedVaultDialog | null;
  lost: SharedVaultLostState | null;
  /** Who else has which note of the open shared vault open. */
  presence: { folderPath: string; editors: SharedPresenceEditor[] } | null;

  refresh(): Promise<void>;
  create(serverRoot: string, name: string, members: string[]): Promise<SharedVaultInfo | null>;
  update(serverRoot: string, id: string, changes: { name?: string; members?: string[] }): Promise<boolean>;
  leave(serverRoot: string, id: string): Promise<boolean>;
  remove(serverRoot: string, id: string): Promise<boolean>;
  restore(serverRoot: string, id: string): Promise<boolean>;
  dismissNotice(serverRoot: string, id: string): Promise<void>;
  openDialog(dialog: SharedVaultDialog): void;
  closeDialog(): void;
  markLost(folderPath: string, reason: SharedVaultLoss): void;
  clearLost(): void;
  setPresence(folderPath: string, editors: SharedPresenceEditor[]): void;
};

function errorText(error: unknown): string {
  const status = (error as { status?: unknown } | null)?.status;

  if (status === 403) {
    return i18n.t("sharedVaults.errorForbidden");
  }

  if (status === 404 || status === 410) {
    return i18n.t("sharedVaults.errorGone");
  }

  return i18n.t("sharedVaults.errorGeneric");
}

/**
 * How long a vault the person is deleting or leaving themselves stays exempt
 * from the "access lost" dialog: their own server closes the vault's event
 * stream at once, and that close can arrive before the switch back to their
 * own vault has finished. Telling someone that the vault they just deleted
 * was deleted would be noise.
 */
const DEPARTURE_GRACE_MS = 15_000;
const departingRoots = new Set<string>();

function markDeparting(serverRoot: string, id: string): () => void {
  const root = platform.sharedVaults?.rootFor(serverRoot, id);

  if (!root) {
    return () => undefined;
  }

  departingRoots.add(root);

  return () => {
    setTimeout(() => departingRoots.delete(root), DEPARTURE_GRACE_MS);
  };
}

/**
 * The shared vaults of every server this app knows, as this person sees them.
 * The rules (who may rename, leave, delete) are the server's; this store only
 * runs the calls and reloads the list after each of them, so every list in
 * the UI shows what the server just said.
 */
export const useSharedVaultsStore = create<SharedVaultsState>((set, get) => {
  async function run<T>(action: () => Promise<T>): Promise<T | null> {
    set({ isBusy: true, error: null });

    try {
      const result = await action();
      await get().refresh();
      set({ isBusy: false });
      return result;
    } catch (error) {
      set({ isBusy: false, error: errorText(error) });
      // The list may have moved on underneath (someone else deleted the vault).
      void get().refresh();
      return null;
    }
  }

  return {
    status: "idle",
    servers: [],
    connectedCount: 0,
    error: null,
    isBusy: false,
    dialog: null,
    lost: null,
    presence: null,

    async refresh() {
      const api = platform.sharedVaults;

      if (!api) {
        set({ status: "off", servers: [], connectedCount: 0, presence: null, lost: null });
        return;
      }

      set({ connectedCount: api.connectedCount() });

      if (get().status === "idle") {
        set({ status: "loading" });
      }

      try {
        const servers = await api.servers();
        // Nothing shared anywhere: whatever was on screen belonged to a vault
        // that is no longer reachable from here.
        set(
          servers.length > 0
            ? { status: "ready", servers }
            : { status: "off", servers: [], presence: null, lost: null }
        );
      } catch {
        // A server that cannot answer right now keeps the last list rather
        // than making the vaults vanish from the menu.
        set((state) => ({ status: state.servers.length > 0 ? "ready" : "error" }));
      }
    },

    create: (serverRoot, name, members) => run(() => platform.sharedVaults!.create(serverRoot, name, members)),

    async update(serverRoot, id, changes) {
      return (await run(() => platform.sharedVaults!.update(serverRoot, id, changes))) !== null;
    },

    async leave(serverRoot, id) {
      const settle = markDeparting(serverRoot, id);
      const left =
        (await run(async () => {
          await platform.sharedVaults!.leave(serverRoot, id);
          return true;
        })) === true;
      settle();

      return left;
    },

    async remove(serverRoot, id) {
      const settle = markDeparting(serverRoot, id);
      const removed = (await run(() => platform.sharedVaults!.remove(serverRoot, id))) !== null;
      settle();

      return removed;
    },

    async restore(serverRoot, id) {
      return (await run(() => platform.sharedVaults!.restore(serverRoot, id))) !== null;
    },

    async dismissNotice(serverRoot, id) {
      // Gone from the list at once; the server call only makes it stick.
      set((state) => ({
        servers: state.servers.map((server) =>
          server.root === serverRoot
            ? {
                ...server,
                overview: { ...server.overview, notices: server.overview.notices.filter((notice) => notice.id !== id) }
              }
            : server
        )
      }));
      await platform.sharedVaults?.dismissNotice(serverRoot, id).catch(() => undefined);
    },

    openDialog: (dialog) => set({ dialog, error: null }),
    closeDialog: () => set({ dialog: null, error: null }),

    markLost(folderPath, reason) {
      if (departingRoots.has(folderPath)) {
        return;
      }

      const parsed = platform.sharedVaults?.parseRoot(folderPath) ?? null;
      const name = parsed ? (findVault(get().servers, parsed.serverRoot, parsed.id)?.name ?? parsed.id) : folderPath;

      set({ lost: { folderPath, name, reason } });
      void get().refresh();
    },

    clearLost: () => set({ lost: null }),
    setPresence: (folderPath, editors) => set({ presence: { folderPath, editors } })
  };
});

/** One vault out of the servers' lists, by the server it lives on and its id. */
export function findVault(servers: SharedVaultServer[], serverRoot: string, id: string): SharedVaultInfo | null {
  return servers.find((server) => server.root === serverRoot)?.overview.vaults.find((vault) => vault.id === id) ?? null;
}

/**
 * The display name of a shared vault by its root, for the sidebar. Read
 * outside React (formatFolderLabel in lib/fileSystem.ts), hence getState.
 */
export function sharedVaultNameFor(folderPath: string): string | null {
  const parsed = platform.sharedVaults?.parseRoot(folderPath) ?? null;

  return parsed ? (findVault(useSharedVaultsStore.getState().servers, parsed.serverRoot, parsed.id)?.name ?? null) : null;
}
