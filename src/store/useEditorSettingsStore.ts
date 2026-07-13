import { create } from "zustand";

export const SPELLCHECK_STORAGE_KEY = "scribedog-spellcheck-enabled";

function getStoredSpellcheckEnabled(): boolean {
  try {
    return window.localStorage.getItem(SPELLCHECK_STORAGE_KEY) === "true";
  } catch {
    return false;
  }
}

function persistSpellcheckEnabled(enabled: boolean): void {
  try {
    window.localStorage.setItem(SPELLCHECK_STORAGE_KEY, String(enabled));
  } catch {
    // localStorage may be unavailable in some environments.
  }
}

type EditorSettingsState = {
  spellcheckEnabled: boolean;
  setSpellcheckEnabled: (enabled: boolean) => void;
};

export const useEditorSettingsStore = create<EditorSettingsState>((set) => ({
  spellcheckEnabled: getStoredSpellcheckEnabled(),
  setSpellcheckEnabled: (enabled: boolean) => {
    persistSpellcheckEnabled(enabled);
    set({ spellcheckEnabled: enabled });
  }
}));
