import { useEffect, useMemo, useRef, useState } from "react";
import {
  AlertTriangle,
  ArrowLeft,
  Brain,
  Check,
  Eye,
  FileText,
  Image as ImageIcon,
  Library,
  Loader2,
  Mic,
  Paperclip,
  PencilLine,
  Search,
  SendHorizontal,
  Square,
  TextCursorInput,
  TextQuote,
  X
} from "lucide-react";
import { useTranslation } from "react-i18next";
import { join } from "@tauri-apps/api/path";

import { Button } from "@/components/ui/button";
import { Toggle } from "@/components/ui/toggle";
import { VoiceModelDownloadDialog } from "@/components/VoiceModelDownloadDialog";
import { VoiceRecordingBanner } from "@/components/VoiceRecordingBanner";
import { useVoiceInput } from "@/hooks/useVoiceInput";
import i18n from "@/i18n";
import { FLAG_SUGGESTION_TOOL_NAME, type AiChatMessage, type VaultSourceRef } from "@/lib/aiClient";
import {
  fileNameFromPath,
  MAX_ATTACHED_FILES,
  readDroppedFile,
  readVaultAttachment,
  type AttachedChatFile
} from "@/lib/chat/attachedFiles";
import { renderChatMarkdown } from "@/lib/chat/renderMarkdown";
import { FILE_LINK_DRAG_MIME, getDraggedVaultFilePaths } from "@/lib/editor/fileLinks";
import { isKnowledgeBaseReady } from "@/lib/ragSearch";
import { formatBinding } from "@/lib/shortcuts/binding";
import { useAiSettingsStore } from "@/store/useAiSettingsStore";
import { assistantDisplayName, useAssistantsStore } from "@/store/useAssistantsStore";
import { getActiveSession, useChatStore } from "@/store/useChatStore";
import { useAppStore } from "@/store/useAppStore";
import { useRagSettingsStore } from "@/store/useRagSettingsStore";

const OPEN_ASSISTANT_SETTINGS_VALUE = "__open-assistant-settings__";

// Matches the hardcoded Ctrl+Shift+W handler below — shown in the mic
// button's tooltip so the shortcut stays discoverable.
const DICTATION_BINDING = { ctrl: true, alt: false, shift: true, code: "KeyW", key: "w", label: "W" };

// How many past sessions the empty chat lists inline; the rest stay reachable
// through the full overview.
const RECENT_SESSION_LIMIT = 5;

// Localized label per agent tool, keyed by the tool's wire name (see
// AGENT_TOOL_SPECS in src/lib/aiClient.ts) — the tool result's own content
// string is model-facing English and not shown to the user directly.
const TOOL_LABEL_KEYS: Record<string, string> = {
  get_document: "chat.toolReadDocument",
  get_selection: "chat.toolReadSelection",
  get_image: "chat.toolReadImage",
  set_image_width: "chat.toolResizedImage",
  replace_selection: "chat.toolProposedSelection",
  insert_at_cursor: "chat.toolProposedInsert",
  replace_passage: "chat.toolProposedPassage",
  accept_proposals: "chat.toolAcceptedProposals",
  discard_proposals: "chat.toolDiscardedProposals",
  search_vault: "chat.toolSearchedVault",
  read_note: "chat.toolReadNote"
};

// Distinct wording for the failure case of each tool — reusing the success
// label with just a red color left it unclear *what* had gone wrong (see
// executeTool in src/lib/chat/agentTools.ts for when each of these fires).
// get_document/get_selection have no failure label: they never return an
// "Error:"-prefixed result.
const TOOL_ERROR_LABEL_KEYS: Record<string, string> = {
  get_image: "chat.toolReadImageFailed",
  set_image_width: "chat.toolResizeImageFailed",
  replace_selection: "chat.toolProposeSelectionFailed",
  insert_at_cursor: "chat.toolProposeInsertFailed",
  replace_passage: "chat.toolProposePassageFailed",
  accept_proposals: "chat.toolSettleProposalsFailed",
  discard_proposals: "chat.toolSettleProposalsFailed",
  read_note: "chat.toolReadNoteFailed"
};

