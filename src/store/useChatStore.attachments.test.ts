import { beforeEach, describe, expect, it, vi } from "vitest";

import type { AttachedChatImage } from "@/lib/chat/imageAttachments";

// Only the attachment bookkeeping is under test, so everything the store pulls
// in for a real turn is stubbed away.
vi.mock("@/lib/aiClient", () => ({
  EDITING_TOOL_NAMES: [],
  STAGING_TOOL_NAMES: [],
  FLAG_SUGGESTION_TOOL_NAME: "flag_pending_suggestion",
  PLAN_TOOL_NAMES: [],
  streamAiChatStep: vi.fn(),
  generateAiChatStep: vi.fn(),
  describeAiError: vi.fn(),
  stripChatImages: (messages: unknown) => messages,
  resolveMaxOutputTokens: () => 4096,
  DEFAULT_CHAT_ASSISTANT_INSTRUCTION: ""
}));
vi.mock("@/lib/chat/agentTools", () => ({
  beginChatTurn: vi.fn(),
  executeTool: vi.fn(),
  setAgentCapabilities: vi.fn(),
  settleOpenDocumentProposals: vi.fn(),
  markOpenDocumentProposal: vi.fn(),
  proposeComposedText: vi.fn(),
  listPendingProposals: () => []
}));
vi.mock("@/lib/chat/vaultFileTools", () => ({ setAgentTurnContext: vi.fn() }));
vi.mock("@/lib/chat/checkpoints", () => ({ pruneCheckpointsToSessions: vi.fn() }));
vi.mock("@/lib/chatSessions", () => ({
  MAX_SESSIONS: 50,
  orderAndCapSessions: (sessions: unknown[]) => sessions,
  readSessions: vi.fn(),
  writeSessions: vi.fn()
}));
vi.mock("@/lib/fileSystem", () => ({ getRelativeDisplayPath: (_root: string, path: string) => path }));
vi.mock("@/lib/ragSearch", () => ({ isKnowledgeBaseReady: () => false }));
vi.mock("@/lib/chat/pendingSuggestion", () => ({ resolveUnflaggedReply: vi.fn() }));
vi.mock("@/store/useAppStore", () => ({
  useAppStore: { getState: () => ({ folderPath: "/vault", selectedFilePath: null }) }
}));
vi.mock("@/store/useStagedChangesStore", () => ({
  useStagedChangesStore: { getState: () => ({ refreshCheckpoints: vi.fn() }) }
}));
vi.mock("@/store/useAiSettingsStore", () => ({
  useAiSettingsStore: { getState: () => ({ settings: {} }) }
}));
vi.mock("@/store/useAssistantsStore", () => ({
  useAssistantsStore: { getState: () => ({}) },
  getSelectedAssistant: () => ({ id: "default", instruction: "" })
}));

const { useChatStore } = await import("./useChatStore");

function image(name: string, base64: string): AttachedChatImage {
  return { id: `${name}-${base64}`, name, base64, mimeType: "image/png" };
}

describe("attachImages", () => {
  beforeEach(() => {
    useChatStore.setState({ attachedImages: [] });
  });

  const attached = () => useChatStore.getState().attachedImages;

  it("takes several pictures that share a name", () => {
    // Every screenshot pasted from the clipboard is called "image.png". Keying
    // the duplicate check on the name swallowed all but the first, which made
    // the feature look like it allowed a single image.
    const added = useChatStore
      .getState()
      .attachImages([image("image.png", "aaa"), image("image.png", "bbb")]);

    expect(added).toBe(2);
    expect(attached()).toHaveLength(2);
  });

  it("gives the second one a name of its own", () => {
    // The name is what the chip shows and what the model is told the picture is
    // called, so two identical labels would be unusable in a question.
    useChatStore.getState().attachImages([image("image.png", "aaa"), image("image.png", "bbb")]);

    expect(attached().map((entry) => entry.name)).toEqual(["image.png", "image 2.png"]);
  });

  it("counts up across separate calls", () => {
    useChatStore.getState().attachImages([image("image.png", "aaa")]);
    useChatStore.getState().attachImages([image("image.png", "bbb")]);
    useChatStore.getState().attachImages([image("image.png", "ccc")]);

    expect(attached().map((entry) => entry.name)).toEqual([
      "image.png",
      "image 2.png",
      "image 3.png"
    ]);
  });

  it("still refuses the very same picture twice", () => {
    useChatStore.getState().attachImages([image("foto.png", "same")]);
    const added = useChatStore.getState().attachImages([image("anders.png", "same")]);

    expect(added).toBe(0);
    expect(attached()).toHaveLength(1);
  });

  it("leaves a distinct name alone", () => {
    useChatStore.getState().attachImages([image("a.png", "aaa"), image("b.png", "bbb")]);

    expect(attached().map((entry) => entry.name)).toEqual(["a.png", "b.png"]);
  });

  it("stops at the cap and reports how many it took", () => {
    const many = ["a", "b", "c", "d", "e"].map((key) => image(`${key}.png`, key));

    expect(useChatStore.getState().attachImages(many)).toBe(4);
    expect(attached()).toHaveLength(4);
  });

  it("removes one by id", () => {
    useChatStore.getState().attachImages([image("a.png", "aaa"), image("b.png", "bbb")]);
    useChatStore.getState().removeAttachedImage(attached()[0].id);

    expect(attached().map((entry) => entry.name)).toEqual(["b.png"]);
  });
});
