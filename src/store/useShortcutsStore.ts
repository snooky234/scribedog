import { create } from "zustand";

import type { ShortcutBinding } from "@/lib/shortcuts/binding";
import type { ShortcutActionId } from "@/lib/shortcuts/definitions";
import {
  readShortcutOverrides,
  writeShortcutOverrides,
  type ShortcutOverrides
} from "@/lib/shortcuts/storage";

type ShortcutsState = {
  /** Only the entries the user changed; everything else follows the defaults. */
  overrides: ShortcutOverrides;
  isLoaded: boolean;
  /** Set when the last write to shortcuts.json failed. */
  saveError: string | null;
  loadOverrides: () => Promise<void>;
  setBinding: (id: ShortcutActionId, binding: ShortcutBinding) => Promise<void>;
  resetBinding: (id: ShortcutActionId) => Promise<void>;
  resetAllBindings: () => Promise<void>;
};

export const useShortcutsStore = create<ShortcutsState>((set, get) => {
  // The in-memory state is updated first so the new combo is live immediately;
  // a failed write only costs persistence, not the current session.
  const persist = async (overrides: ShortcutOverrides) => {
    set({ overrides, saveError: null });

    try {
      await writeShortcutOverrides(overrides);
    } catch (error) {
      set({ saveError: error instanceof Error ? error.message : String(error) });
    }
  };

  return {
    overrides: {},
    isLoaded: false,
    saveError: null,
    loadOverrides: async () => {
      const overrides = await readShortcutOverrides();
      set({ overrides, isLoaded: true });
    },
    setBinding: async (id, binding) => {
      await persist({ ...get().overrides, [id]: binding });
    },
    resetBinding: async (id) => {
      const next = { ...get().overrides };
      delete next[id];
      await persist(next);
    },
    resetAllBindings: async () => {
      await persist({});
    }
  };
});
