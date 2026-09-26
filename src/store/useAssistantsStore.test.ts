// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";

// The store reads localStorage at import, so every test arranges the stored
// state first and then imports a fresh copy.

const STORAGE_KEY = "scribedog-assistants";

async function loadStore() {
  vi.resetModules();
  return await import("./useAssistantsStore");
}

function store(assistants: unknown[], selectedAssistantId = "default") {
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify({ assistants, selectedAssistantId }));
}

beforeEach(() => {
  window.localStorage.clear();
});

// chatOnly is a capability, not a preference: it decides whether the assistant
// is handed any tools at all (see toolsDisabled in src/lib/aiClient.ts). What
// matters here is that it never turns itself on by accident.
describe("useAssistantsStore — chatOnly", () => {
  it("leaves an assistant stored before the switch existed with its tools", async () => {
    store([
      { id: "default", emoji: "🐾", name: "", description: "", instruction: "Be helpful." },
      { id: "a1", emoji: "😀", name: "Chattie", description: "", instruction: "Just chat." }
    ]);

    const { useAssistantsStore } = await loadStore();
    const assistants = useAssistantsStore.getState().assistants;

    expect(assistants.map((entry) => entry.chatOnly)).toEqual([false, false]);
  });

  it("is off for a newly created assistant", async () => {
    const { useAssistantsStore, DEFAULT_ASSISTANT_ID } = await loadStore();

    expect(
      useAssistantsStore.getState().assistants.find((entry) => entry.id === DEFAULT_ASSISTANT_ID)?.chatOnly
    ).toBe(false);

    const created = useAssistantsStore
      .getState()
      .addAssistant({ emoji: "", name: "Plain", description: "", instruction: "", chatOnly: false });

    expect(created.chatOnly).toBe(false);
  });

  // Only the exact boolean counts, like agentFileAccess: a truthy leftover from
  // a hand-edited file or an older format must not hand an assistant a state
  // the user never chose.
  it("only accepts a literal true", async () => {
    store([
      { id: "default", emoji: "", name: "", description: "", instruction: "", chatOnly: true },
      { id: "a1", emoji: "", name: "Yes", description: "", instruction: "", chatOnly: "yes" },
      { id: "a2", emoji: "", name: "One", description: "", instruction: "", chatOnly: 1 },
      { id: "a3", emoji: "", name: "Missing", description: "", instruction: "" }
    ]);

    const { useAssistantsStore } = await loadStore();

    expect(useAssistantsStore.getState().assistants.map((entry) => entry.chatOnly)).toEqual([
      true,
      false,
      false,
      false
    ]);
  });

  it("survives a round trip through storage", async () => {
    const { useAssistantsStore } = await loadStore();

    const created = useAssistantsStore
      .getState()
      .addAssistant({ emoji: "", name: "Chattie", description: "", instruction: "", chatOnly: true });

    expect(created.chatOnly).toBe(true);

    const reloaded = await loadStore();

    expect(
      reloaded.useAssistantsStore.getState().assistants.find((entry) => entry.id === created.id)?.chatOnly
    ).toBe(true);
  });

  it("can be switched off again", async () => {
    store([
      { id: "default", emoji: "", name: "", description: "", instruction: "" },
      { id: "a1", emoji: "", name: "Chattie", description: "", instruction: "", chatOnly: true }
    ]);

    const { useAssistantsStore } = await loadStore();

    useAssistantsStore.getState().updateAssistant("a1", { chatOnly: false });

    const stored = JSON.parse(window.localStorage.getItem(STORAGE_KEY) ?? "{}");

    expect(stored.assistants.find((entry: { id: string }) => entry.id === "a1").chatOnly).toBe(false);
  });
});
