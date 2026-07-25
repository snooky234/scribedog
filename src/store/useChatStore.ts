import { create } from "zustand";

import i18n from "@/i18n";
import {
  DEFAULT_CHAT_ASSISTANT_INSTRUCTION,
  generateAiChatStep,
  type AiChatMessage,
  type ChatUserAction
} from "@/lib/aiClient";
import { beginChatTurn, executeTool, pendingProposalTurnNote } from "@/lib/chat/agentTools";
import { selectMessagesForModel } from "@/lib/chat/contextWindow";
import { attachImageData } from "@/lib/chat/imageAttachments";
import { clampSelection, inlineSelectionContext } from "@/lib/chat/selectionContext";
import {
  orderAndCapSessions,
  readSessions,
  writeSessions,
  type ChatSession
} from "@/lib/chatSessions";
import { formatAiError } from "@/lib/editor/errorMessages";
import { useAiSettingsStore } from "@/store/useAiSettingsStore";
import { getSelectedAssistant, useAssistantsStore } from "@/store/useAssistantsStore";

type ChatView = "chat" | "overview";

type ChatState = {
  isOpen: boolean;
  view: ChatView;
  activeSessionId: string | null;
  sessions: ChatSession[];
  // The vault whose sessions are currently loaded; null when no folder is open
  // (chat still works, just without persistence).
  loadedFolderPath: string | null;
  // Live view of the in-flight assistant turn (never persisted).
  isStreaming: boolean;
  streamingText: string;
  streamingThinking: string;
  error: string | null;
  // The passage currently selected in the editor, mirrored here by the editor on
  // every selection change: the composer shows it as a chip, and the next turn
  // carries it as context. Empty when nothing is selected, when the user
  // detached it from the chip, or when no document is open.
  editorSelection: string;

  setEditorSelection: (text: string) => void;
  openPanel: () => void;
  closePanel: () => void;
  togglePanel: () => void;
  showOverview: () => void;
  openSession: (id: string) => void;
  newSession: () => void;
  deleteSession: (id: string) => void;
  setFolder: (folderPath: string | null) => Promise<void>;
  // `action` marks a turn a chat button generated (its content is a long
  // instruction the user never typed) so the transcript can show the action
  // instead of that text.
  sendMessage: (text: string, action?: ChatUserAction) => Promise<void>;
  cancel: () => void;
};

// A single in-flight request at a time (guarded by isStreaming). Kept out of
// the store so the non-serializable controller never triggers a re-render.
let activeAbortController: AbortController | null = null;

// Hard cap on tool-call round trips per send, guarding against a model that
// keeps calling tools without ever settling on a final answer.
const MAX_ITERATIONS = 8;

