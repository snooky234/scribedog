import { useEffect } from "react";
import type { RefObject } from "react";

import type { EditorHandle } from "@/components/Editor";
import { ZOOM_STEP, useEditorSettingsStore } from "@/store/useEditorSettingsStore";

type UseGlobalShortcutsOptions = {
  selectedFilePath: string | null;
  saveSelectedFile: () => Promise<boolean>;
  openFolderSafely: () => Promise<void>;
  createFile: () => Promise<void> | void;
  showShortcuts: () => void;
  editorHandleRef: RefObject<EditorHandle | null>;
};

export function useGlobalShortcuts({
  selectedFilePath,
  saveSelectedFile,
  openFolderSafely,
  createFile,
  showShortcuts,
  editorHandleRef
}: UseGlobalShortcutsOptions): void {
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (!(event.ctrlKey || event.metaKey)) {
        return;
      }

      const key = event.key.toLowerCase();

      // Toggle spellcheck (red squiggly underlines): Ctrl+Alt+Shift+X.
      // event.code covers layouts where Alt+X yields a dead/composed key.
      if (event.altKey && event.shiftKey && (key === "x" || event.code === "KeyX")) {
        event.preventDefault();
        const { spellcheckEnabled, setSpellcheckEnabled } = useEditorSettingsStore.getState();
        setSpellcheckEnabled(!spellcheckEnabled);
        return;
      }

      if (key === "s") {
        event.preventDefault();

        if (selectedFilePath) {
          void saveSelectedFile();
        }

        return;
      }

      if (key === "o" && !event.shiftKey) {
        event.preventDefault();
        void openFolderSafely();
        return;
      }

      // Browser-style zoom: Ctrl+Plus / Ctrl+Minus / Ctrl+0. "=" covers
      // layouts where Plus is the shifted key on "=".
      if (key === "+" || key === "=") {
        event.preventDefault();
        const { zoomLevel, setZoomLevel } = useEditorSettingsStore.getState();
        setZoomLevel(zoomLevel + ZOOM_STEP);
        return;
      }

      if (key === "-") {
        event.preventDefault();
        const { zoomLevel, setZoomLevel } = useEditorSettingsStore.getState();
        setZoomLevel(zoomLevel - ZOOM_STEP);
        return;
      }

      if (key === "0") {
        event.preventDefault();
        useEditorSettingsStore.getState().setZoomLevel(0);
        return;
      }

      if (key === "n") {
        event.preventDefault();
        void createFile();
        return;
      }

      if (key === "p") {
        event.preventDefault();

        if (selectedFilePath) {
          editorHandleRef.current?.printDocument();
        }

        return;
      }

      if (key === "#" || event.code === "Backslash") {
        event.preventDefault();
        showShortcuts();
      }
    };

    window.addEventListener("keydown", handleKeyDown);

    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [saveSelectedFile, selectedFilePath, openFolderSafely, createFile, showShortcuts, editorHandleRef]);
}
