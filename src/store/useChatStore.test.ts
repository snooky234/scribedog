import { beforeEach, describe, expect, it, vi } from "vitest";

// The reported bug lives in the turn, not in a pure helper: the store used to
// mark every plan step done the moment its loop came back, so a model that
// skipped a step still produced a list of ticks and a closing "all done".
// Everything the turn touches outside itself is faked here — the model, the
// tools, the other stores — so what is left under test is the store's own
// bookkeeping.
const { generateAiChatStep, streamAiChatStep, executeTool } = vi.hoisted(() => ({
  generateAiChatStep: vi.fn(),
  streamAiChatStep: vi.fn(),
  executeTool: vi.fn()
}));

vi.mock("@/lib/aiClient", async () => {
  const actual = await vi.importActual<typeof import("@/lib/aiClient")>("@/lib/aiClient");

  return { ...actual, generateAiChatStep, streamAiChatStep };
});

vi.mock("@/lib/chat/agentTools", () => ({
  beginChatTurn: vi.fn(),
  executeTool,
  pendingProposalTurnNote: () => "",
  proposeComposedText: () => false
}));

vi.mock("@/lib/chat/vaultFileTools", () => ({
  setAgentCapabilities: vi.fn(),
  setAgentTurnContext: vi.fn()
}));

vi.mock("@/lib/chat/checkpoints", () => ({
  deleteCheckpointsForSessions: async () => undefined,
  pruneCheckpointsToSessions: async () => undefined
}));

vi.mock("@/lib/chatSessions", () => ({
  MAX_SESSIONS: 100,
  orderAndCapSessions: (sessions: unknown[]) => sessions,
  readSessions: async () => [],
  writeSessions: async () => undefined
}));

vi.mock("@/lib/fileSystem", () => ({ getRelativeDisplayPath: (_root: string, path: string) => path }));
vi.mock("@/lib/ragSearch", () => ({ isKnowledgeBaseReady: () => false }));
vi.mock("@/lib/chat/pendingSuggestion", () => ({
  resolveUnflaggedReply: async () => ({ kind: "none" })
}));
vi.mock("@/lib/chat/imageAttachments", () => ({
  attachImageData: async (messages: unknown) => messages
}));

// No note is open, so the turn never reaches the editor-proposal bookkeeping.
vi.mock("@/store/useAppStore", () => ({
  useAppStore: { getState: () => ({ folderPath: "/vault", selectedFilePath: null }) }
}));
vi.mock("@/store/useStagedChangesStore", () => ({
  useStagedChangesStore: {
    getState: () => ({ markEditorProposal: vi.fn(), refreshCheckpoints: vi.fn() })
  }
}));

const settings = {
  provider: "ollama",
  apiUrl: "http://127.0.0.1:11434",
  model: "qwen3.5:4b",
  contextLength: 8192,
  agentFileAccess: true,
  agentAllowDelete: false,
  agentPlanning: "auto",
  agentCompactContext: false,
  agentMultiEdit: false,
  agentMaxIterations: 25,
  agentMaxPlanSteps: 15
};

vi.mock("@/store/useAiSettingsStore", () => ({
  useAiSettingsStore: { getState: () => ({ settings }) }
}));

vi.mock("@/store/useAssistantsStore", () => ({
  useAssistantsStore: { getState: () => ({}) },
  getSelectedAssistant: () => ({ id: "default", name: "Standard", instruction: "" })
}));

const { useChatStore } = await import("./useChatStore");

/** One answer from the model: plain text, or text plus tool calls. */
function step(text: string, toolCalls: { id: string; name: string; arguments: object }[] = []) {
  return { text, toolCalls, imagesDropped: false };
}

const TWO_STEP_PLAN = JSON.stringify({
  steps: [
    { title: "Notizen anlegen", instruction: "Pro Listenpunkt eine Notiz anlegen", changes: true },
    { title: "Links einsetzen", instruction: "Die Liste durch Links ersetzen", changes: true }
  ]
});

function activePlan() {
  const state = useChatStore.getState();

  return state.sessions.find((session) => session.id === state.activeSessionId)?.plan ?? [];
}

function lastReply(): string {
  const replies = transcript();

  return replies[replies.length - 1] ?? "";
}

function transcript() {
  const state = useChatStore.getState();

  return (state.sessions.find((session) => session.id === state.activeSessionId)?.messages ?? [])
    .filter((message) => message.role === "assistant")
    .map((message) => message.content);
}

describe("sendMessage with a plan", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useChatStore.setState({ sessions: [], activeSessionId: null, loadedFolderPath: null });
    executeTool.mockResolvedValue({ content: "OK: Notiz geschrieben." });
    // planTask, then reviewPlan between the two steps.
    generateAiChatStep.mockResolvedValueOnce(step(TWO_STEP_PLAN));
    generateAiChatStep.mockResolvedValue(step('{"keep":true}'));
  });

  // The reported case: the model answers the first step with prose and never
  // calls a tool, then does the second step for real.
  it("marks a step that wrote nothing as failed and says so", async () => {
    streamAiChatStep
      .mockResolvedValueOnce(step("Die Notizen sind angelegt."))
      .mockResolvedValueOnce(
        step("", [{ id: "1", name: "write_file", arguments: { path: "Liste.md", content: "…" } }])
      )
      .mockResolvedValueOnce(step("Die Links sind gesetzt."));

    await useChatStore.getState().sendMessage("Lege Notizen an und verlinke sie");

    expect(activePlan().map((entry) => entry.status)).toEqual(["failed", "done"]);
    expect(lastReply()).toContain("Notizen anlegen");
  });

  // The negative control: both steps do their work, and the turn must stay
  // silent. A notice that also appears on a good run is worth nothing.
  it("stays quiet when every step did its work", async () => {
    streamAiChatStep
      .mockResolvedValueOnce(
        step("", [{ id: "1", name: "write_file", arguments: { path: "A.md", content: "…" } }])
      )
      .mockResolvedValueOnce(step("Notizen angelegt."))
      .mockResolvedValueOnce(
        step("", [{ id: "2", name: "edit_file", arguments: { path: "Liste.md" } }])
      )
      .mockResolvedValueOnce(step("Links gesetzt."));

    await useChatStore.getState().sendMessage("Lege Notizen an und verlinke sie");

    expect(activePlan().map((entry) => entry.status)).toEqual(["done", "done"]);
    expect(lastReply()).toBe("Links gesetzt.");
  });

  // A tool that refused did not do the work, however confidently the model
  // reports back. This is the half of toolEffect the store has to honour.
  it("marks a step whose only write was refused as failed", async () => {
    executeTool.mockResolvedValue({ content: "Error: file access is off." });
    streamAiChatStep
      .mockResolvedValueOnce(
        step("", [{ id: "1", name: "write_file", arguments: { path: "A.md", content: "…" } }])
      )
      .mockResolvedValueOnce(step("Alles erledigt."))
      .mockResolvedValueOnce(
        step("", [{ id: "2", name: "edit_file", arguments: { path: "Liste.md" } }])
      )
      .mockResolvedValueOnce(step("Auch das erledigt."));

    await useChatStore.getState().sendMessage("Lege Notizen an und verlinke sie");

    expect(activePlan().map((entry) => entry.status)).toEqual(["failed", "failed"]);
    expect(lastReply()).toContain("Links einsetzen");
  });
});
