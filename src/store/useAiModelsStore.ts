import { create } from "zustand";

import { fetchAvailableModels } from "@/lib/aiClient";
import { type AiSettings } from "@/store/useAiSettingsStore";

type AiModelsState = {
  models: string[];
  refreshModels: (settings: Pick<AiSettings, "provider" | "apiUrl" | "apiKey">) => Promise<void>;
};

// Global, monotonic request ID across ALL callers — a late-resolving request
// from a previous provider can never overwrite a newer one, no matter which
// component triggered it.
let latestRequestId = 0;

export const useAiModelsStore = create<AiModelsState>((set) => ({
  models: [],
  refreshModels: async ({ provider, apiUrl, apiKey }) => {
    const requestId = ++latestRequestId;

    // Clear immediately so the previous provider's list is never visible
    // while the new one is still loading.
    set({ models: [] });

    try {
      const models = await fetchAvailableModels(provider, apiUrl, apiKey);

      if (latestRequestId === requestId) {
        set({ models });
      }
    } catch {
      if (latestRequestId === requestId) {
        set({ models: [] });
      }
    }
  }
}));
