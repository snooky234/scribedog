import { useEffect } from "react";
import type { RefObject } from "react";

import type { EditorHandle } from "@/components/Editor";
import { couldBeShortcut } from "@/lib/shortcuts/binding";
import { isRetiredDefault, matchShortcut } from "@/lib/shortcuts/resolve";
import { useChatStore } from "@/store/useChatStore";
import { ZOOM_STEP, useEditorSettingsStore } from "@/store/useEditorSettingsStore";
import { useSearchStore } from "@/store/useSearchStore";
import { useShortcutsStore } from "@/store/useShortcutsStore";

type UseGlobalShortcutsOptions = {
  selectedFilePath: string | null;
  saveSelectedFile: () => Promise<boolean>;
  openFolderSafely: () => Promise<void>;
  createFile: () => Promise<void> | void;
  showShortcuts: () => void;
  toggleZenMode: () => void;
  navigateBack: () => void;
  navigateForward: () => void;
  editorHandleRef: RefObject<EditorHandle | null>;
};

export function useGlobalShortcuts({
  selectedFilePath,
  saveSelectedFile,
  openFolderSafely,
  createFile,
  showShortcuts,
  toggleZenMode,
  navigateBack,
  navigateForward,
  editorHandleRef
}: UseGlobalShortcutsOptions): void {
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (!couldBeShortcut(event)) {
        return;
      }

      // Read through getState() so a rebind takes effect without tearing down
      // and re-registering the listener.
      const { overrides } = useShortcutsStore.getState();
      const action = matchShortcut(overrides, event, "global");

      if (!action) {
        // A combo the user moved away from must not fall back to whatever the
        // webview would do with it (Ctrl+P, Ctrl+F, browser zoom).
        if (isRetiredDefault(overrides, event, "global")) {
          event.preventDefault();
        }

        return;
      }

      event.preventDefault();

      switch (action) {
        case "saveFile":
          if (selectedFilePath) {
            void saveSelectedFile();
          }

          return;
        case "openFolder":
          void openFolderSafely();
          return;
        case "newFile":
          void createFile();
          return;
        case "printFile":
          if (selectedFilePath) {
            editorHandleRef.current?.printDocument();
          }

          return;
        case "findReplace":
          // The panel lives inside the editor, so it only makes sense with a
          // document open.
          if (selectedFilePath) {
            useSearchStore.getState().openPanel();
          }

          return;
        case "zenMode":
          toggleZenMode();
          return;
        case "navigateBack":
          navigateBack();
          return;
        case "navigateForward":
          navigateForward();
          return;
        case "toggleChat":
          useChatStore.getState().togglePanel();
          return;
        case "toggleDetailsPanel": {
          // The panel shows details of the current file, so it only makes
          // sense with a document open.
          if (selectedFilePath) {
            const { detailsPanelVisible, setDetailsPanelVisible } =
              useEditorSettingsStore.getState();
            setDetailsPanelVisible(!detailsPanelVisible);
          }

          return;
        }
        case "toggleSpellcheck": {
          const { spellcheckEnabled, setSpellcheckEnabled } = useEditorSettingsStore.getState();
          setSpellcheckEnabled(!spellcheckEnabled);
          return;
        }
        case "zoomIn": {
          const { zoomLevel, setZoomLevel } = useEditorSettingsStore.getState();
          setZoomLevel(zoomLevel + ZOOM_STEP);
          return;
        }
        case "zoomOut": {
          const { zoomLevel, setZoomLevel } = useEditorSettingsStore.getState();
          setZoomLevel(zoomLevel - ZOOM_STEP);
          return;
        }
        case "zoomReset":
          useEditorSettingsStore.getState().setZoomLevel(0);
          return;
        case "shortcutsOverview":
          showShortcuts();
          return;
        default:
          return;
      }
    };

    window.addEventListener("keydown", handleKeyDown);

    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [
    saveSelectedFile,
    selectedFilePath,
    openFolderSafely,
    createFile,
    showShortcuts,
    toggleZenMode,
    navigateBack,
    navigateForward,
    editorHandleRef
  ]);
}
