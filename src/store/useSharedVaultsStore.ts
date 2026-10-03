import { create } from "zustand";

import i18n from "@/i18n";
import { platform } from "@/platform";
import type { SharedOverview, SharedPresenceEditor, SharedVaultInfo, SharedVaultLoss } from "@/platform/types";

/**
 * Which of the shared-vault dialogs is open. One at a time: creating and
 * editing share a form, managing lists everything, and a deletion is
 * confirmed in a dialog of its own because it names the date it becomes final.
 */
export type SharedVaultDialog =
  | { kind: "create" }
  | { kind: "edit"; id: string }
  | { kind: "manage" }
  | { kind: "delete"; id: string };

/** The open shared vault became unusable while it was open. */
export type SharedVaultLostState = { folderPath: string; name: string; reason: SharedVaultLoss };

type SharedVaultsState = {
  /** "off": the server is not part of a shared-vault setup (or the platform has none). */
  status: "idle" | "loading" | "ready" | "off" | "error";
  overview: SharedOverview | null;
  error: string | null;
  isBusy: boolean;
  dialog: SharedVaultDialog | null;
  lost: SharedVaultLostState | null;
  /** Who else has which note of the open shared vault open. */
  presence: { folderPath: string; editors: SharedPresenceEditor[] } | null;

  refresh(): Promise<void>;
  create(name: string, members: string[]): Promise<SharedVaultInfo | null>;
  update(id: string, changes: { name?: string; members?: string[] }): Promise<boolean>;
  leave(id: string): Promise<boolean>;
  remove(id: string): Promise<boolean>;
  restore(id: string): Promise<boolean>;
  dismissNotice(id: string): Promise<void>;
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
 * The shared vaults of a multi-instance server, as this person sees them.
 * The rules (who may rename, leave, delete) are the server's; this store only
 * runs the calls and keeps the overview fresh after each of them, so every
 * list in the UI shows what the server just said.
 */
/**
 * How long a vault the person is deleting or leaving themselves stays exempt
 * from the "access lost" dialog: their own server closes the vault's event
 * stream at once, and that close can arrive before the switch back to their
 * own vault has finished. Telling someone that the vault they just deleted
 * was deleted would be noise.
 */
const DEPARTURE_GRACE_MS = 15_000;
const departingRoots = new Set<string>();

function markDeparting(id: string): () => void {
  const root = platform.sharedVaults?.rootFor(id);

  if (!root) {
    return () => undefined;
  }

  departingRoots.add(root);

  return () => {
    setTimeout(() => departingRoots.delete(root), DEPARTURE_GRACE_MS);
  };
}

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
    overview: null,
    error: null,
    isBusy: false,
    dialog: null,
    lost: null,
    presence: null,

    async refresh() {
      const api = platform.sharedVaults;

      if (!api) {
        set({ status: "off", overview: null, presence: null, lost: null });
        return;
      }

      if (get().status === "idle") {
        set({ status: "loading" });
      }

      try {
        const overview = await api.overview();
        // Everything about the previous vault goes with it: a local folder
        // (or a server without sharing) has no shared vaults, no notices and
        // nobody else editing in it.
        set(overview ? { status: "ready", overview } : { status: "off", overview: null, presence: null, lost: null });
      } catch {
        // A server that cannot answer right now keeps the last list rather
        // than making the vaults vanish from the menu.
        set((state) => ({ status: state.overview ? "ready" : "error" }));
      }
    },

    create: (name, members) => run(() => platform.sharedVaults!.create(name, members)),

    async update(id, changes) {
      return (await run(() => platform.sharedVaults!.update(id, changes))) !== null;
    },

    async leave(id) {
      const settle = markDeparting(id);
      const left = (await run(async () => {
        await platform.sharedVaults!.leave(id);
        return true;
      })) === true;
      settle();

      return left;
    },

    async remove(id) {
      const settle = markDeparting(id);
      const removed = (await run(() => platform.sharedVaults!.remove(id))) !== null;
      settle();

      return removed;
    },

    async restore(id) {
      return (await run(() => platform.sharedVaults!.restore(id))) !== null;
    },

    async dismissNotice(id) {
      // Gone from the list at once; the server call only makes it stick.
      set((state) =>
        state.overview
          ? { overview: { ...state.overview, notices: state.overview.notices.filter((notice) => notice.id !== id) } }
          : {}
      );
      await platform.sharedVaults?.dismissNotice(id).catch(() => undefined);
    },

    openDialog: (dialog) => set({ dialog, error: null }),
    closeDialog: () => set({ dialog: null, error: null }),

    markLost(folderPath, reason) {
      if (departingRoots.has(folderPath)) {
        return;
      }

      const id = platform.sharedVaults?.idOf(folderPath) ?? null;
      const name = get().overview?.vaults.find((vault) => vault.id === id)?.name ?? id ?? folderPath;

      set({ lost: { folderPath, name, reason } });
      void get().refresh();
    },

    clearLost: () => set({ lost: null }),
    setPresence: (folderPath, editors) => set({ presence: { folderPath, editors } })
  };
});

/**
 * The display name of a shared vault by its root, for the sidebar. Read
 * outside React (formatFolderLabel in lib/fileSystem.ts), hence getState.
 */
export function sharedVaultNameFor(folderPath: string): string | null {
  const id = platform.sharedVaults?.idOf(folderPath) ?? null;

  if (!id) {
    return null;
  }

  return useSharedVaultsStore.getState().overview?.vaults.find((vault) => vault.id === id)?.name ?? null;
}
