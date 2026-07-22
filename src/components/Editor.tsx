import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

import { openUrl } from "@tauri-apps/plugin-opener";
import { EditorContent, type Editor as TipTapEditor, useEditor } from "@tiptap/react";

import { ScrollArea } from "@/components/ui/scroll-area";
import { AiCheckDialog } from "@/components/AiCheckDialog";
import { FindReplacePanel } from "@/components/FindReplacePanel";
import { AiRewriteDialog } from "@/components/AiRewriteDialog";
import { VoiceModelDownloadDialog } from "@/components/VoiceModelDownloadDialog";
import { VoiceRecordingBanner } from "@/components/VoiceRecordingBanner";
import { useVoiceInput } from "@/hooks/useVoiceInput";
import { Toolbar } from "@/components/Toolbar";
import { checkGrammar, streamAiMarkdown, type AiActionMode, type AiCheckIssue } from "@/lib/aiClient";
import { updateAiDiffWidget } from "@/lib/aiDiffWidget";
import { updateAiStreamWidget } from "@/lib/aiStreamWidget";
import { updateVoiceInsertWidget } from "@/lib/voiceInsertWidget";
import { EditorFileContext } from "@/lib/editorFileContext";
import { normalizeEscapedCheckboxes } from "@/lib/editor/markdownNormalize";
import { buildEditorExtensions } from "@/lib/editor/extensions";
import { extractErrorMessage, formatAiError } from "@/lib/editor/errorMessages";
import { getImageFilesFromClipboard, getImageFilesFromDataTransfer } from "@/lib/editor/imageTransfer";
import { moveListItem } from "@/lib/editor/listCommands";
import { getEditorMarkdown, getSelectionMarkdown } from "@/lib/editor/markdownStorage";
import { getRelativeImageMarkdownPath, saveImageToFolder } from "@/lib/fileSystem";
import { updateSearchHighlight } from "@/lib/searchHighlight";
import { printMarkdown } from "@/lib/print";
import { useAiSettingsStore } from "@/store/useAiSettingsStore";
import { getSelectedAssistant, useAssistantsStore } from "@/store/useAssistantsStore";
import { useEditorSettingsStore } from "@/store/useEditorSettingsStore";
import { useSearchStore } from "@/store/useSearchStore";

type EditorProps = {
  markdown: string;
  onMarkdownChange: (markdown: string) => void;
  folderPath: string | null;
  filePath: string | null;
  editorFocusRequestId?: number;
  onRequestSidebarFocus?: () => void;
  onRequestFileOpen?: (filePath: string) => void;
  onAiLoadingChange?: (isLoading: boolean) => void;
  onAiPendingChange?: (isPending: boolean) => void;
  onAiSettingsRequest: () => void;
  onAssistantSettingsRequest: () => void;
};

export type EditorHandle = {
  cancelAiRequest: () => void;
  printDocument: () => void;
};

type AiDraft = {
  mode: AiActionMode;
  from: number;
  to: number;
  selectedText: string;
  selectedMarkdown: string;
};

type AiStatus = {
  kind: "info" | "error" | "success";
  message: string;
} | null;

type StreamDraft = {
  from: number;
  to: number;
  content: string;
};