function toolIcon(toolName: string, isError: boolean) {
  if (isError) {
    return AlertTriangle;
  }

  if (toolName === "get_image" || toolName === "set_image_width") {
    return ImageIcon;
  }

  if (toolName === "search_vault") {
    return Search;
  }

  if (toolName === "read_note") {
    return FileText;
  }

  if (toolName === "get_document" || toolName === "get_selection") {
    return Eye;
  }

  if (toolName === "insert_at_cursor") {
    return TextCursorInput;
  }

  if (toolName === "accept_proposals") {
    return Check;
  }

  if (toolName === "discard_proposals") {
    return X;
  }

  return PencilLine;
}

function ToolStatusLine({ toolName, isError }: { toolName: string; isError: boolean }) {
  const { t } = useTranslation();
  const Icon = toolIcon(toolName, isError);
  const labelKey = isError
    ? (TOOL_ERROR_LABEL_KEYS[toolName] ?? "chat.toolActionFailed")
    : TOOL_LABEL_KEYS[toolName];
  const label = labelKey ? t(labelKey) : toolName;

  return (
    <div className={`chat-tool-status${isError ? " chat-tool-status--error" : ""}`}>
      <Icon className="size-3.5" />
      <span>{label}</span>
    </div>
  );
}

type AssistantChatMessage = Extract<AiChatMessage, { role: "assistant" }>;

/**
 * The notes an answer was assembled from, listed under it and clickable.
 *
 * This is the counterpart to letting the agent read files the user never
 * opened: an answer drawn from them is only worth something if the user can go
 * and check where it came from. The heading trail is shown alongside the file
 * so the link points at a passage rather than at a whole note.
 */
