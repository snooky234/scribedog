import { create } from "zustand";

import i18n from "@/i18n";
import {
  buildKnowledgeIndex,
  clearKnowledgeIndex,
  knowledgeIndexStatus,
  type IndexBuildProgress,
  type KnowledgeIndexStatus
} from "@/lib/ragIndex";

/**
 * What the knowledge base has prepared for the open vault, and the run that is
 * preparing it.
 *
 * This is a store rather than component state because the run outlives the
 * settings dialog: preparing a large vault takes minutes, and closing the
 * dialog in the meantime must neither stop it nor lose track of it. It is kept
 * apart from useRagSettingsStore so the module graph stays acyclic — the index
 * code reads the folder selection, so the selection's store cannot reach back
 * into it.
 */
type RagIndexState = {
  status: KnowledgeIndexStatus | null;
  isBuilding: boolean;
  progress: IndexBuildProgress | null;
  /** Last failure, in the user's language, or null. */
  error: string | null;

  refreshStatus: () => Promise<void>;
  /** Embeds everything not yet stored. Safe to call again after a cancel. */
  build: () => Promise<void>;
  cancelBuild: () => void;
  /** Forgets every stored vector of this vault. The notes stay untouched. */
  deleteStoredData: () => Promise<void>;
};

// Outside the store: an AbortController is not serializable state, and the same
// reasoning as for the chat's controller applies (see useChatStore).
let activeBuildController: AbortController | null = null;

export const useRagIndexStore = create<RagIndexState>((set, get) => ({
  status: null,
  isBuilding: false,
  progress: null,
  error: null,

  refreshStatus: async () => {
    try {
      set({ status: await knowledgeIndexStatus() });
    } catch {
      // Nothing stored yet, or no folder open — both are "nothing to report",
      // not a failure the user needs to see.
      set({ status: null });
    }
  },

  build: async () => {
    if (get().isBuilding) {
      return;
    }

    const controller = new AbortController();
    activeBuildController = controller;

    set({ isBuilding: true, error: null, progress: { done: 0, total: 0, file: "" } });

    try {
      await buildKnowledgeIndex({
        signal: controller.signal,
        onProgress: (progress) => set({ progress })
      });
    } catch (error) {
      // Cancelling is not a failure, whatever the aborted request threw.
      if (!controller.signal.aborted) {
        set({
          error: error instanceof Error && error.message ? error.message : i18n.t("ragSettings.buildFailed")
        });
      }
    } finally {
      if (activeBuildController === controller) {
        activeBuildController = null;
      }

      set({ isBuilding: false, progress: null });
      await get().refreshStatus();
    }
  },

  cancelBuild: () => {
    activeBuildController?.abort();
    activeBuildController = null;
  },

  deleteStoredData: async () => {
    get().cancelBuild();

    try {
      await clearKnowledgeIndex();
      set({ error: null });
    } catch (error) {
      set({ error: error instanceof Error ? error.message : i18n.t("ragSettings.deleteFailed") });
    }

    await get().refreshStatus();
  }
}));