export const Editor = forwardRef<EditorHandle, EditorProps>(function Editor(
  {
    markdown,
    onMarkdownChange,
    folderPath,
    filePath,
    editorFocusRequestId,
    onRequestSidebarFocus,
    onRequestFileOpen,
    onAiLoadingChange,
    onAiPendingChange,
    onAiSettingsRequest,
    onAssistantSettingsRequest
  },
  ref
) {
  const { t } = useTranslation();
  const editorRef = useRef<TipTapEditor | null>(null);
  const lastSyncedMarkdownRef = useRef(markdown);
  const [aiDraft, setAiDraft] = useState<AiDraft | null>(null);
  const [isAiLoading, setIsAiLoading] = useState(false);
  const [isAiDiffOpen, setIsAiDiffOpen] = useState(false);
  const [aiStatus, setAiStatus] = useState<AiStatus>(null);
  const [aiCheckIssues, setAiCheckIssues] = useState<AiCheckIssue[] | null>(null);
  const [aiCheckResolvedCount, setAiCheckResolvedCount] = useState(0);
  const aiSettings = useAiSettingsStore((state) => state.settings);
  const spellcheckEnabled = useEditorSettingsStore((state) => state.spellcheckEnabled);
  const aiStreamDraftRef = useRef<StreamDraft | null>(null);
  const aiDiffOriginalRef = useRef<{ from: number; to: number; text: string; markdown: string } | null>(null);
  const aiDiffLastResultRef = useRef<string | null>(null);
  const aiAbortControllerRef = useRef<AbortController | null>(null);
  const aiCheckRangeRef = useRef<{ from: number; to: number } | null>(null);
  const [isLinkModifierHeld, setIsLinkModifierHeld] = useState(false);
  const [voiceStartRequestId, setVoiceStartRequestId] = useState(0);

  // Ctrl+Shift+W dictation: the transcript is inserted at the cursor as one
  // atomic undo step (a single insertContent transaction), per issue #7.
  const dictation = useVoiceInput({
    onTranscript: (text) => {
      // Re-enable typing before inserting; the chain leaves the caret at the
      // end of the inserted text.
      editorRef.current?.setEditable(true, false);
      editorRef.current?.chain().focus().insertContent(text).run();
    },
    onError: (message) => {
      setAiStatus({ kind: "error", message: t("voice.error", { error: message }) });
    }
  });
  const dictationRef = useRef(dictation);
  dictationRef.current = dictation;
  // editorProps.handleKeyDown closes over the first render — like the other
  // shortcut handlers, dictation state has to be read through refs.
  const aiDraftOpenRef = useRef(false);
  aiDraftOpenRef.current = aiDraft !== null;
  const isAiLoadingRef = useRef(false);
  isAiLoadingRef.current = isAiLoading;

  const toggleDictation = () => {
    // While the AI dialog or a diff review is open, dictation into the
    // document would fight with those flows — the dialog has its own mic.
    if (aiDraftOpenRef.current || aiDiffOriginalRef.current || isAiLoadingRef.current) {
      return;
    }

    dictationRef.current.toggle();
  };

  // While recording, Enter stops (and transcribes) and Esc aborts the
  // dictation, no matter where the focus is.
  useEffect(() => {
    const handleDictationKeys = (event: KeyboardEvent) => {
      if (dictationRef.current.status !== "recording") {
        return;
      }

      if (event.key === "Enter" && !event.ctrlKey && !event.metaKey && !event.shiftKey) {
        event.preventDefault();
        void dictationRef.current.stop();
      } else if (event.key === "Escape") {
        event.preventDefault();
        dictationRef.current.cancel();
      }
    };

    window.addEventListener("keydown", handleDictationKeys);

    return () => window.removeEventListener("keydown", handleDictationKeys);
  }, []);

  // No caret and no typing in the document while the microphone is open.
  // onTranscript re-enables editing itself (before inserting); this effect
  // covers start, cancel, and error paths. The diff-review guard matters
  // because that flow also parks the editor in read-only mode — dictation
  // must not silently lift it.
  useEffect(() => {
    const currentEditor = editorRef.current;

    if (!currentEditor || currentEditor.isDestroyed) {
      return;
    }

    if (dictation.status === "recording" || dictation.status === "transcribing") {
      currentEditor.setEditable(false, false);
      // With the caret hidden (non-editable), this marker is what shows
      // where the transcript will be inserted.
      updateVoiceInsertWidget(currentEditor, { pos: currentEditor.state.selection.from });
    } else {
      updateVoiceInsertWidget(currentEditor, null);

      if (!aiDiffOriginalRef.current) {
        currentEditor.setEditable(true, false);
      }
    }
  }, [dictation.status]);
  // Panel visibility (and the whole search state) lives in useSearchStore
  // so it survives the per-file remount of this component during
  // cross-file match navigation.
  const openFindPanel = () => {
    useSearchStore.getState().openPanel();
  };

  const closeFindPanel = () => {
    useSearchStore.getState().closePanel();

    const currentEditor = editorRef.current;

    if (currentEditor) {
      updateSearchHighlight(currentEditor, null);
      currentEditor.commands.focus();
    }
  };

  // Ctrl+F must work regardless of where the focus currently is (editor,
  // toolbar, sidebar), so it's registered at window level rather than in
  // the ProseMirror keymap.
  useEffect(() => {
    const handleFindShortcut = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "f" && !event.shiftKey && !event.altKey) {
        event.preventDefault();
        openFindPanel();
      }
    };

    window.addEventListener("keydown", handleFindShortcut);

    return () => window.removeEventListener("keydown", handleFindShortcut);
  }, []);

  useEffect(() => {
    const handleModifierChange = (event: KeyboardEvent) => {
      setIsLinkModifierHeld(event.ctrlKey || event.metaKey);
    };
    const handleBlur = () => setIsLinkModifierHeld(false);

    window.addEventListener("keydown", handleModifierChange);
    window.addEventListener("keyup", handleModifierChange);
    window.addEventListener("blur", handleBlur);

    return () => {
      window.removeEventListener("keydown", handleModifierChange);
      window.removeEventListener("keyup", handleModifierChange);
      window.removeEventListener("blur", handleBlur);
    };
  }, []);

  const updateStreamDraft = (editor: TipTapEditor, chunk: string) => {
    const streamDraft = aiStreamDraftRef.current;

    if (!streamDraft || !chunk) {
      return;
    }

    streamDraft.content += chunk;

    const sizeBefore = editor.state.doc.content.size;

    try {
      editor.commands.insertContentAt(
        { from: streamDraft.from, to: streamDraft.to },
        streamDraft.content
      );
    } catch {
      // Partial markdown (e.g. an unfinished list item) can briefly produce
      // content the schema rejects. Skip this render pass — the next chunk's
      // re-parse of the full accumulated text will recover once it completes.
      return;
    }

    const sizeAfter = editor.state.doc.content.size;

    streamDraft.to += sizeAfter - sizeBefore;
  };

  const handleLinkRequest = () => {
    const currentEditor = editorRef.current;

    if (!currentEditor) {
      return;
    }

    const activeHref = currentEditor.getAttributes("link").href as string | undefined;
    const nextHref = window.prompt(t("editor.linkPrompt"), activeHref ?? "https://");

    if (nextHref === null) {
      return;
    }

    const trimmedHref = nextHref.trim();

    if (!trimmedHref) {
      if (activeHref) {
        currentEditor.chain().focus().extendMarkRange("link").unsetLink().run();
      }

      return;
    }

    currentEditor
      .chain()
      .focus()
      .extendMarkRange("link")
      .setLink({ href: trimmedHref })
      .run();
  };

  const insertImageFiles = async (files: File[], insertPos: number) => {
    const currentEditor = editorRef.current;

    if (!currentEditor || files.length === 0) {
      return;
    }

    if (!folderPath || !filePath) {
      setAiStatus({
        kind: "error",
        message: t("editor.imageRequiresFile")
      });
      return;
    }

    let pos = insertPos;

    for (const file of files) {
      try {
        const data = new Uint8Array(await file.arrayBuffer());
        const rootRelativePath = await saveImageToFolder(folderPath, file.name, file.type, data);
        const markdownPath = await getRelativeImageMarkdownPath(folderPath, filePath, rootRelativePath);
        const altText = file.name.replace(/\.[^.]+$/, "");

        const sizeBefore = currentEditor.state.doc.content.size;
        currentEditor
          .chain()
          .focus()
          .insertContentAt(pos, { type: "image", attrs: { src: markdownPath, alt: altText } })
          .run();
        const sizeAfter = currentEditor.state.doc.content.size;

        pos += sizeAfter - sizeBefore;
      } catch (error) {
        setAiStatus({
          kind: "error",
          message: t("editor.imageInsertFailed", { fileName: file.name, error: extractErrorMessage(error, t) })
        });
      }
    }
  };

  const openAiDraft = (
    mode: AiActionMode,
    from: number,
    to: number,
    selectedText: string,
    selectedMarkdown: string
  ) => {
    setAiDraft({ mode, from, to, selectedText, selectedMarkdown });
  };

  const openAiDraftFromSelection = () => {
    const currentEditor = editorRef.current;

    if (!currentEditor || aiDiffOriginalRef.current) {
      return;
    }

    const { from, to, empty } = currentEditor.state.selection;
    const selectedText = currentEditor.state.doc.textBetween(from, to, "\n");

    if (!empty && selectedText.length > 0) {
      const selectedMarkdown = getSelectionMarkdown(currentEditor, from, to);
      openAiDraft("rewrite", from, to, selectedText, selectedMarkdown || selectedText);
      return;
    }

    openAiDraft("insert", from, to, "", "");
  };

  const handleAiContextMenu = (event: React.MouseEvent<HTMLDivElement>) => {
    if (!editorRef.current) {
      return;
    }

    event.preventDefault();
    openAiDraftFromSelection();
  };

  // Shows the diff widget for a result against the tracked original — used
  // while a rewrite is still streaming (isStreaming: true, actions disabled,
  // updated on every chunk), once a generation finishes, and when a
  // cancelled "continue editing" round falls back to whatever diff was
  // showing before it was opened.
  const showAiDiff = (currentEditor: TipTapEditor, resultMarkdown: string, isStreaming = false) => {
    const original = aiDiffOriginalRef.current;

    if (!original) {
      return;
    }

    aiDiffLastResultRef.current = resultMarkdown;
    // emitUpdate=false: setEditable's default synthesizes an 'update' event
    // even though nothing in the document changed — with onMarkdownChange
    // bound to whichever file is selected *at that moment*, letting that
    // fire during a file switch would write this document's markdown into
    // the newly selected file's slot and falsely mark it as unsaved.
    currentEditor.setEditable(false, false);

    updateAiDiffWidget(currentEditor, {
      from: original.from,
      to: original.to,
      resultMarkdown,
      isStreaming,
      onAccept: () => acceptAiDiff(resultMarkdown),
      onDiscard: () => discardAiDiff(),
      onContinueEditing: () => continueEditingAiDiff(resultMarkdown)
    });
  };

  const clearAiDiff = (currentEditor: TipTapEditor) => {
    updateAiDiffWidget(currentEditor, null);
    currentEditor.setEditable(true, false);
    aiDiffOriginalRef.current = null;
    aiDiffLastResultRef.current = null;
    setIsAiDiffOpen(false);
  };

  const closeAiDraft = () => {
    if (isAiLoading) {
      return;
    }

    setAiDraft(null);

    // Cancelling the prompt dialog for a "continue editing" round must not
    // strand the diff in limbo — fall back to whatever result was showing
    // before that round was started.
    const currentEditor = editorRef.current;

    if (currentEditor && aiDiffOriginalRef.current && aiDiffLastResultRef.current !== null) {
      showAiDiff(currentEditor, aiDiffLastResultRef.current);
    }
  };

  const acceptAiDiff = (resultMarkdown: string) => {
    const currentEditor = editorRef.current;
    const original = aiDiffOriginalRef.current;

    if (!currentEditor || !original) {
      return;
    }

    // Clear the diff widget (and its from/to decoration) before mutating the
    // document: the plugin doesn't remap those positions through unrelated
    // transactions (the editor is read-only for the whole diff phase), so
    // clearing after the edit would leave it pointing at stale positions in
    // the changed document for one dispatch.
    clearAiDiff(currentEditor);
    currentEditor
      .chain()
      .focus()
      .insertContentAt({ from: original.from, to: original.to }, resultMarkdown)
      .run();
  };

  const discardAiDiff = () => {
    const currentEditor = editorRef.current;

    if (!currentEditor) {
      return;
    }

    // The original selection was never removed from the document, so
    // discarding is just clearing the diff widget — nothing to restore.
    clearAiDiff(currentEditor);
  };

  const continueEditingAiDiff = (resultMarkdown: string) => {
    const currentEditor = editorRef.current;
    const original = aiDiffOriginalRef.current;

    if (!currentEditor || !original) {
      return;
    }

    updateAiDiffWidget(currentEditor, null);
    currentEditor.setEditable(true, false);
    // aiDiffOriginalRef (and aiDiffLastResultRef) stay set so the diff shown
    // after this round — or a fallback if the dialog gets cancelled — still
    // compares against the very first original text.
    openAiDraft("rewrite", original.from, original.to, resultMarkdown, resultMarkdown);
  };

  const runAiDraft = async (prompt: string, includeDocument: boolean, preserveFormatting: boolean) => {
    const currentEditor = editorRef.current;
    const draft = aiDraft;

    if (!currentEditor || !draft) {
      return;
    }

    setAiDraft(null);
    setIsAiLoading(true);
    setAiStatus({ kind: "info", message: t("app.aiRequestRunning") });

    const isRewrite = draft.mode === "rewrite";

    // "insert" streams straight into the document as before. "rewrite" keeps
    // the original selection untouched and buffers the result instead, so it
    // can be shown as an accept/discard/continue-editing diff once the
    // stream finishes rather than overwriting the selection immediately.
    if (!isRewrite) {
      aiStreamDraftRef.current = { from: draft.from, to: draft.from, content: "" };
    }

    // Until the first visible answer chunk arrives, a widget at the insertion
    // point shows a live preview of the reasoning trace when thinking is
    // enabled — with thinking off there's nothing meaningful to show yet, so
    // no widget appears at all until writing actually starts (for rewrite
    // that's when the diff widget takes over and starts growing with each
    // chunk).
    const showThinkingWidget = aiSettings.thinkingMode !== "off";
    let widgetVisible = showThinkingWidget;
    let thinkingText = "";
    let streamedMarkdown = "";

    if (showThinkingWidget) {
      updateAiStreamWidget(currentEditor, { pos: draft.from, thinkingText: "" });
    }

    const hideWidget = () => {
      if (widgetVisible) {
        widgetVisible = false;

        const activeEditor = editorRef.current;

        if (activeEditor) {
          updateAiStreamWidget(activeEditor, null);
        }
      }
    };

    const abortController = new AbortController();
    aiAbortControllerRef.current = abortController;

    try {
      const request = {
        mode: draft.mode,
        prompt,
        selectedText: draft.selectedText,
        selectedMarkdown: draft.selectedMarkdown,
        documentMarkdown: markdown,
        includeDocument,
        preserveFormatting,
        assistantInstruction: getSelectedAssistant(useAssistantsStore.getState()).instruction
      };

      const streamHandlers = {
        onChunk: (chunk: string) => {
          hideWidget();

          const activeEditor = editorRef.current;

          if (!isRewrite) {
            if (activeEditor) {
              updateStreamDraft(activeEditor, chunk);
            }

            return;
          }

          streamedMarkdown += chunk;

          if (activeEditor) {
            if (!aiDiffOriginalRef.current) {
              aiDiffOriginalRef.current = {
                from: draft.from,
                to: draft.to,
                text: draft.selectedText,
                markdown: draft.selectedMarkdown
              };
            }

            setIsAiDiffOpen(true);
            showAiDiff(activeEditor, streamedMarkdown, true);
          }
        },
        onThinking: (chunk: string) => {
          const activeEditor = editorRef.current;

          if (!widgetVisible || !activeEditor) {
            return;
          }

          thinkingText += chunk;
          updateAiStreamWidget(activeEditor, { pos: draft.from, thinkingText });
        }
      };

      const generatedMarkdown = normalizeEscapedCheckboxes(
        await streamAiMarkdown(aiSettings, request, streamHandlers, abortController.signal)
      );

      if (isRewrite) {
        // Fallback for the edge case where the response arrived without any
        // streamed chunks (e.g. resolved directly on completion) — the diff
        // widget was never shown yet, so the original still needs tracking.
        if (!aiDiffOriginalRef.current) {
          aiDiffOriginalRef.current = {
            from: draft.from,
            to: draft.to,
            text: draft.selectedText,
            markdown: draft.selectedMarkdown
          };
        }

        setIsAiDiffOpen(true);
        showAiDiff(currentEditor, generatedMarkdown, false);
      } else {
        const streamDraft = aiStreamDraftRef.current;

        if (streamDraft) {
          currentEditor
            .chain()
            .focus()
            .insertContentAt({ from: streamDraft.from, to: streamDraft.to }, generatedMarkdown)
            .run();
        } else {
          currentEditor.chain().focus().insertContentAt(draft.from, generatedMarkdown).run();
        }
      }

      setAiStatus(null);
    } catch (error) {
      if (abortController.signal.aborted) {
        setAiStatus(null);

        // Stopping mid-stream leaves the diff widget's last render stuck
        // with isStreaming: true (actions disabled) since no further chunk
        // will ever arrive to flip it — re-render with whatever was
        // streamed so far so accept/discard/continue-editing unlock again.
        const activeEditor = editorRef.current;

        if (isRewrite && activeEditor && aiDiffOriginalRef.current) {
          showAiDiff(activeEditor, streamedMarkdown, false);
        }
      } else {
        setAiStatus({ kind: "error", message: formatAiError(error, t) });
      }
    } finally {
      hideWidget();
      setIsAiLoading(false);
      aiStreamDraftRef.current = null;
      aiAbortControllerRef.current = null;
    }
  };

  const performAiGrammarCheck = async (
    currentEditor: TipTapEditor,
    from: number,
    to: number,
    selectedText: string
  ) => {
    setIsAiLoading(true);
    setAiStatus({ kind: "info", message: t("app.aiRequestRunning") });

    const abortController = new AbortController();
    aiAbortControllerRef.current = abortController;

    try {
      const issues = await checkGrammar(aiSettings, selectedText, abortController.signal);

      aiCheckRangeRef.current = { from, to };
      setAiCheckIssues(issues);
      setAiCheckResolvedCount(0);
      // emitUpdate=false: same reasoning as showAiDiff — no document change
      // actually happened, so the file-switch/unsaved-changes tracking must
      // not misattribute a synthetic 'update' event to the current file.
      currentEditor.setEditable(false, false);
      setAiStatus(null);
    } catch (error) {
      if (abortController.signal.aborted) {
        setAiStatus(null);
      } else {
        setAiStatus({ kind: "error", message: formatAiError(error, t) });
      }
    } finally {
      setIsAiLoading(false);
      aiAbortControllerRef.current = null;
    }
  };

  const runAiGrammarCheck = () => {
    const currentEditor = editorRef.current;

    if (!currentEditor || isAiLoading || aiDraft || aiDiffOriginalRef.current || aiCheckIssues !== null) {
      return;
    }

    const { from, to, empty } = currentEditor.state.selection;

    if (empty) {
      return;
    }

    const selectedText = currentEditor.state.doc.textBetween(from, to, "\n");

    if (!selectedText.trim()) {
      return;
    }

    void performAiGrammarCheck(currentEditor, from, to, selectedText);
  };

  const applyAiCheckIssue = (issue: AiCheckIssue) => {
    const currentEditor = editorRef.current;
    const range = aiCheckRangeRef.current;

    if (currentEditor && range) {
      // The AI response carries no reliable character offsets, so the
      // original passage is located by a plain text search instead. Plain
      // string offsets into textBetween() cannot be added to doc positions
      // (each block boundary is 2 doc positions but only 1 "\n" character),
      // so the search string is built alongside a per-character map of real
      // doc positions. If the passage can no longer be found (e.g. the range
      // changed since the check ran), the issue is dropped without touching
      // the document rather than blocking the rest of the list.
      const doc = currentEditor.state.doc;
      const to = Math.min(range.to, doc.content.size);
      let text = "";
      const positions: number[] = [];

      doc.nodesBetween(range.from, to, (node, pos) => {
        if (node.isText && node.text) {
          const start = Math.max(range.from, pos);
          const end = Math.min(to, pos + node.nodeSize);

          for (let i = start; i < end; i += 1) {
            text += node.text[i - pos];
            positions.push(i);
          }
        } else if (node.isBlock && text.length > 0 && !text.endsWith("\n")) {
          text += "\n";
          positions.push(-1);
        }

        return true;
      });

      const matchIndex = text.indexOf(issue.original);

      // Trailing block separators carry no real doc position, so the match
      // end is anchored on the last actual character of the passage.
      let matchEnd = matchIndex === -1 ? -1 : matchIndex + issue.original.length - 1;

      while (matchEnd > matchIndex && positions[matchEnd] === -1) {
        matchEnd -= 1;
      }

      if (matchIndex !== -1 && positions[matchIndex] !== -1 && positions[matchEnd] !== -1) {
        const foundFrom = positions[matchIndex];
        const foundTo = positions[matchEnd] + 1;
        const sizeBefore = doc.content.size;

        currentEditor
          .chain()
          .focus()
          .insertContentAt({ from: foundFrom, to: foundTo }, issue.suggestion)
          .run();

        aiCheckRangeRef.current = {
          from: range.from,
          to: range.to + (currentEditor.state.doc.content.size - sizeBefore)
        };
      }
    }

    setAiCheckIssues((current) => (current ? current.filter((entry) => entry !== issue) : current));
    setAiCheckResolvedCount((count) => count + 1);
  };

  const applyAllAiCheckIssues = () => {
    for (const issue of aiCheckIssues ?? []) {
      applyAiCheckIssue(issue);
    }
  };

  const closeAiCheckDialog = () => {
    const currentEditor = editorRef.current;

    if (currentEditor) {
      currentEditor.setEditable(true, false);
    }

    setAiCheckIssues(null);
    aiCheckRangeRef.current = null;
  };

  const cancelAiRequest = () => {
    aiAbortControllerRef.current?.abort();
  };

  const printDocument = () => {
    const currentEditor = editorRef.current;

    if (!currentEditor) {
      return;
    }

    const currentMarkdown = getEditorMarkdown(currentEditor, markdown);

    printMarkdown(currentMarkdown, filePath).catch((error: unknown) => {
      console.error("Print failed:", error);
    });
  };

  useImperativeHandle(ref, () => ({ cancelAiRequest, printDocument }), []);

  useEffect(() => {
    onAiLoadingChange?.(isAiLoading);
  }, [isAiLoading, onAiLoadingChange]);

  // Signals "there is AI work here that would be lost by navigating away" —
  // broader than isAiLoading (which only covers the chip/cancel button while
  // a request is in flight): it also stays true for as long as an unresolved
  // diff or grammar-check result is on screen, waiting to be accepted,
  // discarded, or closed.
  useEffect(() => {
    onAiPendingChange?.(isAiLoading || isAiDiffOpen || aiCheckIssues !== null);
  }, [isAiLoading, isAiDiffOpen, aiCheckIssues, onAiPendingChange]);

  const editor = useEditor({
    extensions: buildEditorExtensions(),
    content: normalizeEscapedCheckboxes(markdown),
    editable: true,
    onCreate: ({ editor }) => {
      editorRef.current = editor;
      lastSyncedMarkdownRef.current = markdown;
    },
    onUpdate: ({ editor }) => {
      const nextMarkdown = getEditorMarkdown(editor, markdown);
      lastSyncedMarkdownRef.current = nextMarkdown;

      onMarkdownChange(nextMarkdown);
    },
    editorProps: {
      handleDrop: (view, event, _slice, moved) => {
        if (moved) {
          return false;
        }

        const files = getImageFilesFromDataTransfer(event.dataTransfer);

        if (files.length === 0) {
          return false;
        }

        event.preventDefault();

        const coordinates = view.posAtCoords({ left: event.clientX, top: event.clientY });
        const insertPos = coordinates?.pos ?? view.state.selection.from;

        void insertImageFiles(files, insertPos);
        return true;
      },
      handlePaste: (view, event) => {
        const files = getImageFilesFromClipboard(event.clipboardData);

        if (files.length === 0) {
          return false;
        }

        event.preventDefault();

        void insertImageFiles(files, view.state.selection.from);
        return true;
      },
      handleDOMEvents: {
        click: (_view, event) => {
          const target = event.target as HTMLElement | null;
          const anchor = target?.closest("a[href]") as HTMLAnchorElement | null;

          if (!anchor) {
            return false;
          }

          event.preventDefault();

          if (event.ctrlKey || event.metaKey) {
            void openUrl(anchor.href);
          }

          return true;
        }
      },
      handleKeyDown: (view, event) => {
        if (event.key === "Tab" && event.shiftKey && !event.ctrlKey && !event.metaKey) {
          event.preventDefault();
          onRequestSidebarFocus?.();
          return true;
        }

        if (
          event.altKey &&
          event.shiftKey &&
          !event.ctrlKey &&
          !event.metaKey &&
          (event.key === "ArrowUp" || event.key === "ArrowDown")
        ) {
          const moved = moveListItem(view, event.key === "ArrowUp" ? "up" : "down");

          if (moved) {
            event.preventDefault();
          }

          return moved;
        }

        if (!(event.ctrlKey || event.metaKey)) {
          return false;
        }

        const key = event.key.toLowerCase();

        if (key === "b") {
          event.preventDefault();
          editorRef.current?.chain().focus().toggleBold().run();
          return true;
        }

        if (key === "i") {
          event.preventDefault();
          editorRef.current?.chain().focus().toggleItalic().run();
          return true;
        }

        if (key === "k") {
          event.preventDefault();
          editorRef.current?.chain().focus().toggleCodeBlock().run();
          return true;
        }

        if (key === "m") {
          event.preventDefault();
          handleLinkRequest();
          return true;
        }

        if (key === ".") {
          event.preventDefault();
          editorRef.current?.chain().focus().toggleBulletList().run();
          return true;
        }

        if (key === "o" && event.shiftKey) {
          event.preventDefault();
          editorRef.current?.chain().focus().toggleOrderedList().run();
          return true;
        }

        if (key === ",") {
          event.preventDefault();
          editorRef.current?.chain().focus().toggleTaskList().run();
          return true;
        }

        if (key === "1") {
          event.preventDefault();
          editorRef.current?.chain().focus().toggleHeading({ level: 1 }).run();
          return true;
        }

        if (key === "2") {
          event.preventDefault();
          editorRef.current?.chain().focus().toggleHeading({ level: 2 }).run();
          return true;
        }

        if (key === "3") {
          event.preventDefault();
          editorRef.current?.chain().focus().toggleHeading({ level: 3 }).run();
          return true;
        }

        if (key === "d") {
          event.preventDefault();
          editorRef.current?.chain().focus().toggleStrike().run();
          return true;
        }

        if (key === "q") {
          event.preventDefault();
          editorRef.current?.chain().focus().toggleBlockquote().run();
          return true;
        }

        if (key === "g") {
          event.preventDefault();
          editorRef.current?.chain().focus().toggleCode().run();
          return true;
        }

        if (key === "e") {
          event.preventDefault();

          // Ctrl+Shift+E opens the AI dialog and immediately starts voice
          // input into the prompt field (issue #7).
          if (event.shiftKey) {
            setVoiceStartRequestId((id) => id + 1);
          }

          openAiDraftFromSelection();
          return true;
        }

        if (key === "w" && event.shiftKey) {
          event.preventDefault();
          toggleDictation();
          return true;
        }

        if (key === "x" && event.shiftKey) {
          if (!view.state.selection.empty) {
            event.preventDefault();
            runAiGrammarCheck();
          }
          return true;
        }

        return false;
      },
      attributes: {
        class: "editor-view__surface prose dark:prose-invert max-w-none",
        spellcheck: String(spellcheckEnabled)
      }
    }
  });

  if (editor) {
    editorRef.current = editor;
  }

  // editorProps.attributes is only read once, at editor creation, so a
  // later toggle of the setting has to be applied to the live DOM node
  // directly instead of relying on tiptap to re-render it.
  useEffect(() => {
    editor?.view.dom.setAttribute("spellcheck", String(spellcheckEnabled));
  }, [editor, spellcheckEnabled]);

  // A focus request from outside (file tree: Tab) moves focus into the editor
  // with the cursor at the document start, so navigation can continue with
  // the arrow keys.
  // Tracks the last handled request value instead of a "skip first run" guard:
  // under React.StrictMode, mount effects run twice while refs persist, so a
  // bool guard would wrongly focus again on the second run and steal focus
  // from, e.g., the title rename after creating a new file.
  const lastHandledEditorFocusRequestRef = useRef(editorFocusRequestId);

  useEffect(() => {
    if (lastHandledEditorFocusRequestRef.current === editorFocusRequestId) {
      return;
    }

    lastHandledEditorFocusRequestRef.current = editorFocusRequestId;
    editorRef.current?.commands.focus("start");
  }, [editorFocusRequestId]);

  // Switching to a different file must not leave a stale diff (and a
  // read-only editor) behind, nor let an in-flight AI request keep running
  // against this (about to be orphaned) editor instance: since rewrite no
  // longer dirties the document up front, App.tsx's unsaved-changes guard
  // can't rely on isDirty alone to block navigation here (see
  // onAiPendingChange below) — if navigation happens anyway, a request that
  // finishes after the switch would call onMarkdownChange (bound to
  // whichever file is selected *at that time*) and silently overwrite the
  // next file's content with this one's result.
  useEffect(() => {
    return () => {
      aiAbortControllerRef.current?.abort();

      const currentEditor = editorRef.current;

      if (aiDiffOriginalRef.current && currentEditor && !currentEditor.isDestroyed) {
        clearAiDiff(currentEditor);
      }
    };
  }, [filePath]);

  useEffect(() => {
    const currentEditor = editorRef.current;

    if (!currentEditor) {
      return;
    }

    const currentMarkdown = getEditorMarkdown(currentEditor, "");

    if (markdown === lastSyncedMarkdownRef.current || markdown === currentMarkdown) {
      lastSyncedMarkdownRef.current = markdown;
      return;
    }

    currentEditor.commands.setContent(normalizeEscapedCheckboxes(markdown), { emitUpdate: false });
    lastSyncedMarkdownRef.current = markdown;
  }, [markdown, editor]);

  if (!editor) {
    return null;
  }

  return (
    <div className="editor-view">
      {dictation.status === "recording" || dictation.status === "transcribing" ? (
        <VoiceRecordingBanner
          level={dictation.level}
          isRecording={dictation.status === "recording"}
          message={dictation.status === "recording" ? t("voice.editorRecordingHint") : t("voice.transcribing")}
        />
      ) : null}

      {aiStatus && aiStatus.kind !== "info" ? (
        <div
          className={
            aiStatus.kind === "error"
              ? "editor-view__feedback editor-view__feedback--error"
              : "editor-view__feedback editor-view__feedback--success"
          }
          aria-live="polite"
        >
          <span className="editor-view__feedback-message">{aiStatus.message}</span>
        </div>
      ) : null}

      <Toolbar
        editor={editor}
        onLinkRequest={handleLinkRequest}
        onAiRequest={openAiDraftFromSelection}
        onAiCheckRequest={runAiGrammarCheck}
        onAiSettingsRequest={onAiSettingsRequest}
        onAssistantSettingsRequest={onAssistantSettingsRequest}
        onPrintRequest={printDocument}
        onSearchRequest={openFindPanel}
      />

      <EditorFileContext.Provider value={{ folderPath, filePath }}>
        <div className="editor-view__body">
          <FindReplacePanel
            editor={editor}
            folderPath={folderPath}
            filePath={filePath}
            onClose={closeFindPanel}
            onRequestFileOpen={onRequestFileOpen}
          />
          <ScrollArea className="editor-view__scroll">
            <EditorContent
              editor={editor}
              className={
                isLinkModifierHeld ? "editor-view__content editor-view__content--link-hint" : "editor-view__content"
              }
              onContextMenu={handleAiContextMenu}
            />
          </ScrollArea>
        </div>
      </EditorFileContext.Provider>

      <AiRewriteDialog
        open={aiDraft !== null}
        mode={aiDraft?.mode ?? "insert"}
        selectedText={aiDraft?.selectedText ?? ""}
        selectedMarkdown={aiDraft?.selectedMarkdown ?? ""}
        isLoading={isAiLoading}
        voiceStartRequestId={voiceStartRequestId}
        onSubmit={(prompt, includeDocument, preserveFormatting) => {
          void runAiDraft(prompt, includeDocument, preserveFormatting);
        }}
        onCancel={closeAiDraft}
      />

      <VoiceModelDownloadDialog
        open={dictation.isModelDialogOpen}
        onClose={dictation.closeModelDialog}
        onDownloaded={dictation.handleModelDownloaded}
      />

      <AiCheckDialog
        open={aiCheckIssues !== null}
        issues={aiCheckIssues ?? []}
        resolvedCount={aiCheckResolvedCount}
        onApply={applyAiCheckIssue}
        onApplyAll={applyAllAiCheckIssues}
        onClose={closeAiCheckDialog}
      />
    </div>
  );
});