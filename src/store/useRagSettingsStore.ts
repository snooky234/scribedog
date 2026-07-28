import { create } from "zustand";

import {
  DEFAULT_RAG_CONFIG,
  pruneSelection,
  readRagConfig,
  setFolderIncluded,
  writeRagConfig,
  type RagConfig
} from "@/lib/ragConfig";

/**
 * The knowledge base's per-vault settings.
 *
 * Unlike the other settings stores this one is *not* app-wide: which folders
 * may be read is a property of the vault the user opened, so it lives in that
 * vault's .scribedog/rag.json and is reloaded whenever a folder is opened.
 * Loading a second vault must never carry the first one's consent over.
 *
 * The connection to the embedding service is deliberately *not* here: which
 * service turns text into vectors is a machine-level setup that the user does
 * once, not a property of these notes (see useRagEmbeddingStore), and what has
 * been prepared for this vault lives in useRagIndexStore.
 */
type RagSettingsState = {
  config: RagConfig;
  /** Vault the config belongs to; guards against a late load overwriting a newer one. */
  loadedFolderPath: string | null;
  isLoading: boolean;

  /** Reads the config of a freshly opened vault (or resets when none is open). */
  loadForFolder: (folderPath: string | null) => Promise<void>;
  setEnabled: (enabled: boolean) => void;
  toggleFolder: (folderPath: string, included: boolean) => void;
  /** Drops overrides for folders that no longer exist in the vault. */
  pruneToExistingFolders: (folderPaths: readonly string[]) => void;
};

export const useRagSettingsStore = create<RagSettingsState>((set, get) => {
  // Identifies the most recent load. Two vaults opened in quick succession
  // would otherwise race, and the loser applying its config would hand the
  // knowledge base the wrong vault's consent.
  let latestLoadToken = 0;

  // Every mutation writes through to the vault immediately, like the sort mode
  // and manual order do — there is no save button on this tab.
  const persist = (config: RagConfig): void => {
    const { loadedFolderPath } = get();

    if (loadedFolderPath) {
      void writeRagConfig(loadedFolderPath, config);
    }
  };

  return {
    config: DEFAULT_RAG_CONFIG,
    loadedFolderPath: null,
    isLoading: false,

    loadForFolder: async (folderPath: string | null) => {
      const token = ++latestLoadToken;

      if (!folderPath) {
        set({ config: DEFAULT_RAG_CONFIG, loadedFolderPath: null, isLoading: false });
        return;
      }

      set({ isLoading: true });

      const config = await readRagConfig(folderPath);

      // Another folder was opened while this read was in flight: its load owns
      // the store now, so this result is discarded rather than applied.
      if (token !== latestLoadToken) {
        return;
      }

      set({ config, loadedFolderPath: folderPath, isLoading: false });
    },

    setEnabled: (enabled: boolean) => {
      const config = { ...get().config, enabled };
      set({ config });
      persist(config);
    },

    toggleFolder: (folderPath: string, included: boolean) => {
      const current = get().config;
      const selection = setFolderIncluded(
        { rootIncluded: current.rootIncluded, overrides: current.overrides },
        folderPath,
        included
      );
      const config = { enabled: current.enabled, ...selection };

      set({ config });
      persist(config);
    },

    pruneToExistingFolders: (folderPaths: readonly string[]) => {
      const current = get().config;
      const selection = pruneSelection(
        { rootIncluded: current.rootIncluded, overrides: current.overrides },
        folderPaths
      );

      // Only write when something actually went away; this runs on every
      // folder refresh and must not churn the file for nothing.
      if (Object.keys(selection.overrides).length === Object.keys(current.overrides).length) {
        return;
      }

      const config = { enabled: current.enabled, ...selection };
      set({ config });
      persist(config);
    }
  };
});
