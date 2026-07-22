import { useEffect, useRef, useState, type RefObject } from "react";
import { useTranslation } from "react-i18next";

import type { Editor as TipTapEditor } from "@tiptap/react";

import { checkGrammar, streamAiMarkdown, type AiActionMode, type AiCheckIssue } from "@/lib/aiClient";
import { updateAiDiffWidget } from "@/lib/aiDiffWidget";
import { updateAiStreamWidget } from "@/lib/aiStreamWidget";
import { formatAiError } from "@/lib/editor/errorMessages";
import { normalizeEscapedCheckboxes } from "@/lib/editor/markdownNormalize";
import { getSelectionMarkdown } from "@/lib/editor/markdownStorage";
import { useAiSettingsStore } from "@/store/useAiSettingsStore";
import { getSelectedAssistant, useAssistantsStore } from "@/store/useAssistantsStore";

export type AiStatus = {
  kind: "info" | "error" | "success";
  message: string;
} | null;

type AiDraft = {
  mode: AiActionMode;
  from: number;
  to: number;
  selectedText: string;
  selectedMarkdown: string;
};

type StreamDraft = {
  from: number;
  to: number;
  content: string;
};

type UseAiEditorActionsOptions = {
  editorRef: RefObject<TipTapEditor | null>;
  markdown: string;
  filePath: string | null;
  onAiLoadingChange?: (isLoading: boolean) => void;
  onAiPendingChange?: (isPending: boolean) => void;
};

/**
 * The whole AI feature of the editor: the rewrite/insert draft dialog, the
 * streaming into the document, the accept/discard/continue-editing diff review
 * and the grammar check. Owns aiStatus, which doubles as the editor's shared
 * feedback channel (dictation errors and image-insert errors write to it too,
 * via the returned setStatus).
 */
export function useAiEditorActions({
  editorRef,
  markdown,
  filePath,
  onAiLoadingChange,
  onAiPendingChange
}: UseAiEditorActionsOptions) {
  const { t } = useTranslation();
  const aiSettings = useAiSettingsStore((state) => state.settings);

  const [aiDraft, setAiDraft] = useState<AiDraft | null>(null);
  const [isAiLoading, setIsAiLoading] = useState(false);
  const [isAiDiffOpen, setIsAiDiffOpen] = useState(false);
  const [aiStatus, setAiStatus] = useState<AiStatus>(null);
  const [aiCheckIssues, setAiCheckIssues] = useState<AiCheckIssue[] | null>(null);
  const [aiCheckResolvedCount, setAiCheckResolvedCount] = useState(0);
  const [voiceStartRequestId, setVoiceStartRequestId] = useState(0);

  const aiStreamDraftRef = useRef<StreamDraft | null>(null);
  const aiDiffOriginalRef = useRef<{ from: number; to: number; text: string; markdown: string } | null>(null);
  const aiDiffLastResultRef = useRef<string | null>(null);
  const aiAbortControllerRef = useRef<AbortController | null>(null);
  const aiCheckRangeRef = useRef<{ from: number; to: number } | null>(null);

  // editorProps.handleKeyDown closes over the first render — like the other
  // shortcut handlers, this state has to be read through refs.
  const aiDraftOpenRef = useRef(false);
  aiDraftOpenRef.current = aiDraft !== null;
  const isAiLoadingRef = useRef(false);
  isAiLoadingRef.current = isAiLoading;

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

  // Switching to a different file must not leave a stale diff (and a
  // read-only editor) behind, nor let an in-flight AI request keep running
  // against this (about to be orphaned) editor instance: since rewrite no
  // longer dirties the document up front, App.tsx's unsaved-changes guard
  // can't rely on isDirty alone to block navigation here (see
  // onAiPendingChange above) — if navigation happens anyway, a request that
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filePath]);

  // Read through refs so the keymap/dictation closures (captured on first
  // render) still see the current values.
  const isDiffActive = () => aiDiffOriginalRef.current !== null;
  const isBusyForDictation = () =>
    aiDraftOpenRef.current || aiDiffOriginalRef.current !== null || isAiLoadingRef.current;

  return {
    aiDraft,
    isAiLoading,
    aiStatus,
    setAiStatus,
    aiCheckIssues,
    aiCheckResolvedCount,
    voiceStartRequestId,
    setVoiceStartRequestId,
    openAiDraftFromSelection,
    handleAiContextMenu,
    runAiDraft,
    closeAiDraft,
    runAiGrammarCheck,
    applyAiCheckIssue,
    applyAllAiCheckIssues,
    closeAiCheckDialog,
    cancelAiRequest,
    isDiffActive,
    isBusyForDictation
  };
}
