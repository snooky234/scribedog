import { create } from "zustand";

import i18n from "@/i18n";
import {
  DEFAULT_CHAT_ASSISTANT_INSTRUCTION,
  EDITING_TOOL_NAMES,
  FLAG_SUGGESTION_TOOL_NAME,
  generateAiChatStep,
  type AiChatMessage,
  type ChatUserAction,
  type VaultSourceRef
} from "@/lib/aiClient";
import { beginChatTurn, executeTool, pendingProposalTurnNote } from "@/lib/chat/agentTools";
import {
  inlineAttachedFiles,
  MAX_ATTACHED_FILES,
  type AttachedChatFile
} from "@/lib/chat/attachedFiles";
import { isKnowledgeBaseReady } from "@/lib/ragSearch";
import { detectPendingSuggestion } from "@/lib/chat/pendingSuggestion";
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
  // Which session the in-flight turn belongs to — *not* necessarily the active
  // one: the user can go back to the overview and open an older chat while an
  // answer is still coming in. Everything that renders "working…" has to
  // compare against this rather than against isStreaming alone, or the
  // indicator follows the navigation instead of staying with its turn.
  streamingSessionId: string | null;
  streamingText: string;
  streamingThinking: string;
  error: string | null;
  // The passage currently selected in the editor, mirrored here by the editor on
  // every selection change: the composer shows it as a chip, and the next turn
  // carries it as context. Empty when nothing is selected, when the user
  // detached it from the chip, or when no document is open.
  editorSelection: string;
  // Whether the agent may look things up in the knowledge base *in this chat*.
  // Deliberately session state rather than a stored setting: the durable
  // consent gate is the "Wissensbasis aktivieren" checkbox plus the folder
  // selection, and this only lets the user keep a single conversation out of
  // their notes without having to go and revoke that consent.
  useKnowledgeBase: boolean;
  // Files the user dragged onto the panel. They belong to the current chat, not
  // to the vault, and outrank the knowledge base — see
  // src/lib/chat/attachedFiles.ts. Never persisted: the content would be
  // written into chat-sessions.json once per turn, and the turn itself already
  // records which files it was asked with.
  attachedFiles: AttachedChatFile[];

  setUseKnowledgeBase: (value: boolean) => void;
  // Answers with how many of the offered files were actually taken on, so the
  // panel can tell the user when the limit swallowed the rest.
  attachFiles: (files: AttachedChatFile[]) => number;
  removeAttachedFile: (id: string) => void;
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
  streamingSessionId: null,
  streamingText: "",
  streamingThinking: "",
  error: null,
  editorSelection: "",
  useKnowledgeBase: true,
  attachedFiles: [],

  setUseKnowledgeBase: (value) => set({ useKnowledgeBase: value }),

  attachFiles: (files) => {
    const current = get().attachedFiles;
    // The same note dropped twice is one attachment, not two copies of the same
    // text in the context. A file from the OS has no path to compare, so its
    // name has to do — two same-named files from different folders are rarer
    // than the same file dropped again.
    const seen = new Set(current.map((file) => (file.path || file.name).toLowerCase()));
    const added: AttachedChatFile[] = [];

    for (const file of files) {
      const key = (file.path || file.name).toLowerCase();

      if (seen.has(key) || current.length + added.length >= MAX_ATTACHED_FILES) {
        continue;
      }

      seen.add(key);
      added.push(file);
    }

    if (added.length > 0) {
      set({ attachedFiles: [...current, ...added] });
    }

    return added.length;
  },

  removeAttachedFile: (id) =>
    set((state) => ({ attachedFiles: state.attachedFiles.filter((file) => file.id !== id) })),

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
      streamingSessionId: null,
      streamingText: "",
      streamingThinking: "",
      error: null,
      // The attachments belong to the chat they were dropped into; a fresh one
      // starts without them (same reasoning everywhere the session changes
      // below).
      attachedFiles: []
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
  openSession: (id) => set({ activeSessionId: id, view: "chat", error: null, attachedFiles: [] }),
  newSession: () => {
    get().cancel();
    set({
      activeSessionId: null,
      view: "chat",
      streamingSessionId: null,
      streamingText: "",
      streamingThinking: "",
      error: null,
      attachedFiles: []
    });
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
        streamingSessionId: null,
        streamingText: "",
        streamingThinking: "",
        error: null,
        attachedFiles: []
      });
      return;
    }

    const sessions = await readSessions(folderPath);

    set({
      loadedFolderPath: folderPath,
      sessions,
      activeSessionId: null,
      view: "chat",
      streamingSessionId: null,
      streamingText: "",
      streamingThinking: "",
      error: null,
      attachedFiles: []
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

    // Only the names travel with the turn: what the model gets to read is
    // assembled per request from the live attachment list, so detaching a file
    // takes effect immediately instead of being frozen into the history.
    const attachedFileNames = get().attachedFiles.map((file) => file.path || file.name);

    const userMessage: AiChatMessage = {
      role: "user",
      content,
      ...(action ? { action } : {}),
      ...(selection ? { selection } : {}),
      ...(attachedFileNames.length > 0 ? { attachedFileNames } : {})
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
      streamingSessionId: session.id,
      streamingText: "",
      streamingThinking: "",
      error: null
    }));

    // The attachment list and the knowledge-base switch are re-read on every
    // step below, so detaching a file or switching the lookup off takes effect
    // from the next step on. That only makes sense while this turn's chat is
    // the one on screen: opening another session clears the attachments (they
    // belong to the chat they were dropped into) and carries its own lookup
    // preference, which would silently strip the running request. Once the user
    // has navigated away, the turn keeps what it was sent with.
    const attachedAtSend = get().attachedFiles;
    const useKnowledgeBaseAtSend = get().useKnowledgeBase;
    const isOnScreen = () => get().activeSessionId === session.id;
    const currentAttachedFiles = () => (isOnScreen() ? get().attachedFiles : attachedAtSend);
    const currentUseKnowledgeBase = () =>
      isOnScreen() ? get().useKnowledgeBase : useKnowledgeBaseAtSend;

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

    // Answers with the position the message landed at, so a later step can go
    // back and amend it (see markSuggestsEdit).
    const appendMessage = (message: AiChatMessage): number => {
      let index = -1;

      set((state) => ({
        sessions: state.sessions.map((entry) => {
          if (entry.id !== session.id) {
            return entry;
          }

          index = entry.messages.length;
          return { ...entry, messages: [...entry.messages, message], updatedAt: Date.now() };
        })
      }));

      return index;
    };

    // Puts the "apply to document" button on an assistant message after the
    // fact. Addressed by position rather than "the last message": the follow-up
    // question runs with the turn already finished, so the user may have sent
    // the next one meanwhile.
    const markSuggestsEdit = (index: number) => {
      set((state) => ({
        sessions: state.sessions.map((entry) =>
          entry.id === session.id
            ? {
                ...entry,
                messages: entry.messages.map((message, at) =>
                  at === index && message.role === "assistant"
                    ? { ...message, suggestsEdit: true }
                    : message
                )
              }
            : entry
        )
      }));
    };

    try {
      let iterations = 0;
      // Whether this turn has already given the user something to accept in the
      // editor. If it has, the reply needs no "apply" button — the review widget
      // is the affordance.
      let turnProposedEdit = false;
      // Set when the turn ended on a plain text reply that the model did not
      // flag: the one case where it never got the chance to (see
      // detectPendingSuggestion). Resolved once the turn is otherwise finished.
      let unflaggedReply: { index: number; text: string } | null = null;
      // Notes the knowledge base tools surfaced during this turn, deduplicated.
      // Collected across all steps: the model typically searches in one step
      // and reads in the next, and both are sources of the eventual answer.
      const turnSources: VaultSourceRef[] = [];

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
            // Expanded before trimming: the selection and attachment notes
            // become part of the content and are charged against the budget
            // along with it. Re-read per iteration like the history itself, so
            // a file detached mid-turn is gone from the next step's request
            // (see currentAttachedFiles for the one case that does not hold).
            inlineAttachedFiles(
              inlineSelectionContext(current.messages),
              currentAttachedFiles(),
              aiSettings.contextLength
            ),
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
            assistantInstruction: assistant.instruction,
            // Re-read per step rather than captured before the loop: the user
            // can switch the knowledge base off mid-turn, and the next step
            // must not still be offered tools that read their notes (again
            // with the caveat in currentUseKnowledgeBase).
            vaultSearchEnabled: isKnowledgeBaseReady() && currentUseKnowledgeBase()
          },
          abortController.signal
        );

        if (step.toolCalls.length === 0) {
          const index = appendMessage({
            role: "assistant",
            content: step.text,
            // The notes this turn actually looked at, listed under the answer.
            ...(turnSources.length > 0 ? { sources: turnSources } : {})
          });

          if (!turnProposedEdit && step.text.trim()) {
            unflaggedReply = { index, text: step.text };
          }

          break;
        }

        appendMessage({
          role: "assistant",
          content: step.text,
          toolCalls: step.toolCalls,
          // The model's own call is the signal; the button appears on the very
          // message whose text it flagged. Redundant next to a proposal it made
          // in the same turn, which rule 9 tells it not to do — but a model that
          // does both anyway must not produce two ways to apply one change.
          ...(step.toolCalls.some((call) => call.name === FLAG_SUGGESTION_TOOL_NAME) &&
          !turnProposedEdit &&
          !step.toolCalls.some((call) => EDITING_TOOL_NAMES.includes(call.name))
            ? { suggestsEdit: true }
            : {})
        });

        if (step.toolCalls.some((call) => EDITING_TOOL_NAMES.includes(call.name))) {
          turnProposedEdit = true;
        }

        const imagePaths: string[] = [];

        for (const call of step.toolCalls) {
          const result = await executeTool(call.name, call.arguments);
          appendMessage({ role: "tool", toolCallId: call.id, toolName: call.name, content: result.content });

          if (result.imagePath && !imagePaths.includes(result.imagePath)) {
            imagePaths.push(result.imagePath);
          }

          for (const source of result.sources ?? []) {
            // A note read after being found appears in both tool results; the
            // more precise entry (the one naming a section) wins, so the source
            // list points at the passage rather than at the whole file.
            const existing = turnSources.findIndex((entry) => entry.path === source.path);

            if (existing === -1) {
              turnSources.push(source);
            } else if (source.headingPath && !turnSources[existing].headingPath) {
              turnSources[existing] = source;
            }
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

        // Flagging a suggestion ends the turn: the flag says the reply the model
        // just wrote is what the user acts on, so another step would only append
        // a second bubble restating it — and the "apply" button hangs on the
        // flagged message, not on that restatement. The tool result is still
        // appended above (a tool_calls turn without one is an invalid history on
        // OpenAI and Anthropic alike), the loop just stops here.
        if (step.toolCalls.every((call) => call.name === FLAG_SUGGESTION_TOOL_NAME)) {
          break;
        }

        if (iterations >= MAX_ITERATIONS) {
          appendMessage({ role: "assistant", content: i18n.t("chat.agentStopped") });
        }
      }

      set({
        isStreaming: false,
        streamingSessionId: null,
        streamingText: "",
        streamingThinking: "",
        error: null
      });

      // Deliberately after the turn is marked finished: this asks the model one
      // more question, and the reply it judges is already on screen. Leaving the
      // turn "running" for it would hold the composer for a request the user is
      // not waiting for — the button simply appears a moment later.
      if (unflaggedReply && !abortController.signal.aborted) {
        const offersEdit = await detectPendingSuggestion(
          aiSettings,
          content,
          unflaggedReply.text,
          abortController.signal
        );

        if (offersEdit) {
          markSuggestsEdit(unflaggedReply.index);
        }
      }
    } catch (error) {
      if (abortController.signal.aborted) {
        // Tool edits already applied are single undo steps and stay in the
        // document — only the loop itself needs to stop here.
        set({
          isStreaming: false,
          streamingSessionId: null,
          streamingText: "",
          streamingThinking: "",
          error: null
        });
      } else {
        set({
          isStreaming: false,
          streamingSessionId: null,
          streamingText: "",
          streamingThinking: "",
          // Shown in the panel, which may well be sitting on a different chat by
          // now — but an error the user never sees is worse than one that
          // arrives in the wrong place, and openSession clears it on the next
          // navigation.
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
