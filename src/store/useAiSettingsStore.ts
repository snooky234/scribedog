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
  loadSettings: () => void;
  updateSettings: (patch: Partial<AiSettings>) => void;
  resetSettings: () => void;
};

const defaultAiSettings: AiSettings = {
  provider: "ollama",
  apiUrl: "http://localhost:11434",
  apiKey: "",
  model: "",
  contextLength: 4096,
  thinkingMode: "default"
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
    thinkingMode: rawSettings?.thinkingMode === "off" ? "off" : "default"
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

function persistSettings(settings: AiSettings) {
  if (typeof window === "undefined") {
    return;
  }

  window.localStorage.setItem(AI_SETTINGS_STORAGE_KEY, JSON.stringify(settings));
}

export const useAiSettingsStore = create<AiSettingsState>((set, get) => ({
  settings: defaultAiSettings,
  isLoaded: false,
  loadSettings: () => {
    if (get().isLoaded) {
      return;
    }

    const settings = readStoredSettings();
    set({ settings, isLoaded: true });
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
