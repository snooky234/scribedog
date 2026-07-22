import { useEffect, useRef, type RefObject } from "react";
import { useTranslation } from "react-i18next";

import type { Editor as TipTapEditor } from "@tiptap/react";

import { useVoiceInput } from "@/hooks/useVoiceInput";
import { updateVoiceInsertWidget } from "@/lib/voiceInsertWidget";

import type { AiStatus } from "./useAiEditorActions";

type UseEditorDictationOptions = {
  editorRef: RefObject<TipTapEditor | null>;
  setStatus: (status: AiStatus) => void;
  // Dictation shares the read-only state with the diff review; while a diff is
  // active it must not lift setEditable, and it can't be started at all while
  // any AI flow is busy.
  isDiffActive: () => boolean;
  isBusyForDictation: () => boolean;
};

/**
 * Ctrl+Shift+W dictation into the document (issue #7): parks the editor in
 * read-only mode with an insertion marker while recording, and inserts the
 * transcript at the cursor as one atomic undo step.
 */
export function useEditorDictation({
  editorRef,
  setStatus,
  isDiffActive,
  isBusyForDictation
}: UseEditorDictationOptions) {
  const { t } = useTranslation();

  const dictation = useVoiceInput({
    onTranscript: (text) => {
      // Re-enable typing before inserting; the chain leaves the caret at the
      // end of the inserted text.
      editorRef.current?.setEditable(true, false);
      editorRef.current?.chain().focus().insertContent(text).run();
    },
    onError: (message) => {
      setStatus({ kind: "error", message: t("voice.error", { error: message }) });
    }
  });
  const dictationRef = useRef(dictation);
  dictationRef.current = dictation;

  const toggleDictation = () => {
    // While the AI dialog or a diff review is open, dictation into the
    // document would fight with those flows — the dialog has its own mic.
    if (isBusyForDictation()) {
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

      if (!isDiffActive()) {
        currentEditor.setEditable(true, false);
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dictation.status]);

  return { dictation, toggleDictation };
}
