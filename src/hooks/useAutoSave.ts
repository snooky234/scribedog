import { useEffect, useRef } from "react";

import { useAppStore } from "@/store/useAppStore";
import { useEditorSettingsStore } from "@/store/useEditorSettingsStore";

/**
 * Pause in typing after which the open note is written. Long enough that a
 * pause between two words does not already count, short enough that the
 * status flips to "saved" soon after the hands leave the keys. A remote or
 * synced vault pays one request per write, which is why this is not shorter.
 */
export const AUTO_SAVE_DELAY_MS = 1_000;

/**
 * Longest a change stays unsaved while typing goes on without a pause. Every
 * keystroke restarts the pause timer, so without this ceiling a long stretch
 * of uninterrupted writing would sit entirely in memory. The save does not
 * block the editor, so it is not noticeable mid-sentence.
 */
export const AUTO_SAVE_MAX_WAIT_MS = 30_000;

type UseAutoSaveOptions = {
  /**
   * An AI request is streaming into the document. Its tokens arrive as
   * ordinary edits, but nothing of it is meant to be on disk before the user
   * has accepted it.
   */
  isAiActionPending: boolean;
  /**
   * The open note has a staged proposal and the editor shows it as a locked
   * review. The document is not the user's text right now, and the baseline
   * the proposal was computed against must not move under it.
   */
  isSelectedFileStaged: boolean;
  /**
   * The file was removed outside the app while it was open. Recreating it
   * silently would undo what the user did in the file manager; that save
   * stays a decision.
   */
  isSelectedFileMissing: boolean;
};

/**
 * Saves the open note on its own once typing has paused, when the setting is
 * on. Goes through saveSelectedFile like Ctrl+S, so versioning, image cleanup
 * and the tree update happen the same way; the "auto" trigger only tells the
 * version history to take its snapshot when the note is left.
 *
 * Keyed on the content rather than on isDirty: every keystroke restarts the
 * timer, so the write lands after the pause, not one second into it. The
 * first unsaved keystroke also starts the max-wait clock, which the pause
 * timer is capped by.
 */
export function useAutoSave({
  isAiActionPending,
  isSelectedFileStaged,
  isSelectedFileMissing
}: UseAutoSaveOptions): void {
  const autoSaveEnabled = useEditorSettingsStore((state) => state.autoSaveEnabled);
  const selectedFilePath = useAppStore((state) => state.selectedFilePath);
  const selectedFileContent = useAppStore((state) => state.selectedFileContent);
  const isDirty = useAppStore((state) => state.isDirty);
  const isSaving = useAppStore((state) => state.isSaving);

  // When the current run of unsaved edits began, per note. Cleared once a
  // save starts, so edits typed during the write start a fresh clock rather
  // than an expired one that would fire on every keystroke.
  const dirtySinceRef = useRef<{ filePath: string; at: number } | null>(null);

  useEffect(() => {
    if (!isDirty || !selectedFilePath || isSaving) {
      dirtySinceRef.current = null;
      return;
    }

    if (dirtySinceRef.current?.filePath !== selectedFilePath) {
      dirtySinceRef.current = { filePath: selectedFilePath, at: Date.now() };
    }

    if (
      !autoSaveEnabled ||
      selectedFileContent === null ||
      isAiActionPending ||
      isSelectedFileStaged ||
      isSelectedFileMissing
    ) {
      return;
    }

    const untilMaxWait = Math.max(
      0,
      dirtySinceRef.current.at + AUTO_SAVE_MAX_WAIT_MS - Date.now()
    );
    const delay = Math.min(AUTO_SAVE_DELAY_MS, untilMaxWait);

    const timer = window.setTimeout(() => {
      const state = useAppStore.getState();

      // Re-checked at fire time: the timer outlives a note switch by design
      // (cleanup only cancels it), but a save must never hit a different
      // note than the edits it was scheduled for.
      if (
        state.selectedFilePath !== selectedFilePath ||
        !state.isDirty ||
        state.isSaving ||
        state.saveError
      ) {
        return;
      }

      void state.saveSelectedFile({ trigger: "auto" });
    }, delay);

    return () => window.clearTimeout(timer);
  }, [
    autoSaveEnabled,
    selectedFilePath,
    selectedFileContent,
    isDirty,
    isSaving,
    isAiActionPending,
    isSelectedFileStaged,
    isSelectedFileMissing
  ]);
}
