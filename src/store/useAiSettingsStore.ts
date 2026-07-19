import { invoke } from "@tauri-apps/api/core";
import { create } from "zustand";

const AI_SETTINGS_STORAGE_KEY = "scribedog-ai-settings";

export type AiProvider = "ollama" | "jan" | "lmstudio" | "openai" | "anthropic" | "mistral";
export type AiThinkingMode = "off" | "default";

export const AI_PROVIDERS: AiProvider[] = ["ollama", "jan", "lmstudio", "openai", "anthropic", "mistral"];

export type AiSettings = {
  provider: AiProvider;
  apiUrl: string;
  apiKey: string;
  model: string;
  contextLength: number;
  thinkingMode: AiThinkingMode;
};

type AiSettingsState = {
  settings: AiSettings;
  isLoaded: boolean;
  loadSettings: () => Promise<void>;
  updateSettings: (patch: Partial<AiSettings>) => void;
  resetSettings: () => void;
};

const defaultAiSettings: AiSettings = {
  provider: "ollama",
  apiUrl: "http://localhost:11434",
  apiKey: "",
  model: "",
  contextLength: 4096,
  thinkingMode: "off"
};

function normalizeSettings(rawSettings: Partial<AiSettings> | null): AiSettings {
  return {
    provider: AI_PROVIDERS.includes(rawSettings?.provider as AiProvider)
      ? (rawSettings?.provider as AiProvider)
      : "ollama",
    apiUrl:
      typeof rawSettings?.apiUrl === "string" && rawSettings.apiUrl.trim()
        ? rawSettings.apiUrl.trim()
        : defaultAiSettings.apiUrl,
    apiKey: typeof rawSettings?.apiKey === "string" ? rawSettings.apiKey : defaultAiSettings.apiKey,
    model:
      typeof rawSettings?.model === "string"
        ? rawSettings.model
        : defaultAiSettings.model,
    contextLength:
      typeof rawSettings?.contextLength === "number" && Number.isFinite(rawSettings.contextLength)
        ? rawSettings.contextLength
        : defaultAiSettings.contextLength,
    thinkingMode: rawSettings?.thinkingMode === "default" ? "default" : defaultAiSettings.thinkingMode
  };
}

function readStoredSettings(): AiSettings {
  if (typeof window === "undefined") {
    return defaultAiSettings;
  }

  const storedValue = window.localStorage.getItem(AI_SETTINGS_STORAGE_KEY);

  if (!storedValue) {
    return defaultAiSettings;
  }

  try {
    return normalizeSettings(JSON.parse(storedValue) as Partial<AiSettings>);
  } catch {
    return defaultAiSettings;
  }
}

// The API key lives in the OS credential store (Windows Credential Manager,
// macOS Keychain, Linux Secret Service) instead of localStorage, so it is
// never written to disk in plain text. Everything else stays in localStorage.
function persistSettings(settings: AiSettings) {
  if (typeof window === "undefined") {
    return;
  }

  const { apiKey, ...persistableSettings } = settings;

  window.localStorage.setItem(AI_SETTINGS_STORAGE_KEY, JSON.stringify(persistableSettings));
  void invoke("store_api_key", { apiKey });
}

async function loadStoredApiKey(storedSettings: AiSettings): Promise<string> {
  // Migration: older versions kept the key in localStorage. Move it to the
  // credential store once, then strip it from localStorage.
  if (storedSettings.apiKey) {
    try {
      await invoke("store_api_key", { apiKey: storedSettings.apiKey });
      const { apiKey, ...persistableSettings } = storedSettings;
      window.localStorage.setItem(AI_SETTINGS_STORAGE_KEY, JSON.stringify(persistableSettings));
    } catch {
      // Keep the key usable in memory even if the credential store is unavailable.
    }

    return storedSettings.apiKey;
  }

  try {
    return await invoke<string>("get_api_key");
  } catch {
    return "";
  }
}

export const useAiSettingsStore = create<AiSettingsState>((set, get) => ({
  settings: defaultAiSettings,
  isLoaded: false,
  loadSettings: async () => {
    if (get().isLoaded) {
      return;
    }

    const storedSettings = readStoredSettings();
    const apiKey = await loadStoredApiKey(storedSettings);

    set({ settings: { ...storedSettings, apiKey }, isLoaded: true });
  },
  updateSettings: (patch) => {
    set((state) => {
      const nextSettings = normalizeSettings({ ...state.settings, ...patch });

      persistSettings(nextSettings);

      return { settings: nextSettings };
    });
  },
  resetSettings: () => {
    persistSettings(defaultAiSettings);
    set({ settings: defaultAiSettings });
  }
}));