function AnswerSources({ sources }: { sources: VaultSourceRef[] }) {
  const { t } = useTranslation();
  const folderPath = useAppStore((state) => state.folderPath);
  const selectFilePath = useAppStore((state) => state.selectFilePath);

  if (sources.length === 0) {
    return null;
  }

  const openSource = async (path: string) => {
    if (!folderPath) {
      return;
    }

    await selectFilePath(await join(folderPath, path));
  };

  return (
    <div className="chat-message__sources">
      <span className="chat-message__sources-label">{t("chat.sourcesLabel")}</span>
      <ul>
        {sources.map((source) => (
          <li key={`${source.path}#${source.headingPath}`}>
            <button type="button" onClick={() => void openSource(source.path)} title={source.path}>
              {source.path}
              {source.headingPath ? (
                <span className="chat-message__sources-section"> › {source.headingPath}</span>
              ) : null}
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

function AssistantMessage({
  message,
  canApplyToDocument,
  onApplyToDocument
}: {
  message: AssistantChatMessage;
  canApplyToDocument: boolean;
  onApplyToDocument: (markdown: string) => void;
}) {
  const { t } = useTranslation();

  // A turn that only carries tool calls has nothing to show: each call already
  // gets one status line from its tool-result message below, which is the only
  // one of the two that knows whether the call succeeded. Rendering the calls
  // here as well is what showed every action twice.
  if (!message.content) {
    return null;
  }

  return (
    <div className="chat-message chat-message--assistant">
      <div
        className="chat-message__bubble chat-message__bubble--markdown"
        dangerouslySetInnerHTML={{ __html: renderChatMarkdown(message.content) }}
      />

      {/* Not a raw paste of the answer at the caret: this asks the agent to
          work the suggestion into the existing text, which lands as reviewable
          red/green proposals in the document. */}
      {canApplyToDocument ? (
        <button
          type="button"
          className="chat-message__insert"
          title={t("chat.applyToDocumentTitle")}
          onClick={() => onApplyToDocument(message.content)}
        >
          <PencilLine className="size-3.5" />
          {t("chat.applyToDocument")}
        </button>
      ) : null}

      <AnswerSources sources={message.sources ?? []} />
    </div>
  );
}

// How much of the selected passage the composer chip and the transcript quote
// show; the full text is always available as the element's tooltip.
const SELECTION_PREVIEW_CHARS = 140;

function selectionPreview(selection: string): string {
  const collapsed = selection.replace(/\s+/g, " ").trim();

  return collapsed.length > SELECTION_PREVIEW_CHARS
    ? `${collapsed.slice(0, SELECTION_PREVIEW_CHARS - 1).trimEnd()}…`
    : collapsed;
}

function formatRelativeTime(timestamp: number): string {
  const formatter = new Intl.RelativeTimeFormat(i18n.language, { numeric: "auto" });
  const seconds = Math.round((timestamp - Date.now()) / 1000);
  const distance = Math.abs(seconds);

  if (distance < 60) {
    return formatter.format(seconds, "second");
  }
  if (distance < 3600) {
    return formatter.format(Math.round(seconds / 60), "minute");
  }
  if (distance < 86400) {
    return formatter.format(Math.round(seconds / 3600), "hour");
  }
  if (distance < 2592000) {
    return formatter.format(Math.round(seconds / 86400), "day");
  }
  if (distance < 31536000) {
    return formatter.format(Math.round(seconds / 2592000), "month");
  }

  return formatter.format(Math.round(seconds / 31536000), "year");
}

// The history strip a fresh chat opens onto (VS Code style): it occupies the
// otherwise empty message area and is replaced by the conversation as soon as
// the user starts typing.
function RecentSessions() {
  const { t } = useTranslation();
  const sessions = useChatStore((state) => state.sessions);
  const openSession = useChatStore((state) => state.openSession);
  const showOverview = useChatStore((state) => state.showOverview);

  return (
    <div className="chat-recent">
      <div className="chat-recent__header">
        <span className="chat-recent__label">{t("chat.recentTitle")}</span>
        {sessions.length > RECENT_SESSION_LIMIT ? (
          <button type="button" className="chat-recent__more" onClick={showOverview}>
            {t("chat.showAllSessions")}
          </button>
        ) : null}
      </div>

      <ul className="chat-recent__list">
        {sessions.slice(0, RECENT_SESSION_LIMIT).map((session) => (
          <li key={session.id}>
            <button
              type="button"
              className="chat-recent__item"
              onClick={() => openSession(session.id)}
            >
              <span className="chat-recent__title">
                {session.title || t("chat.untitledSession")}
              </span>
              <span className="chat-recent__meta">{formatRelativeTime(session.updatedAt)}</span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

/**
 * Whether a drag is one this panel takes: notes dragged out of the file tree
 * (the sidebar writes FILE_LINK_DRAG_MIME) or files dragged in from the OS.
 *
 * Decided from `types` rather than from the data itself, which the browser only
 * hands out on drop — during a drag all a handler may know is what kinds of
 * payload are on offer.
 */
function carriesAttachableFiles(dataTransfer: DataTransfer | null): boolean {
  return Array.from(dataTransfer?.types ?? []).some(
    (type) => type === "Files" || type === FILE_LINK_DRAG_MIME
  );
}

type ChatPanelProps = {
  canEditDocument: boolean;
  onAssistantSettingsRequest: () => void;
};

function AssistantSelect({
  onAssistantSettingsRequest
}: {
  onAssistantSettingsRequest: () => void;
}) {
  const { t } = useTranslation();
  const assistants = useAssistantsStore((state) => state.assistants);
  const selectedAssistantId = useAssistantsStore((state) => state.selectedAssistantId);
  const selectAssistant = useAssistantsStore((state) => state.selectAssistant);

  return (
    <select
      className="chat-panel__assistant-select"
      aria-label={t("chat.assistant")}
      title={t("chat.assistant")}
      value={selectedAssistantId}
      onChange={(event) => {
        const value = event.target.value;
        if (value === OPEN_ASSISTANT_SETTINGS_VALUE) {
          onAssistantSettingsRequest();
          return;
        }
        selectAssistant(value);
      }}
    >
      <optgroup label={t("chat.assistantsGroup")}>
        {assistants.map((assistant) => (
          <option key={assistant.id} value={assistant.id}>
            {assistantDisplayName(assistant, t("assistants.defaultName"))}
          </option>
        ))}
      </optgroup>
      <option value={OPEN_ASSISTANT_SETTINGS_VALUE}>{t("chat.manageAssistants")}</option>
    </select>
  );
}

export function ChatPanel({ canEditDocument, onAssistantSettingsRequest }: ChatPanelProps) {
  const { t } = useTranslation();
  const [draft, setDraft] = useState("");
  const [voiceError, setVoiceError] = useState<string | null>(null);
  // Highlights the panel while a droppable drag is over it, and reports the
  // files a drop could not take on.
  const [isDropTarget, setIsDropTarget] = useState(false);
  const [attachError, setAttachError] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLTextAreaElement | null>(null);
  const panelRef = useRef<HTMLElement | null>(null);
  // Where the caret has to land once the transcript has been spliced into the
  // draft — applied after the textarea re-rendered with the new text.
  const pendingCaretRef = useRef<number | null>(null);

  // Ctrl+Shift+W dictates into this composer exactly the way it dictates into
  // the document — the focused area decides where the transcript lands. The
  // text is spliced in at the caret rather than appended, so it works the same
  // as in the editor.
  const voice = useVoiceInput({
    onTranscript: (text) => {
      const field = inputRef.current;

      setDraft((previous) => {
        const start = field?.selectionStart ?? previous.length;
        const end = field?.selectionEnd ?? start;
        const before = previous.slice(0, start);
        const after = previous.slice(end);
        // Keep the dictated sentence from running into the word before it.
        const separator = before && !/\s$/.test(before) ? " " : "";

        pendingCaretRef.current = before.length + separator.length + text.length;

        return `${before}${separator}${text}${after}`;
      });
    },
    onError: (message) => setVoiceError(t("voice.error", { error: message }))
  });
  const voiceRef = useRef(voice);
  voiceRef.current = voice;
  const isRecording = voice.status === "recording";
  const isTranscribing = voice.status === "transcribing";

  const activeSession = useChatStore(getActiveSession);
  const isStreaming = useChatStore((state) => state.isStreaming);
  const streamingText = useChatStore((state) => state.streamingText);
  const streamingThinking = useChatStore((state) => state.streamingThinking);
  const error = useChatStore((state) => state.error);
  const loadedFolderPath = useChatStore((state) => state.loadedFolderPath);
  const editorSelection = useChatStore((state) => state.editorSelection);
  const setEditorSelection = useChatStore((state) => state.setEditorSelection);
  const showOverview = useChatStore((state) => state.showOverview);
  const closePanel = useChatStore((state) => state.closePanel);
  const sendMessage = useChatStore((state) => state.sendMessage);
  const cancel = useChatStore((state) => state.cancel);

  const settings = useAiSettingsStore((state) => state.settings);
  const updateSettings = useAiSettingsStore((state) => state.updateSettings);
  const thinkingEnabled = settings.thinkingMode !== "off";

  const useKnowledgeBase = useChatStore((state) => state.useKnowledgeBase);
  const setUseKnowledgeBase = useChatStore((state) => state.setUseKnowledgeBase);
  const attachedFiles = useChatStore((state) => state.attachedFiles);
  const attachFiles = useChatStore((state) => state.attachFiles);
  const removeAttachedFile = useChatStore((state) => state.removeAttachedFile);
  const vaultFolderPath = useAppStore((state) => state.folderPath);
  const vaultFilePaths = useAppStore((state) => state.filePaths);
  const ragConfig = useRagSettingsStore((state) => state.config);

  // isKnowledgeBaseReady() reads exactly these three straight from the stores;
  // they are listed as dependencies so the toggle follows them. The toggle only
  // exists once the knowledge base *could* answer something — offering it while
  // the feature is off in settings would promise a lookup that cannot happen.
  const knowledgeBaseReady = useMemo(
    () => isKnowledgeBaseReady(),
    [vaultFolderPath, vaultFilePaths, ragConfig]
  );

  const messages = activeSession?.messages ?? [];
  const isEmptyChat = messages.length === 0 && !isStreaming;
  const hasSessions = useChatStore((state) => state.sessions.length > 0);

  // Follow the conversation as it grows and as tokens stream in.
  useEffect(() => {
    const node = scrollRef.current;
    if (node) {
      node.scrollTop = node.scrollHeight;
    }
  }, [messages.length, streamingText, streamingThinking]);

  // Opening the panel, starting a new chat and switching sessions all mount
  // this component fresh — so typing can begin right away without a click.
  useEffect(() => {
    inputRef.current?.focus();
  }, [activeSession?.id]);

  // Put the caret behind the freshly inserted transcript so dictating twice in
  // a row appends instead of overwriting.
  useEffect(() => {
    const caret = pendingCaretRef.current;

    if (caret === null) {
      return;
    }

    pendingCaretRef.current = null;

    const field = inputRef.current;
    field?.focus();
    field?.setSelectionRange(caret, caret);
  }, [draft]);

  // Ctrl+Shift+W toggles dictation whenever the focus sits inside this panel;
  // with the focus in the document, the editor's own handler takes the same
  // shortcut. While recording, Enter stops (and inserts) and Esc discards —
  // those two also work with the focus elsewhere, so a running recording can
  // always be ended.
  useEffect(() => {
    const handleDictationKeys = (event: KeyboardEvent) => {
      if (voiceRef.current.status === "recording") {
        if (event.key === "Enter" && !event.ctrlKey && !event.metaKey && !event.shiftKey) {
          event.preventDefault();
          void voiceRef.current.stop();
          return;
        }

        if (event.key === "Escape") {
          event.preventDefault();
          voiceRef.current.cancel();
          return;
        }
      }

      if (!(event.ctrlKey || event.metaKey) || !event.shiftKey || event.altKey) {
        return;
      }

      // event.code covers layouts where Shift+W composes a different key.
      if (event.key.toLowerCase() !== "w" && event.code !== "KeyW") {
        return;
      }

      if (!panelRef.current?.contains(document.activeElement)) {
        return;
      }

      event.preventDefault();
      setVoiceError(null);
      voiceRef.current.toggle();
    };

    window.addEventListener("keydown", handleDictationKeys);

    return () => window.removeEventListener("keydown", handleDictationKeys);
  }, []);

  // Reads everything a drop offered and hands it to the store. Files that
  // cannot serve as context at all (a binary, an unreadable file) are named
  // back to the user rather than silently dropped — a dragged file that simply
  // vanishes looks like the whole feature did not work.
  const takeDroppedFiles = async (vaultPaths: string[], droppedFiles: File[]) => {
    const attachments: AttachedChatFile[] = [];
    const rejected: string[] = [];

    for (const path of vaultPaths) {
      const attachment = await readVaultAttachment(vaultFolderPath, path);

      if (attachment) {
        attachments.push(attachment);
      } else {
        rejected.push(fileNameFromPath(path));
      }
    }

    for (const file of droppedFiles) {
      const attachment = await readDroppedFile(file);

      if (attachment) {
        attachments.push(attachment);
      } else {
        rejected.push(file.name);
      }
    }

    const added = attachFiles(attachments);

    if (rejected.length > 0) {
      setAttachError(t("chat.attachmentRejected", { files: rejected.join(", ") }));
      return;
    }

    // Fewer taken on than offered also happens for a file that is already
    // attached, which needs no warning — only a full list does.
    setAttachError(
      added < attachments.length && useChatStore.getState().attachedFiles.length >= MAX_ATTACHED_FILES
        ? t("chat.attachmentLimit", { max: MAX_ATTACHED_FILES })
        : null
    );
  };

  const handleDragOver = (event: React.DragEvent<HTMLElement>) => {
    if (!carriesAttachableFiles(event.dataTransfer)) {
      return;
    }

    // Without this the webview handles the drop itself and navigates away from
    // the app to the dropped file.
    event.preventDefault();
    event.dataTransfer.dropEffect = "copy";
    setIsDropTarget(true);
  };

  const handleDragLeave = (event: React.DragEvent<HTMLElement>) => {
    // Crossing from one child of the panel into the next fires dragleave on the
    // one being left; only a pointer that really left the panel ends the state.
    if (event.relatedTarget instanceof Node && event.currentTarget.contains(event.relatedTarget)) {
      return;
    }

    setIsDropTarget(false);
  };

  const handleDrop = (event: React.DragEvent<HTMLElement>) => {
    if (!carriesAttachableFiles(event.dataTransfer)) {
      return;
    }

    event.preventDefault();
    setIsDropTarget(false);

    // The data transfer is emptied as soon as this handler returns, so both
    // lists are taken out of it here and only read afterwards.
    void takeDroppedFiles(getDraggedVaultFilePaths(event.dataTransfer), Array.from(event.dataTransfer.files));
  };

  const handleSend = () => {
    const text = draft.trim();
    if (!text || isStreaming) {
      return;
    }
    setDraft("");
    void sendMessage(text);
  };

  // "Work into the text" goes back through the agent loop rather than pasting
  // the answer at the caret: the agent re-reads the document and proposes the
  // change where it belongs, which the user then accepts or discards inline.
  // The prompt quotes the answer back (the click can target an older message,
  // so "your last answer" would not identify it) — hence the action flag, which
  // keeps that quote out of the transcript.
  const handleApplyToDocument = (answer: string) => {
    if (isStreaming) {
      return;
    }

    void sendMessage(t("chat.applyToDocumentPrompt", { text: answer }), "applyToDocument");
  };

  const handleKeyDown = (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
    // While the microphone is open, Enter belongs to the dictation (stop and
    // insert) — the window-level handler above takes it.
    if (voice.status !== "idle") {
      return;
    }

    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      handleSend();
    }
  };

  return (
    <section
      className={`chat-panel${isDropTarget ? " chat-panel--drop-target" : ""}`}
      aria-label={t("chat.panelLabel")}
      ref={panelRef}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      {/* Dropping files anywhere on the panel attaches them, so the hint covers
          the whole panel rather than marking one small target. */}
      {isDropTarget ? (
        <div className="chat-panel__dropzone" aria-hidden="true">
          <Paperclip className="size-5" />
          <span>{t("chat.dropFilesHint")}</span>
        </div>
      ) : null}

      <header className="chat-panel__header">
        <button
          type="button"
          className="chat-panel__header-button"
          aria-label={t("chat.back")}
          title={t("chat.back")}
          onClick={showOverview}
        >
          <ArrowLeft className="size-4" />
        </button>
        <h2 className="chat-panel__title">
          {activeSession?.title || t("chat.newChatTitle")}
        </h2>
        <button
          type="button"
          className="chat-panel__header-button"
          aria-label={t("chat.close")}
          title={t("chat.close")}
          onClick={closePanel}
        >
          <X className="size-4" />
        </button>
      </header>

      <div className="chat-panel__messages" ref={scrollRef}>
        {/* An untouched chat shows the history instead of an empty area; the
            first keystroke already clears it, so the composer is never
            competing with the list for attention. */}
        {isEmptyChat && draft.length === 0 ? (
          hasSessions ? (
            <RecentSessions />
          ) : (
            <p className="chat-panel__empty">
              {t("chat.empty")}
              {/* Dropping files here is invisible until someone tries it, so
                  the empty chat is where it gets said. */}
              <span className="chat-panel__empty-hint">{t("chat.emptyAttachHint")}</span>
            </p>
          )
        ) : null}

        {messages.map((message, index) => {
          if (message.role === "tool") {
            // A UI-only signal, not an editor action — the "In Text
            // einarbeiten" button on the assistant bubble above it already
            // communicates this, so a status line here would be redundant.
            if (message.toolName === FLAG_SUGGESTION_TOOL_NAME) {
              return null;
            }

            return (
              <ToolStatusLine
                key={index}
                toolName={message.toolName}
                isError={message.content.startsWith("Error:")}
              />
            );
          }

          if (message.role === "assistant") {
            return (
              <AssistantMessage
                key={index}
                message={message}
                // suggestsEdit is the model's own verdict that this reply offers
                // a change nothing in the editor is waiting on — see
                // FLAG_SUGGESTION_TOOL_NAME. Never derived from the reply text
                // here: a button on every answer is what made it noise.
                canApplyToDocument={canEditDocument && !isStreaming && (message.suggestsEdit ?? false)}
                onApplyToDocument={handleApplyToDocument}
              />
            );
          }

          // The turn carrying an image get_image resolved is a user turn only
          // as far as the wire format is concerned — the user never wrote it,
          // so it stays out of the transcript. The get_image tool status line
          // above it is what tells them the image was looked at.
          if (message.imagePaths?.length) {
            return null;
          }

          // Likewise for a turn a button generated: its content is a long
          // instruction quoting the assistant's own answer, which as a user
          // bubble looked like the user had pasted that answer back. Show the
          // action that was clicked instead.
          if (message.action === "applyToDocument") {
            return (
              <div key={index} className="chat-message chat-message--user">
                <div className="chat-tool-status">
                  <PencilLine className="size-3.5" />
                  <span>{t("chat.applyToDocument")}</span>
                </div>
              </div>
            );
          }

          return (
            <div key={index} className="chat-message chat-message--user">
              {/* Which files were attached when this turn was sent. Same idea as
                  the selection quote below: context the turn carried, not words
                  the user wrote. */}
              {message.attachedFileNames?.length ? (
                <div
                  className="chat-message__attachments"
                  title={message.attachedFileNames.join("\n")}
                >
                  <Paperclip className="size-3 shrink-0" />
                  <span>{message.attachedFileNames.map(fileNameFromPath).join(", ")}</span>
                </div>
              ) : null}

              {/* The passage this turn was asked about. It is not part of the
                  message the user typed, so it stays a quote above the bubble —
                  the same passage the model received as context. */}
              {message.selection ? (
                <div className="chat-message__selection" title={message.selection}>
                  <TextQuote className="size-3 shrink-0" />
                  <span>{selectionPreview(message.selection)}</span>
                </div>
              ) : null}
              <div className="chat-message__bubble">{message.content}</div>
            </div>
          );
        })}

        {isStreaming ? (
          <div className="chat-message chat-message--assistant">
            {streamingThinking ? (
              <div className="chat-message__thinking">{streamingThinking}</div>
            ) : null}
            <div className="chat-message__bubble">
              {streamingText || (
                <span className="chat-message__cursor" role="status" aria-label={t("chat.agentWorking")}>
                  <span className="chat-thinking-dots" aria-hidden="true">
                    <span />
                    <span />
                    <span />
                  </span>
                </span>
              )}
            </div>
          </div>
        ) : null}

        {error ? <p className="chat-panel__error">{error}</p> : null}
      </div>

      <footer className="chat-panel__footer">
        {!loadedFolderPath ? (
          <p className="chat-panel__hint">{t("chat.noFolderHint")}</p>
        ) : null}

        {/* The files this chat answers from first. They stay attached until the
            user removes them or starts another chat, so they sit above the
            composer rather than travelling with a single message. */}
        {attachedFiles.length > 0 ? (
          <div className="chat-panel__attachments" aria-label={t("chat.attachmentsLabel")}>
            {attachedFiles.map((file) => (
              <span
                key={file.id}
                className="chat-panel__attachment"
                title={`${file.path || file.name}${file.truncated ? `\n${t("chat.attachmentTruncated")}` : ""}`}
              >
                <Paperclip className="size-3 shrink-0" />
                <span className="chat-panel__attachment-name">{file.name}</span>
                <button
                  type="button"
                  className="chat-panel__selection-drop"
                  aria-label={t("chat.attachmentDetach", { name: file.name })}
                  title={t("chat.attachmentDetach", { name: file.name })}
                  onClick={() => {
                    setAttachError(null);
                    removeAttachedFile(file.id);
                  }}
                >
                  <X className="size-3" />
                </button>
              </span>
            ))}
          </div>
        ) : null}

        {attachError ? <p className="chat-panel__attach-error">{attachError}</p> : null}

        {/* What the editor currently has selected. Shown here because the
            passage travels with the next message as context — and because the
            document's own highlight is the unfocused one while the user types
            in this field. */}
        {editorSelection ? (
          <div
            className="chat-panel__selection"
            aria-label={t("chat.selectionAttached")}
            title={editorSelection}
          >
            <TextQuote className="size-3.5 shrink-0" />
            <span className="chat-panel__selection-text">{selectionPreview(editorSelection)}</span>
            <button
              type="button"
              className="chat-panel__selection-drop"
              aria-label={t("chat.selectionDetach")}
              title={t("chat.selectionDetach")}
              onClick={() => setEditorSelection("")}
            >
              <X className="size-3" />
            </button>
          </div>
        ) : null}

        {isRecording ? (
          <VoiceRecordingBanner
            level={voice.level}
            isRecording
            message={t("voice.dialogRecordingHint")}
            className="editor-view__feedback--chat"
          />
        ) : null}

        {isTranscribing ? <p className="voice-status">{t("voice.transcribing")}</p> : null}
        {voiceError ? <p className="voice-status voice-status--error">{voiceError}</p> : null}

        <div className="chat-panel__input-row">
          {/* Read-only rather than disabled while the mic is open: the field
              keeps the focus, so Enter/Esc and Ctrl+Shift+W stay with the
              recording instead of falling through to the document. */}
          <textarea
            ref={inputRef}
            className="chat-panel__input"
            value={draft}
            placeholder={t("chat.inputPlaceholder")}
            rows={2}
            readOnly={isRecording || isTranscribing}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={handleKeyDown}
          />
          {isStreaming ? (
            <Button
              type="button"
              size="icon"
              variant="outline"
              aria-label={t("chat.stop")}
              title={t("chat.stop")}
              onClick={cancel}
            >
              <Square size={12} fill="currentColor" strokeWidth={0} />
            </Button>
          ) : (
            <Button
              type="button"
              size="icon"
              aria-label={t("chat.send")}
              title={t("chat.send")}
              disabled={!draft.trim()}
              onClick={handleSend}
            >
              <SendHorizontal className="size-4" />
            </Button>
          )}
        </div>

        <div className="chat-panel__controls">
          <AssistantSelect onAssistantSettingsRequest={onAssistantSettingsRequest} />
          <button
            type="button"
            className="voice-mic-button voice-mic-button--chat"
            disabled={isTranscribing || voice.status === "starting"}
            title={`${isRecording ? t("voice.micStop") : t("voice.micStart")} (${formatBinding(t, DICTATION_BINDING)})`}
            aria-label={isRecording ? t("voice.micStop") : t("voice.micStart")}
            onClick={() => {
              setVoiceError(null);
              voice.toggle();
            }}
          >
            {isTranscribing ? (
              <Loader2 className="voice-mic-button__icon voice-mic-button__icon--spinning" aria-hidden="true" />
            ) : isRecording ? (
              <Square className="voice-mic-button__icon" fill="currentColor" strokeWidth={0} aria-hidden="true" />
            ) : (
              <Mic className="voice-mic-button__icon" aria-hidden="true" />
            )}
          </button>
          {knowledgeBaseReady ? (
            <Toggle
              pressed={useKnowledgeBase}
              className="ai-thinking-toggle"
              aria-label={t("chat.knowledgeBase")}
              title={useKnowledgeBase ? t("chat.knowledgeBaseOn") : t("chat.knowledgeBaseOff")}
              onClick={() => setUseKnowledgeBase(!useKnowledgeBase)}
            >
              <Library className="size-4" />
            </Toggle>
          ) : null}
          <Toggle
            pressed={thinkingEnabled}
            className="ai-thinking-toggle"
            aria-label={t("chat.thinking")}
            title={thinkingEnabled ? t("chat.thinkingOn") : t("chat.thinkingOff")}
            onClick={() => {
              updateSettings({ thinkingMode: thinkingEnabled ? "off" : "default" });
            }}
          >
            <Brain className="size-4" />
          </Toggle>
        </div>
      </footer>

      <VoiceModelDownloadDialog
        open={voice.isModelDialogOpen}
        onClose={voice.closeModelDialog}
        onDownloaded={voice.handleModelDownloaded}
      />
    </section>
  );
}
