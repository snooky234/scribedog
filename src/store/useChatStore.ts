import { create } from "zustand";

import i18n from "@/i18n";
import {
  DEFAULT_CHAT_ASSISTANT_INSTRUCTION,
  EDITING_TOOL_NAMES,
  FLAG_SUGGESTION_TOOL_NAME,
  IMAGE_UNSUPPORTED_TOOL_RESULT,
  PLAN_TOOL_NAMES,
  STAGING_TOOL_NAMES,
  streamAiChatStep,
  stripChatImages,
  type AiChatMessage,
  type ChatUserAction,
  type VaultSourceRef
} from "@/lib/aiClient";
import {
  beginChatTurn,
  executeTool,
  pendingProposalTurnNote,
  proposeComposedText,
  type ToolResult
} from "@/lib/chat/agentTools";
import {
  parsePlanToolSteps,
  planTask,
  reviewPlan,
  stepContext,
  type PlanStep
} from "@/lib/chat/agentPlan";
import { setAgentCapabilities, setAgentTurnContext } from "@/lib/chat/vaultFileTools";
import { deleteCheckpointsForSessions, pruneCheckpointsToSessions } from "@/lib/chat/checkpoints";
import { getRelativeDisplayPath } from "@/lib/fileSystem";
import { normalizeVaultPath } from "@/lib/chat/vaultStaging";
import { useAppStore } from "@/store/useAppStore";
import { useStagedChangesStore } from "@/store/useStagedChangesStore";
import {
  inlineAttachedFiles,
  MAX_ATTACHED_FILES,
  type AttachedChatFile
} from "@/lib/chat/attachedFiles";
import { isKnowledgeBaseReady } from "@/lib/ragSearch";
import { resolveUnflaggedReply } from "@/lib/chat/pendingSuggestion";
import { selectMessagesForModel } from "@/lib/chat/contextWindow";
import { attachImageData } from "@/lib/chat/imageAttachments";
import { clampSelection, inlineSelectionContext } from "@/lib/chat/selectionContext";
import {
  MAX_SESSIONS,
  orderAndCapSessions,
  readSessions,
  writeSessions,
  type ChatSession
} from "@/lib/chatSessions";
import { formatAiError } from "@/lib/editor/errorMessages";
import { useAiSettingsStore, type AiSettings } from "@/store/useAiSettingsStore";
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
  // What the agent is busy with right now, as the wire name of the tool it is
  // calling (see TOOL_ACTIVITY_KEYS in ChatPanel for the wording each maps to),
  // or null while it is just thinking. Set from the moment a tool's name
  // arrives in the stream until its result is in, so the wait is narrated
  // rather than spent on a row of dots.
  streamingActivity: string | null;
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

// The "nothing is being answered" half of the state, reset as one wherever a
// turn ends or the panel moves to another chat: spread over half a dozen call
// sites, a field forgotten in one of them is a live indicator left on screen
// for a turn that finished.
const IDLE_STREAM_VIEW: {
  streamingSessionId: string | null;
  streamingText: string;
  streamingThinking: string;
  streamingActivity: string | null;
} = {
  streamingSessionId: null,
  streamingText: "",
  streamingThinking: "",
  streamingActivity: null
};

// Tokens arrive faster than a panel needs to repaint, and every store write
// re-renders the whole transcript and re-runs its scroll effect. Collecting
// them into one write per interval reads as continuous typing all the same.
const STREAM_FLUSH_MS = 60;

// How many characters of a step's closing reply become the one-sentence result
// carried into the next step (see agentCompactContext).
const STEP_RESULT_CHARS = 240;

// The activity line is keyed by tool name; the separate planning call is not a
// tool, so it gets a name of its own rather than leaving the wait to the idle
// filler (see TOOL_ACTIVITY_KEYS in ChatPanel).
export const PLANNING_ACTIVITY = "__planning__";

// Endpoint/model combinations whose planning call came back unusable twice.
// Same mechanism as noVisionModels below: a model that cannot produce a plan
// will not start being able to mid-session, and paying for that extra call on
// every multi-step request is waste the user notices. Keyed by endpoint *and*
// model, so switching models is a fresh verdict.
const noPlanModels = new Set<string>();
const planFailureCounts = new Map<string, number>();

// Chats that have already been told the planning was switched off for their
// model — said once, not on every turn afterwards.
const planNoticeShown = new Set<string>();

