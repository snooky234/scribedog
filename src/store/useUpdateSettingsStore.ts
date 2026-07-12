import { create } from "zustand";

export const CHECK_FOR_UPDATES_STORAGE_KEY = "scribedog-check-for-updates";

function getStoredCheckForUpdates(): boolean {
  try {
    const stored = window.localStorage.getItem(CHECK_FOR_UPDATES_STORAGE_KEY);
    return stored === null ? true : stored === "true";
  } catch {
    return true;
  }
}

function persistCheckForUpdates(value: boolean): void {
  try {
    window.localStorage.setItem(CHECK_FOR_UPDATES_STORAGE_KEY, String(value));
  } catch {
    // localStorage may be unavailable in some environments.
  }
}

type UpdateSettingsState = {
  checkForUpdatesEnabled: boolean;
  setCheckForUpdatesEnabled: (enabled: boolean) => void;
};

export const useUpdateSettingsStore = create<UpdateSettingsState>((set) => ({
  checkForUpdatesEnabled: getStoredCheckForUpdates(),
  setCheckForUpdatesEnabled: (enabled: boolean) => {
    persistCheckForUpdates(enabled);
    set({ checkForUpdatesEnabled: enabled });
  }
}));