function createId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }

  return `session-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

// The auto-generated session title: the first line of the first prompt,
// collapsed and truncated. No extra LLM call in v1.
function deriveTitle(firstPrompt: string): string {
  const firstLine = firstPrompt.trim().split(/\r?\n/, 1)[0]?.trim() ?? "";
  const collapsed = firstLine.replace(/\s+/g, " ");

  if (collapsed.length <= 60) {
    return collapsed;
  }

  return `${collapsed.slice(0, 57).trimEnd()}…`;
}

/**
 * Puts the open-review note on the newest user turn of the outgoing payload.
 *
 * Not stored in the session: it describes what the editor looks like right now,
 * not something the user said, and a note frozen into the history would still
 * claim a review is open long after it was settled. Appended after trimming so
 * it cannot be cut, and rebuilt on every iteration — once this turn accepts or
 * discards the proposals, the note is simply gone from the next request.
 */
function withPendingProposalNote(messages: AiChatMessage[]): AiChatMessage[] {
  const note = pendingProposalTurnNote();

  if (!note) {
    return messages;
  }

  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const message = messages[i];

    if (message.role !== "user") {
      continue;
    }

    const withNote = [...messages];
    withNote[i] = { ...message, content: `${message.content}\n\n${note}` };

    return withNote;
  }

  return messages;
}

function persist(state: ChatState): void {
  if (state.loadedFolderPath) {
    void writeSessions(state.loadedFolderPath, state.sessions);
  }
}

export const useChatStore = create<ChatState>((set, get) => ({
  isOpen: false,
  view: "chat",
  activeSessionId: null,
  sessions: [],
  loadedFolderPath: null,
  isStreaming: false,
  streamingText: "",
  streamingThinking: "",
  error: null,
  editorSelection: "",

  // Pushed on every editor selection change, so the no-op case (typing, with
  // nothing selected before or after) must not re-render the panel.
  setEditorSelection: (text) => {
    if (get().editorSelection !== text) {
      set({ editorSelection: text });
    }
  },
  openPanel: () => {
    // Always open onto a fresh chat (VS Code style) — the past sessions show up
    // as a list inside the empty chat and disappear once the user starts
    // typing. Exception: an in-flight answer keeps its session open, otherwise
    // the running turn would stream into a chat nobody can see.
    if (get().isStreaming) {
      set({ isOpen: true, view: "chat", error: null });
      return;
    }

    set({
      isOpen: true,
      view: "chat",
      activeSessionId: null,
      streamingText: "",
      streamingThinking: "",
      error: null
    });
  },
  closePanel: () => set({ isOpen: false }),
  togglePanel: () => {
    if (get().isOpen) {
      set({ isOpen: false });
    } else {
      get().openPanel();
    }
  },
  showOverview: () => set({ view: "overview", error: null }),
  openSession: (id) => set({ activeSessionId: id, view: "chat", error: null }),
  newSession: () => {
    get().cancel();
    set({ activeSessionId: null, view: "chat", streamingText: "", streamingThinking: "", error: null });
  },
  deleteSession: (id) => {
    set((state) => {
      const sessions = state.sessions.filter((session) => session.id !== id);
      const activeSessionId = state.activeSessionId === id ? null : state.activeSessionId;

      return { sessions, activeSessionId };
    });
    persist(get());
  },
  setFolder: async (folderPath) => {
    if (folderPath === get().loadedFolderPath) {
      return;
    }

    get().cancel();

    if (!folderPath) {
      set({
        loadedFolderPath: null,
        sessions: [],
        activeSessionId: null,
        view: "chat",
        streamingText: "",
        streamingThinking: "",
        error: null
      });
      return;
    }

    const sessions = await readSessions(folderPath);

    set({
      loadedFolderPath: folderPath,
      sessions,
      activeSessionId: null,
      view: "chat",
      streamingText: "",
      streamingThinking: "",
      error: null
    });
  },
  sendMessage: async (text, action) => {
    const content = text.trim();

    if (!content || get().isStreaming) {
      return;
    }

    // Snapshot the review the user is answering into: this message may accept
    // it, reject it, or ignore it, and the agent has to react differently to
    // each (see beginChatTurn).
    beginChatTurn();

    const aiSettings = useAiSettingsStore.getState().settings;
    const assistant = getSelectedAssistant(useAssistantsStore.getState());

    const now = Date.now();

    // Only a turn the user actually typed picks up the selection: an action
    // turn's content is a generated instruction about an answer, not about the
    // passage that happens to be selected.
    const selection = action ? "" : clampSelection(get().editorSelection);

    const userMessage: AiChatMessage = {
      role: "user",
      content,
      ...(action ? { action } : {}),
      ...(selection ? { selection } : {})
    };

    // Resolve the target session, creating one on the first message.
    const existing = get().activeSessionId
      ? get().sessions.find((session) => session.id === get().activeSessionId) ?? null
      : null;

    const session: ChatSession = existing
      ? { ...existing, messages: [...existing.messages, userMessage], updatedAt: now }
      : {
          id: createId(),
          title: deriveTitle(content),
          createdAt: now,
          updatedAt: now,
          assistantId: assistant.id,
          messages: [userMessage]
        };

    set((state) => ({
      sessions: existing
        ? state.sessions.map((entry) => (entry.id === session.id ? session : entry))
        : orderAndCapSessions([session, ...state.sessions]),
      activeSessionId: session.id,
      view: "chat",
      isStreaming: true,
      streamingText: "",
      streamingThinking: "",
      error: null
    }));

    // Budget estimate: the real system prompt adds boilerplate, but chars/4 is
    // already heuristic — the assistant instruction is the part that actually
    // moves the budget. No document context in the system prompt: the agent
    // reads the document itself via get_document (see buildChatSystemPrompt's
    // toolsEnabled branch). The selected passage is the one exception, and it
    // rides on the user turn where the window accounts for it like any other
    // content.
    const systemEstimate = assistant.instruction || DEFAULT_CHAT_ASSISTANT_INSTRUCTION;

    const abortController = new AbortController();
    activeAbortController = abortController;

    const appendMessage = (message: AiChatMessage) => {
      set((state) => ({
        sessions: state.sessions.map((entry) =>
          entry.id === session.id
            ? { ...entry, messages: [...entry.messages, message], updatedAt: Date.now() }
            : entry
        )
      }));
    };

    try {
      let iterations = 0;

      while (iterations < MAX_ITERATIONS) {
        iterations += 1;

        // Re-read from the store each iteration rather than reusing an array
        // captured before the loop started: after each tool result the
        // session's message history has grown, and re-trimming against the
        // current history is what keeps the trimmed window valid (see
        // selectMessagesForModel's user-turn-start guarantee).
        const current = get().sessions.find((entry) => entry.id === session.id);

        if (!current) {
          break;
        }

        const modelMessages = withPendingProposalNote(
          selectMessagesForModel(
            // Expanded before trimming: the selection note becomes part of the
            // content and is charged against the budget along with it.
            inlineSelectionContext(current.messages),
            systemEstimate,
            aiSettings.contextLength
          )
        );

        const step = await generateAiChatStep(
          aiSettings,
          // The history only stores image paths; the payloads are read from
          // disk here, for this request only (see attachImageData).
          {
            messages: await attachImageData(modelMessages),
            assistantInstruction: assistant.instruction
          },
          abortController.signal
        );

        if (step.toolCalls.length === 0) {
          appendMessage({ role: "assistant", content: step.text });
          break;
        }

        appendMessage({ role: "assistant", content: step.text, toolCalls: step.toolCalls });

        const imagePaths: string[] = [];

        for (const call of step.toolCalls) {
          const result = await executeTool(call.name, call.arguments);
          appendMessage({ role: "tool", toolCallId: call.id, toolName: call.name, content: result.content });

          if (result.imagePath && !imagePaths.includes(result.imagePath)) {
            imagePaths.push(result.imagePath);
          }
        }

        // A tool result is plain text on every provider bar Anthropic, so an
        // image get_image resolved cannot travel back inside it. It becomes one
        // user turn after all tool results instead — the shape every provider
        // family accepts images in. Collected across the turn's calls so two
        // get_image calls stay a single turn (Anthropic rejects two
        // consecutive user turns). Model-facing text, like the tool results
        // themselves; the chat UI does not render this turn.
        if (imagePaths.length > 0) {
          const isSingle = imagePaths.length === 1;

          appendMessage({
            role: "user",
            content:
              `Here ${isSingle ? "is the image" : "are the images"} you requested ` +
              `(${imagePaths.join(", ")}). Look at ${isSingle ? "it" : "them"} and answer my question.`,
            imagePaths
          });
        }

        if (iterations >= MAX_ITERATIONS) {
          appendMessage({ role: "assistant", content: i18n.t("chat.agentStopped") });
        }
      }

      set({ isStreaming: false, streamingText: "", streamingThinking: "", error: null });
    } catch (error) {
      if (abortController.signal.aborted) {
        // Tool edits already applied are single undo steps and stay in the
        // document — only the loop itself needs to stop here.
        set({ isStreaming: false, streamingText: "", streamingThinking: "", error: null });
      } else {
        set({
          isStreaming: false,
          streamingText: "",
          streamingThinking: "",
          error: formatAiError(error, i18n.t)
        });
      }
    } finally {
      activeAbortController = null;
      persist(get());
    }
  },
  cancel: () => {
    activeAbortController?.abort();
  }
}));

export function getActiveSession(state: ChatState): ChatSession | null {
  return state.activeSessionId
    ? state.sessions.find((session) => session.id === state.activeSessionId) ?? null
    : null;
}