// Endpoint/model combinations that have already rejected a request for carrying
// an image (see streamAiChatStep's retry). Remembered for the app's lifetime so
// the rejection is paid once, not once per turn: every later send skips the
// images outright and tells the model up front that it cannot see any. Keyed by
// endpoint *and* model — switching to a vision model is a different key, and
// pulling an mmproj into the same model only costs a restart to take effect.
const noVisionModels = new Set<string>();

function visionKey(settings: AiSettings): string {
  return `${settings.provider}|${settings.apiUrl}|${settings.model}`;
}

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
  if (!state.loadedFolderPath) {
    return;
  }

  void writeSessions(state.loadedFolderPath, state.sessions);

  // Only once the FIFO cap can actually be biting: orderAndCapSessions drops
  // the oldest sessions on write, and their checkpoint blobs would otherwise
  // stay behind as orphans nothing can ever reach again.
  if (state.sessions.length >= MAX_SESSIONS) {
    void pruneCheckpointsToSessions(
      state.loadedFolderPath,
      orderAndCapSessions(state.sessions).map((session) => session.id)
    )
      .then(() => useStagedChangesStore.getState().refreshCheckpoints())
      .catch(() => undefined);
  }
}

export const useChatStore = create<ChatState>((set, get) => ({
  isOpen: false,
  view: "chat",
  activeSessionId: null,
  sessions: [],
  loadedFolderPath: null,
  isStreaming: false,
  ...IDLE_STREAM_VIEW,
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
      ...IDLE_STREAM_VIEW,
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
      ...IDLE_STREAM_VIEW,
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

    // The undo checkpoints belong to the conversation that produced them —
    // otherwise their full-text blobs pile up in `.scribedog/` for a chat that
    // no longer exists, with nothing left to hang an undo button on.
    const folderPath = get().loadedFolderPath;

    if (folderPath) {
      void deleteCheckpointsForSessions(folderPath, [id])
        .then(() => useStagedChangesStore.getState().refreshCheckpoints())
        .catch(() => undefined);
    }
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
        ...IDLE_STREAM_VIEW,
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
      ...IDLE_STREAM_VIEW,
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

    // A new turn starts without the previous turn's task list: leaving it would
    // show a finished (or half-run) plan above an answer it has nothing to do
    // with, and the outer loop below would have to guess which of the two it is.
    const session: ChatSession = existing
      ? { ...existing, messages: [...existing.messages, userMessage], plan: undefined, updatedAt: now }
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
      ...IDLE_STREAM_VIEW,
      streamingSessionId: session.id,
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

    // Tokens land here first and reach the store in batches (see
    // STREAM_FLUSH_MS). Plain locals rather than store fields: what is on
    // screen and what has arrived since the last repaint are two different
    // things, and only the first belongs in a re-rendering state.
    let pendingText = "";
    let pendingThinking = "";
    let flushTimer: ReturnType<typeof setTimeout> | null = null;

    const flushStream = () => {
      if (flushTimer) {
        clearTimeout(flushTimer);
        flushTimer = null;
      }

      if (!pendingText && !pendingThinking) {
        return;
      }

      const text = pendingText;
      const thinking = pendingThinking;
      pendingText = "";
      pendingThinking = "";

      set((state) => ({
        streamingText: state.streamingText + text,
        streamingThinking: state.streamingThinking + thinking,
        // The answer starting to arrive is what ends the activity line: from
        // here on the text itself says what is happening.
        ...(text ? { streamingActivity: null } : {})
      }));
    };

    const scheduleFlush = () => {
      if (!flushTimer) {
        flushTimer = setTimeout(flushStream, STREAM_FLUSH_MS);
      }
    };

    // Between two steps the live view has to go: the text just streamed is
    // about to be appended as a message, and leaving it would show it twice —
    // once as the finished bubble and once as the tail of a stream that ended.
    const clearStreamView = () => {
      if (flushTimer) {
        clearTimeout(flushTimer);
      }

      flushTimer = null;
      pendingText = "";
      pendingThinking = "";
      set({ streamingText: "", streamingThinking: "" });
    };

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

    // Records on an assistant message, after the fact, what became of its text:
    // the "apply to document" button, or the note that it was proposed into the
    // document. Addressed by position rather than "the last message": the
    // follow-up question runs with the turn already finished, so the user may
    // have sent the next one meanwhile.
    const markReplyOutcome = (index: number, outcome: { suggestsEdit: true } | { proposedEdit: true }) => {
      set((state) => ({
        sessions: state.sessions.map((entry) =>
          entry.id === session.id
            ? {
                ...entry,
                messages: entry.messages.map((message, at) =>
                  at === index && message.role === "assistant" ? { ...message, ...outcome } : message
                )
              }
            : entry
        )
      }));
    };

    // The turn's task list, kept on the session: the chat renders it live, and
    // it survives a reload the way the transcript does.
    const setPlan = (plan: PlanStep[] | undefined) => {
      set((state) => ({
        sessions: state.sessions.map((entry) =>
          entry.id === session.id ? { ...entry, plan, updatedAt: Date.now() } : entry
        )
      }));
    };

    const readPlan = (): PlanStep[] =>
      get().sessions.find((entry) => entry.id === session.id)?.plan ?? [];

    // The agent's capabilities for this turn. Read once, unlike the knowledge
    // base toggle: these are settings in a dialog, not something the user flips
    // while an answer is coming in.
    const fileAccessEnabled = aiSettings.agentFileAccess;
    // The same switches, enforced a second time where the tools run: a tool
    // name resolved through an alias must not slip past the consent gate that
    // "the model was never offered this tool" normally provides.
    setAgentCapabilities({ fileAccess: fileAccessEnabled, allowDelete: aiSettings.agentAllowDelete });
    const planToolsEnabled = aiSettings.agentPlanning === "model";
    const maxIterations = aiSettings.agentMaxIterations;
    const maxPlanSteps = aiSettings.agentMaxPlanSteps;
    const modelKey = visionKey(aiSettings);

    // A proposal for the OPEN document is a widget in the editor, not a staged
    // entry — this registers the marker that makes the paw in the tree and the
    // chat's pending-changes card aware of it (see markEditorProposal).
    const markOpenDocumentProposal = (messageIndex: number) => {
      const { folderPath, selectedFilePath } = useAppStore.getState();

      if (folderPath && selectedFilePath) {
        useStagedChangesStore
          .getState()
          .markEditorProposal(
            normalizeVaultPath(getRelativeDisplayPath(folderPath, selectedFilePath)),
            session.id,
            messageIndex
          );
      }
    };

    try {
      // Whether this turn has already given the user something to accept —
      // either in the editor or as a staged file change. If it has, the reply
      // needs no "apply" button: the review widget (or the paw) is the
      // affordance.
      let turnProposedEdit = false;
      // Set when the turn ended on a plain text reply that the model did not
      // flag: the one case where it never got the chance to (see
      // detectPendingSuggestion). Resolved once the turn is otherwise finished.
      // A holder rather than a plain `let`: it is assigned inside runToolLoop,
      // and TypeScript does not track assignments across a closure boundary —
      // read back directly it would narrow to `null` at every use site.
      const unflaggedReply: { value: { index: number; text: string } | null } = { value: null };
      // Notes the knowledge base tools surfaced during this turn, deduplicated.
      // Collected across all steps: the model typically searches in one step
      // and reads in the next, and both are sources of the eventual answer.
      const turnSources: VaultSourceRef[] = [];
      // Whether this model has been found to reject requests carrying an image.
      // Starts true when an earlier turn already ran into it, and is set the
      // moment a step only came back after its images were dropped.
      let noVision = noVisionModels.has(modelKey);
      // Said after the turn rather than in the middle of it: an assistant
      // bubble about a setting, appended between two working steps, is a turn
      // the model then has to read back as part of its own history.
      let planDisabledNotice = false;

      /**
       * The plan tools of the "model" mode. Handled here rather than in
       * executeTool because the list lives on the session: the model writes it,
       * the store owns it — which is also where agentMaxPlanSteps is enforced,
       * with the tool result saying so instead of silently swallowing steps.
       */
      const executePlanTool = (name: string, args: Record<string, unknown>): ToolResult => {
        if (name === "create_plan" || name === "update_plan") {
          const proposed = parsePlanToolSteps(args, maxPlanSteps);

          if (proposed.length === 0) {
            return {
              content: "Error: no usable steps given. Pass steps as [{title, instruction}, …]."
            };
          }

          // update_plan replaces only what is outstanding; anything already
          // settled stays exactly as it is.
          const settled =
            name === "update_plan" ? readPlan().filter((entry) => entry.status !== "pending") : [];
          const room = Math.max(1, maxPlanSteps - settled.length);
          const capped = proposed.slice(0, room);
          const next = [...settled.map((entry) => ({ ...entry })), ...capped];

          // The first outstanding step is the one being worked on from here.
          const running = next.findIndex((entry) => entry.status === "pending");

          if (running !== -1) {
            next[running] = { ...next[running], status: "running" };
          }

          setPlan(next);

          const cut =
            capped.length < proposed.length ? ` (cut to the limit of ${maxPlanSteps} steps in total)` : "";

          return {
            content:
              `OK: ${capped.length} step(s) recorded${cut}. The plan is not the work — start the first ` +
              "outstanding step now."
          };
        }

        const plan = readPlan();
        const index = plan.findIndex((entry) => entry.status === "running" || entry.status === "pending");

        if (index === -1) {
          return {
            content: "Error: no step is open. Call create_plan first if this request needs several steps."
          };
        }

        const result = typeof args.result === "string" ? args.result.trim() : "";
        const next = plan.map((entry, at) =>
          at === index
            ? { ...entry, status: "done" as const, ...(result ? { result } : {}) }
            : { ...entry }
        );
        const following = next.findIndex((entry) => entry.status === "pending");

        if (following !== -1) {
          next[following] = { ...next[following], status: "running" };
        }

        setPlan(next);

        return {
          content:
            following === -1
              ? `OK: step ${index + 1} closed. That was the last one — tell the user what you did.`
              : `OK: step ${index + 1} closed. ${
                  next.filter((entry) => entry.status === "pending").length + 1
                } step(s) left; start the next one now.`
        };
      };

      /**
       * One run of the tool loop: the model works until it answers without
       * calling a tool, or until the iteration cap stops it.
       *
       * `historyFrom` is where the request's history starts. 0 means the whole
       * conversation (the v2 behaviour, and what agentCompactContext: false
       * keeps). For a plan step with compact context it is that step's own
       * instruction message — which already carries the goal, the plan and one
       * sentence per finished step, so the window stays constant over ten steps
       * instead of growing with each one.
       *
       * Answers with the step's closing text, which becomes the plan step's
       * one-line result.
       */
      const runToolLoop = async (historyFrom: number): Promise<string> => {
        let iterations = 0;
        let finalText = "";

        while (iterations < maxIterations) {
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

          const history = historyFrom > 0 ? current.messages.slice(historyFrom) : current.messages;

          const modelMessages = withPendingProposalNote(
            selectMessagesForModel(
              // Expanded before trimming: the selection and attachment notes
              // become part of the content and are charged against the budget
              // along with it. Re-read per iteration like the history itself, so
              // a file detached mid-turn is gone from the next step's request
              // (see currentAttachedFiles for the one case that does not hold).
              inlineAttachedFiles(
                inlineSelectionContext(history),
                currentAttachedFiles(),
                aiSettings.contextLength
              ),
              systemEstimate,
              aiSettings.contextLength
            )
          );

          // A fresh step is the model thinking again, whatever tool the last one
          // ran — the panel falls back to its idle wording until a call names
          // something more specific.
          set({ streamingActivity: null });

          const step = await streamAiChatStep(
            aiSettings,
            // The history only stores image paths; the payloads are read from
            // disk here, for this request only (see attachImageData).
            {
              // A model already known to have no vision gets the note in place of
              // the image right away — reading and encoding a payload it would
              // only reject again is wasted work on both sides.
              messages: noVision ? stripChatImages(modelMessages) : await attachImageData(modelMessages),
              assistantInstruction: assistant.instruction,
              // Re-read per step rather than captured before the loop: the user
              // can switch the knowledge base off mid-turn, and the next step
              // must not still be offered tools that read their notes (again
              // with the caveat in currentUseKnowledgeBase).
              vaultSearchEnabled: isKnowledgeBaseReady() && currentUseKnowledgeBase(),
              // Re-read per step like the knowledge base toggle: the user can
              // open or close a note while the turn is running, and the rules
              // about the passage tools have to describe the editor as it is
              // for THIS step (see NO_DOCUMENT_INSTRUCTION).
              documentOpen: Boolean(useAppStore.getState().selectedFilePath),
              fileAccessEnabled,
              deleteEnabled: aiSettings.agentAllowDelete,
              multiEditEnabled: aiSettings.agentMultiEdit,
              planToolsEnabled
            },
            {
              onText: (chunk) => {
                pendingText += chunk;
                scheduleFlush();
              },
              onThinking: (chunk) => {
                pendingThinking += chunk;
                scheduleFlush();
              },
              // Announced while the model is still writing the call's arguments,
              // which is the part of a tool step that takes the longest.
              onToolCall: (name) => {
                flushStream();
                set({ streamingActivity: name });
              }
            },
            abortController.signal
          );

          // Everything below appends the step's own text as a message; the live
          // copy has to be gone before it does.
          clearStreamView();

          // The step got through without its images: from here on the model is
          // told it has no vision rather than being handed one again.
          if (step.imagesDropped) {
            noVision = true;
            noVisionModels.add(modelKey);
          }

          if (step.toolCalls.length === 0) {
            const index = appendMessage({
              role: "assistant",
              content: step.text,
              // The notes this turn actually looked at, listed under the answer.
              ...(turnSources.length > 0 ? { sources: turnSources } : {})
            });

            if (!turnProposedEdit && step.text.trim()) {
              unflaggedReply.value = { index, text: step.text };
            }

            return step.text;
          }

          const assistantIndex = appendMessage({
            role: "assistant",
            content: step.text,
            toolCalls: step.toolCalls,
            // The model's own call is the signal; the button appears on the very
            // message whose text it flagged. Redundant next to a proposal it made
            // in the same turn, which rule 9 tells it not to do — but a model that
            // does both anyway must not produce two ways to apply one change.
            ...(step.toolCalls.some((call) => call.name === FLAG_SUGGESTION_TOOL_NAME) &&
            !turnProposedEdit &&
            !step.toolCalls.some(
              (call) =>
                EDITING_TOOL_NAMES.includes(call.name) || STAGING_TOOL_NAMES.includes(call.name)
            )
              ? { suggestsEdit: true }
              : {})
          });

          if (step.text.trim()) {
            finalText = step.text;
          }

          if (
            step.toolCalls.some(
              (call) =>
                EDITING_TOOL_NAMES.includes(call.name) || STAGING_TOOL_NAMES.includes(call.name)
            )
          ) {
            turnProposedEdit = true;
          }

          // Staged entries record which message proposed them, so the undo
          // button ends up on the turn that did the work.
          setAgentTurnContext(session.id, assistantIndex);

          const imagePaths: string[] = [];

          for (const call of step.toolCalls) {
            // Several calls in one step run one after the other, so the line
            // follows along rather than staying on the first of them.
            set({ streamingActivity: call.name });

            const result = PLAN_TOOL_NAMES.includes(call.name)
              ? executePlanTool(call.name, call.arguments)
              : await executeTool(call.name, call.arguments);
            // get_image resolved a picture the model cannot be shown: it is told
            // so where it asked, instead of being promised an image that the next
            // request would only be rejected for. The panel renders this as the
            // failed-tool line, which is what actually happened.
            const missingVision = Boolean(result.imagePath) && noVision;

            appendMessage({
              role: "tool",
              toolCallId: call.id,
              toolName: call.name,
              content: missingVision ? IMAGE_UNSUPPORTED_TOOL_RESULT : result.content,
              // A missing vision model is not something the model can retry its
              // way out of, whatever the tool itself reported.
              ...(result.retryable && !missingVision ? { retryable: true } : {})
            });

            // A proposal that was actually opened, not one the editor refused.
            if (EDITING_TOOL_NAMES.includes(call.name) && !result.content.startsWith("Error:")) {
              markOpenDocumentProposal(assistantIndex);
            }

            if (result.imagePath && !missingVision && !imagePaths.includes(result.imagePath)) {
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

          if (iterations >= maxIterations) {
            appendMessage({ role: "assistant", content: i18n.t("chat.agentStopped") });
          }
        }

        return finalText;
      };

      // --- Planning ---------------------------------------------------------
      //
      // Only in "auto" mode, and never for an action turn: those carry a
      // generated instruction about one answer, which is a single piece of work
      // by construction.
      let plan: PlanStep[] | null = null;

      if (aiSettings.agentPlanning === "auto" && !action && !noPlanModels.has(modelKey)) {
        set({ streamingActivity: PLANNING_ACTIVITY });

        const outcome = await planTask(
          aiSettings,
          content,
          { maxSteps: maxPlanSteps, fileAccess: fileAccessEnabled },
          abortController.signal
        );

        if (outcome.kind === "steps") {
          plan = outcome.steps;
          planFailureCounts.delete(modelKey);
        } else if (outcome.kind === "unusable") {
          // Same shape as the vision fallback: a model that cannot produce a
          // plan twice will not start being able to, and every further
          // multi-step request would pay for a call whose answer is thrown away.
          const failures = (planFailureCounts.get(modelKey) ?? 0) + 1;
          planFailureCounts.set(modelKey, failures);

          if (failures >= 2 && !noPlanModels.has(modelKey)) {
            noPlanModels.add(modelKey);
            planDisabledNotice = !planNoticeShown.has(modelKey);
            planNoticeShown.add(modelKey);
          }
        } else {
          planFailureCounts.delete(modelKey);
        }
      }

      if (plan && plan.length > 0) {
        setPlan(plan);

        for (let index = 0; index < readPlan().length; index += 1) {
          if (abortController.signal.aborted) {
            break;
          }

          setPlan(
            readPlan().map((entry, at) => (at === index ? { ...entry, status: "running" } : entry))
          );

          // The step's instruction goes into the history as a hidden user turn:
          // it is model-facing text nobody wrote, so the transcript renders
          // nothing for it (see the "planStep" action) — the step list above the
          // answer is what shows the user where the agent is.
          const stepStart = appendMessage({
            role: "user",
            action: "planStep",
            content: stepContext(content, readPlan(), index)
          });

          const finalText = await runToolLoop(aiSettings.agentCompactContext ? stepStart : 0);
          const result = finalText.trim().replace(/\s+/g, " ").slice(0, STEP_RESULT_CHARS);

          setPlan(
            readPlan().map((entry, at) =>
              at === index
                ? { ...entry, status: "done" as const, ...(result ? { result } : {}) }
                : entry
            )
          );

          if (abortController.signal.aborted) {
            break;
          }

          // The between-steps check: with what is known now, do the remaining
          // steps still fit? Skipped after the last one, where there is nothing
          // left to revise.
          if (readPlan().some((entry) => entry.status === "pending")) {
            const review = await reviewPlan(
              aiSettings,
              content,
              readPlan(),
              maxPlanSteps,
              abortController.signal
            );

            if (!review.keep) {
              const settled = readPlan().filter((entry) => entry.status !== "pending");

              setPlan([...settled, ...review.steps].slice(0, maxPlanSteps));
              appendMessage({ role: "assistant", content: i18n.t("chat.planAdjusted") });
            }
          }
        }
      } else {
        await runToolLoop(0);
      }

      if (planDisabledNotice) {
        appendMessage({ role: "assistant", content: i18n.t("chat.planUnavailable") });
      }

      set({ isStreaming: false, ...IDLE_STREAM_VIEW, error: null });

      // Deliberately after the turn is marked finished: this asks the model one
      // more question, and the reply it judges is already on screen. Leaving the
      // turn "running" for it would hold the composer for a request the user is
      // not waiting for — the button simply appears a moment later.
      // …and only while a note is open: with none, the extra request could only
      // ever end in a button that has no document to write into.
      if (
        unflaggedReply.value &&
        !abortController.signal.aborted &&
        useAppStore.getState().selectedFilePath
      ) {
        const pending = unflaggedReply.value;
        const verdict = await resolveUnflaggedReply(
          aiSettings,
          content,
          pending.text,
          abortController.signal
        );

        // Text the user asked to have written goes into the document, not onto
        // a button that asks them to ask again. The proposal can still be
        // refused — an unsettled review from an earlier turn blocks it — and
        // then the button is the fallback, which is what it always was.
        if (verdict.kind === "insert" && proposeComposedText(verdict.text)) {
          markReplyOutcome(pending.index, { proposedEdit: true });
        } else if (verdict.kind !== "none") {
          markReplyOutcome(pending.index, { suggestsEdit: true });
        }
      }
    } catch (error) {
      if (abortController.signal.aborted) {
        // What the user could already read stays in the chat. Without
        // streaming there was nothing on screen to keep, but an answer that
        // visibly wrote three paragraphs and then vanished on "stop" looks
        // like the button discarded it rather than ended it.
        flushStream();

        const partialAnswer = get().streamingText.trim();

        if (partialAnswer) {
          appendMessage({ role: "assistant", content: partialAnswer });
        }

        // Tool edits already applied are single undo steps and stay in the
        // document — only the loop itself needs to stop here.
        set({ isStreaming: false, ...IDLE_STREAM_VIEW, error: null });
      } else {
        set({
          isStreaming: false,
          ...IDLE_STREAM_VIEW,
          // Shown in the panel, which may well be sitting on a different chat by
          // now — but an error the user never sees is worse than one that
          // arrives in the wrong place, and openSession clears it on the next
          // navigation.
          error: formatAiError(error, i18n.t)
        });
      }
    } finally {
      // A pending flush firing after the turn has ended would write tokens back
      // into the view that was just cleared — and an aborted turn always has
      // one in flight.
      if (flushTimer) {
        clearTimeout(flushTimer);
        flushTimer = null;
      }

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
