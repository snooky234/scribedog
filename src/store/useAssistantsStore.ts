import { create } from "zustand";

import { DEFAULT_CHAT_ASSISTANT_INSTRUCTION, DEFAULT_REWRITE_INSTRUCTION } from "@/lib/aiClient";

const ASSISTANTS_STORAGE_KEY = "scribedog-assistants";

export const DEFAULT_ASSISTANT_ID = "default";

export type Assistant = {
  id: string;
  emoji: string;
  // The default assistant stores an empty name and is rendered with a
  // localized label instead, so it follows the UI language.
  name: string;
  description: string;
  instruction: string;
};

type AssistantsState = {
  assistants: Assistant[];
  selectedAssistantId: string;
  addAssistant: (assistant: Omit<Assistant, "id">) => Assistant;
  updateAssistant: (id: string, patch: Partial<Omit<Assistant, "id">>) => void;
  removeAssistant: (id: string) => void;
  selectAssistant: (id: string) => void;
};

function createDefaultAssistant(): Assistant {
  return {
    id: DEFAULT_ASSISTANT_ID,
    emoji: "🐾",
    name: "",
    description: "",
    instruction: DEFAULT_CHAT_ASSISTANT_INSTRUCTION
  };
}

// Assistants used to also drive "Rewrite with AI" and were seeded from the
// internal rewrite instruction. Now assistants serve only the chat panel, so a
// default assistant still carrying that old rewrite text is silently migrated
// to the new conversational default. Custom assistants are left untouched.
function migrateDefaultAssistantInstruction(assistant: Assistant): Assistant {
  if (
    assistant.id === DEFAULT_ASSISTANT_ID &&
    assistant.instruction.trim() === DEFAULT_REWRITE_INSTRUCTION.trim()
  ) {
    return { ...assistant, instruction: DEFAULT_CHAT_ASSISTANT_INSTRUCTION };
  }

  return assistant;
}

function normalizeAssistant(raw: Partial<Assistant> | null): Assistant | null {
  if (!raw || typeof raw.id !== "string" || !raw.id) {
    return null;
  }

  return {
    id: raw.id,
    emoji: typeof raw.emoji === "string" ? raw.emoji : "",
    name: typeof raw.name === "string" ? raw.name : "",
    description: typeof raw.description === "string" ? raw.description : "",
    instruction: typeof raw.instruction === "string" ? raw.instruction : ""
  };
}

// The default assistant always exists and always comes first; anything
// unparseable is dropped rather than surfaced as a broken entry.
function normalizeAssistants(rawList: unknown): Assistant[] {
  const parsed = Array.isArray(rawList)
    ? rawList
        .map((entry) => normalizeAssistant(entry as Partial<Assistant>))
        .filter((entry): entry is Assistant => entry !== null)
    : [];

  const defaultAssistant = migrateDefaultAssistantInstruction(
    parsed.find((assistant) => assistant.id === DEFAULT_ASSISTANT_ID) ?? createDefaultAssistant()
  );
  const customAssistants = parsed.filter((assistant) => assistant.id !== DEFAULT_ASSISTANT_ID);

  return [defaultAssistant, ...customAssistants];
}

type StoredAssistantsState = {
  assistants: Assistant[];
  selectedAssistantId: string;
};

function readStoredState(): StoredAssistantsState {
  const fallback: StoredAssistantsState = {
    assistants: [createDefaultAssistant()],
    selectedAssistantId: DEFAULT_ASSISTANT_ID
  };

  if (typeof window === "undefined") {
    return fallback;
  }

  const storedValue = window.localStorage.getItem(ASSISTANTS_STORAGE_KEY);

  if (!storedValue) {
    return fallback;
  }

  try {
    const parsed = JSON.parse(storedValue) as Partial<StoredAssistantsState>;
    const assistants = normalizeAssistants(parsed.assistants);
    const selectedAssistantId =
      typeof parsed.selectedAssistantId === "string" &&
      assistants.some((assistant) => assistant.id === parsed.selectedAssistantId)
        ? parsed.selectedAssistantId
        : DEFAULT_ASSISTANT_ID;

    return { assistants, selectedAssistantId };
  } catch {
    return fallback;
  }
}

function persistState(state: StoredAssistantsState) {
  if (typeof window === "undefined") {
    return;
  }

  window.localStorage.setItem(ASSISTANTS_STORAGE_KEY, JSON.stringify(state));
}

function createAssistantId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }

  return `assistant-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

const storedState = readStoredState();

export const useAssistantsStore = create<AssistantsState>((set, get) => ({
  assistants: storedState.assistants,
  selectedAssistantId: storedState.selectedAssistantId,
  addAssistant: (assistant) => {
    const newAssistant: Assistant = { ...assistant, id: createAssistantId() };
    const assistants = [...get().assistants, newAssistant];

    persistState({ assistants, selectedAssistantId: get().selectedAssistantId });
    set({ assistants });

    return newAssistant;
  },
  updateAssistant: (id, patch) => {
    const assistants = get().assistants.map((assistant) =>
      assistant.id === id ? { ...assistant, ...patch, id } : assistant
    );

    persistState({ assistants, selectedAssistantId: get().selectedAssistantId });
    set({ assistants });
  },
  removeAssistant: (id) => {
    if (id === DEFAULT_ASSISTANT_ID) {
      return;
    }

    const assistants = get().assistants.filter((assistant) => assistant.id !== id);
    const selectedAssistantId =
      get().selectedAssistantId === id ? DEFAULT_ASSISTANT_ID : get().selectedAssistantId;

    persistState({ assistants, selectedAssistantId });
    set({ assistants, selectedAssistantId });
  },
  selectAssistant: (id) => {
    if (!get().assistants.some((assistant) => assistant.id === id)) {
      return;
    }

    persistState({ assistants: get().assistants, selectedAssistantId: id });
    set({ selectedAssistantId: id });
  }
}));

export function getSelectedAssistant(state: AssistantsState): Assistant {
  return (
    state.assistants.find((assistant) => assistant.id === state.selectedAssistantId) ??
    state.assistants[0]
  );
}

// The default assistant stores an empty name and is rendered with a localized
// label instead, so it follows the UI language. Prefixes the emoji when set.
export function assistantDisplayName(assistant: Assistant, defaultName: string): string {
  const name = assistant.id === DEFAULT_ASSISTANT_ID && !assistant.name ? defaultName : assistant.name;

  return assistant.emoji ? `${assistant.emoji} ${name}` : name;
}
