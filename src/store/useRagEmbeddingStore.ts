import { invoke } from "@tauri-apps/api/core";
import { create } from "zustand";

import { PROVIDER_DEFAULT_API_URL, supportsEmbeddings } from "@/lib/aiClient";
import { AI_PROVIDERS, type AiProvider } from "@/store/useAiSettingsStore";

/**
 * How the knowledge base searches, and which service makes that possible.
 *
 * App-wide rather than per vault, unlike useRagSettingsStore: which folders may
 * be read is a decision about *these* notes, but "which service turns text into
 * vectors" is a machine-level setup the user does once. The two are kept apart
 * for the same reason the connection is kept apart from the chat's own
 * settings — one may run locally while the other runs in the cloud.
 */
export type RagSearchMode = "keyword" | "semantic";

export type RagEmbeddingSettings = {
  provider: AiProvider;
  apiUrl: string;
  apiKey: string;
  model: string;
};

const STORAGE_KEY = "scribedog-rag-embedding";

/**
 * Prefix that keeps this key apart from the chat's key for the same provider.
 * The Rust side stores one credential per provider string (see api_key_entry in
 * src-tauri/src/lib.rs), so prefixing the provider is all it takes — a user
 * with two OpenAI keys must not have one overwrite the other.
 */
const KEYRING_PREFIX = "embedding:";

export const DEFAULT_RAG_EMBEDDING_SETTINGS: RagEmbeddingSettings = {
  provider: "ollama",
  apiUrl: PROVIDER_DEFAULT_API_URL.ollama,
  apiKey: "",
  model: ""
};

type RagEmbeddingState = {
  /**
   * Keyword search is the default, and stays it: it needs no connection, no
   * preparation and sends nothing anywhere. Meaning search is something the
   * user opts into after reading what it costs.
   */
  searchMode: RagSearchMode;
  settings: RagEmbeddingSettings;
  isLoaded: boolean;

  load: () => Promise<void>;
  setSearchMode: (mode: RagSearchMode) => void;
  /** Applies and persists the connection, key included. */
  saveSettings: (settings: RagEmbeddingSettings) => void;
};

export async function loadEmbeddingApiKey(provider: AiProvider): Promise<string> {
  try {
    return await invoke<string>("get_api_key", { provider: `${KEYRING_PREFIX}${provider}` });
  } catch {
    return "";
  }
}

function storeEmbeddingApiKey(provider: AiProvider, apiKey: string): void {
  void invoke("store_api_key", { provider: `${KEYRING_PREFIX}${provider}`, apiKey });
}

function normalize(raw: Partial<RagEmbeddingSettings> | null): RagEmbeddingSettings {
  // A provider without an embeddings API (Anthropic) can only get in here by
  // hand-editing localStorage, and would leave the tab showing a service that
  // cannot do the job — fall back rather than display it.
  const provider =
    AI_PROVIDERS.includes(raw?.provider as AiProvider) && supportsEmbeddings(raw?.provider as AiProvider)
      ? (raw?.provider as AiProvider)
      : DEFAULT_RAG_EMBEDDING_SETTINGS.provider;

  return {
    provider,
    apiUrl:
      typeof raw?.apiUrl === "string" && raw.apiUrl.trim()
        ? raw.apiUrl.trim()
        : PROVIDER_DEFAULT_API_URL[provider],
    apiKey: "",
    model: typeof raw?.model === "string" ? raw.model.trim() : ""
  };
}

function readStored(): { searchMode: RagSearchMode; settings: RagEmbeddingSettings } {
  const fallback = { searchMode: "keyword" as RagSearchMode, settings: DEFAULT_RAG_EMBEDDING_SETTINGS };

  if (typeof window === "undefined") {
    return fallback;
  }

  try {
    const stored = window.localStorage.getItem(STORAGE_KEY);

    if (!stored) {
      return fallback;
    }

    const parsed = JSON.parse(stored) as Partial<RagEmbeddingSettings> & { searchMode?: string };

    return {
      searchMode: parsed.searchMode === "semantic" ? "semantic" : "keyword",
      settings: normalize(parsed)
    };
  } catch {
    return fallback;
  }
}

function persist(searchMode: RagSearchMode, settings: RagEmbeddingSettings): void {
  if (typeof window === "undefined") {
    return;
  }

  // The key goes to the OS credential store, never to localStorage — same rule
  // as the chat's settings.
  const { apiKey: _apiKey, ...withoutKey } = settings;

  window.localStorage.setItem(STORAGE_KEY, JSON.stringify({ searchMode, ...withoutKey }));
}

export const useRagEmbeddingStore = create<RagEmbeddingState>((set, get) => ({
  searchMode: "keyword",
  settings: DEFAULT_RAG_EMBEDDING_SETTINGS,
  isLoaded: false,

  load: async () => {
    if (get().isLoaded) {
      return;
    }

    const { searchMode, settings } = readStored();
    const apiKey = await loadEmbeddingApiKey(settings.provider);

    set({ searchMode, settings: { ...settings, apiKey }, isLoaded: true });
  },

  setSearchMode: (searchMode) => {
    set({ searchMode });
    persist(searchMode, get().settings);
  },

  saveSettings: (settings) => {
    const normalized: RagEmbeddingSettings = {
      ...normalize(settings),
      apiKey: settings.apiKey.trim()
    };

    storeEmbeddingApiKey(normalized.provider, normalized.apiKey);
    persist(get().searchMode, normalized);
    set({ settings: normalized });
  }
}));

/** The connection as the embedding calls want it, without React. */
export function currentEmbeddingSettings(): RagEmbeddingSettings {
  return useRagEmbeddingStore.getState().settings;
}

/**
 * Whether meaning search is switched on *and* configured. A half-filled
 * connection must fall back to keyword search rather than fail a lookup: the
 * user asked a question, not for a configuration error.
 */
export function isSemanticSearchConfigured(): boolean {
  const { searchMode, settings } = useRagEmbeddingStore.getState();

  return searchMode === "semantic" && supportsEmbeddings(settings.provider) && Boolean(settings.model.trim());
}
