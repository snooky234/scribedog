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
// Each provider gets its own credential-store entry — otherwise entering a key
// for one provider silently overwrites whatever key was stored for another.
function persistNonSecretSettings(settings: AiSettings) {
  if (typeof window === "undefined") {
    return;
  }

  const { apiKey, ...persistableSettings } = settings;

  window.localStorage.setItem(AI_SETTINGS_STORAGE_KEY, JSON.stringify(persistableSettings));
}

function storeApiKeyForProvider(provider: AiProvider, apiKey: string) {
  void invoke("store_api_key", { provider, apiKey });
}

export async function loadApiKeyForProvider(provider: AiProvider): Promise<string> {
  try {
    return await invoke<string>("get_api_key", { provider });
  } catch {
    return "";
  }
}

async function loadStoredApiKey(storedSettings: AiSettings): Promise<string> {
  // Migration: older versions kept the key in localStorage. Move it to the
  // credential store once, then strip it from localStorage.
  if (storedSettings.apiKey) {
    try {
      await invoke("store_api_key", { provider: storedSettings.provider, apiKey: storedSettings.apiKey });
      const { apiKey, ...persistableSettings } = storedSettings;
      window.localStorage.setItem(AI_SETTINGS_STORAGE_KEY, JSON.stringify(persistableSettings));
    } catch {
      // Keep the key usable in memory even if the credential store is unavailable.
    }

    return storedSettings.apiKey;
  }

  return loadApiKeyForProvider(storedSettings.provider);
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
    const previousSettings = get().settings;
    const nextSettings = normalizeSettings({ ...previousSettings, ...patch });

    // patch.apiKey, when present, always belongs to patch.provider (or the
    // unchanged current provider) — the settings dialog's Save button always
    // sends both together from one form, so this is never a stale value left
    // over from a provider the user isn't looking at anymore.
    if (patch.apiKey !== undefined) {
      storeApiKeyForProvider(nextSettings.provider, nextSettings.apiKey);
      persistNonSecretSettings(nextSettings);
      set({ settings: nextSettings });
      return;
    }

    if (nextSettings.provider !== previousSettings.provider) {
      // Provider changed without a key for it in the same patch. Never carry
      // the old provider's key forward under the new provider's name — that
      // would silently reproduce the exact bug this file exists to prevent.
      // Show nothing until the new provider's own stored key (if any) loads.
      const settingsWithBlankKey: AiSettings = { ...nextSettings, apiKey: "" };

      persistNonSecretSettings(settingsWithBlankKey);
      set({ settings: settingsWithBlankKey });

      void loadApiKeyForProvider(nextSettings.provider).then((apiKey) => {
        const current = get().settings;

        if (current.provider === nextSettings.provider) {
          set({ settings: { ...current, apiKey } });
        }
      });

      return;
    }

    persistNonSecretSettings(nextSettings);
    set({ settings: nextSettings });
  },
  resetSettings: () => {
    persistNonSecretSettings(defaultAiSettings);
    storeApiKeyForProvider(defaultAiSettings.provider, defaultAiSettings.apiKey);
    set({ settings: defaultAiSettings });
  }
}));
