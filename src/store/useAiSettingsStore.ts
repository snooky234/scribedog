import { invoke } from "@tauri-apps/api/core";
import { create } from "zustand";

const AI_SETTINGS_STORAGE_KEY = "scribedog-ai-settings";

export type AiProvider = "ollama" | "jan" | "lmstudio" | "openai" | "anthropic" | "mistral";
export type AiThinkingMode = "off" | "default";

/**
 * How the agent handles a goal that takes several steps.
 *  - "off"   — never plan, one tool loop like v2.
 *  - "auto"  — a separate, tool-less planning call decides and writes the list.
 *  - "model" — the model keeps the list itself, through the plan tools.
 */
export type AgentPlanningMode = "off" | "auto" | "model";

export const AI_PROVIDERS: AiProvider[] = ["ollama", "jan", "lmstudio", "openai", "anthropic", "mistral"];

export const AGENT_PLANNING_MODES: AgentPlanningMode[] = ["off", "auto", "model"];

export const AGENT_MAX_ITERATIONS_MIN = 1;
export const AGENT_MAX_ITERATIONS_MAX = 100;
export const AGENT_MAX_ITERATIONS_DEFAULT = 25;
export const AGENT_MAX_PLAN_STEPS_MIN = 1;
export const AGENT_MAX_PLAN_STEPS_MAX = 40;
export const AGENT_MAX_PLAN_STEPS_DEFAULT = 15;

export type AiSettings = {
  provider: AiProvider;
  apiUrl: string;
  apiKey: string;
  model: string;
  contextLength: number;
  thinkingMode: AiThinkingMode;
  // --- The vault agent (see DOCS/vault-agent-plan.md) -----------------------
  //
  // Every capability is its own switch, because they need very different
  // model classes: creating, renaming and editing a note is something a 7B
  // model manages as soon as it can call tools at all, while an eight-step
  // plan across twelve files is not. Building for either extreme would be
  // wrong, so the user gets the dial — with a hint per setting saying which
  // model class it realistically needs (see settings.agent*Hint).
  //
  // The security gate. Lets the agent read AND write every note in the vault,
  // so it is off by default, exactly like the knowledge base's consent.
  agentFileAccess: boolean;
  // Sub-switch, only in effect with agentFileAccess. On by default: deletions
  // are staged, need a confirmation and stay recoverable from the checkpoint,
  // so this is for the user who wants the agent to write but not delete — not
  // a safety latch (the gate above is).
  agentAllowDelete: boolean;
  agentPlanning: AgentPlanningMode;
  // Previous steps enter the context as one sentence of outcome each instead
  // of as their full transcript.
  agentCompactContext: boolean;
  // Offer multi_edit. Small models regularly mangle its nested arguments.
  agentMultiEdit: boolean;
  // Tool rounds per step, and the plan's length. Both were fixed constants in
  // v2 (8 rounds, no plan) — a strong model rebuilding twelve files needs far
  // more, and a small one stuck in a loop should be stopped sooner. Same dial,
  // opposite directions.
  agentMaxIterations: number;
  agentMaxPlanSteps: number;
};

function clampInteger(value: unknown, min: number, max: number, fallback: number): number {
  const parsed = typeof value === "number" ? value : Number.parseInt(String(value ?? ""), 10);

  if (!Number.isFinite(parsed)) {
    return fallback;
  }

  return Math.min(max, Math.max(min, Math.round(parsed)));
}

type AiSettingsState = {
  settings: AiSettings;
  isLoaded: boolean;
  loadSettings: () => Promise<void>;
  updateSettings: (patch: Partial<AiSettings>) => void;
  resetSettings: () => void;
};

/**
 * The shipped defaults. Exported so anything that has to assemble a complete
 * AiSettings (the settings dialog, the tests) builds on them instead of
 * restating every field — a new setting added here would otherwise have to be
 * chased through every such place.
 */
export const defaultAiSettings: AiSettings = {
  provider: "ollama",
  apiUrl: "http://localhost:11434",
  apiKey: "",
  model: "",
  contextLength: 32000,
  thinkingMode: "off",
  agentFileAccess: false,
  agentAllowDelete: true,
  agentPlanning: "auto",
  agentCompactContext: true,
  agentMultiEdit: true,
  agentMaxIterations: AGENT_MAX_ITERATIONS_DEFAULT,
  agentMaxPlanSteps: AGENT_MAX_PLAN_STEPS_DEFAULT
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
    thinkingMode: rawSettings?.thinkingMode === "default" ? "default" : defaultAiSettings.thinkingMode,
    // Settings written before the agent existed simply have none of these, and
    // must keep loading unchanged. The gate in particular has to fall back to
    // false: a migration that flips it to true would hand a stored config
    // vault-wide read access nobody consented to.
    agentFileAccess: rawSettings?.agentFileAccess === true,
    agentAllowDelete: rawSettings?.agentAllowDelete !== false,
    agentPlanning: AGENT_PLANNING_MODES.includes(rawSettings?.agentPlanning as AgentPlanningMode)
      ? (rawSettings?.agentPlanning as AgentPlanningMode)
      : defaultAiSettings.agentPlanning,
    agentCompactContext: rawSettings?.agentCompactContext !== false,
    agentMultiEdit: rawSettings?.agentMultiEdit !== false,
    agentMaxIterations: clampInteger(
      rawSettings?.agentMaxIterations,
      AGENT_MAX_ITERATIONS_MIN,
      AGENT_MAX_ITERATIONS_MAX,
      AGENT_MAX_ITERATIONS_DEFAULT
    ),
    agentMaxPlanSteps: clampInteger(
      rawSettings?.agentMaxPlanSteps,
      AGENT_MAX_PLAN_STEPS_MIN,
      AGENT_MAX_PLAN_STEPS_MAX,
      AGENT_MAX_PLAN_STEPS_DEFAULT
    )
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
