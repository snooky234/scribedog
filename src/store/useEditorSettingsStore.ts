import { create } from "zustand";

export const SPELLCHECK_STORAGE_KEY = "scribedog-spellcheck-enabled";
export const ZOOM_STORAGE_KEY = "scribedog-zoom-level";

// Zoom level is an offset in percent relative to normal size (0 = 100%).
export const ZOOM_MIN = -30;
export const ZOOM_MAX = 50;
export const ZOOM_STEP = 10;

export function clampZoomLevel(level: number): number {
  const stepped = Math.round(level / ZOOM_STEP) * ZOOM_STEP;
  return Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, stepped));
}

function getStoredZoomLevel(): number {
  try {
    const raw = window.localStorage.getItem(ZOOM_STORAGE_KEY);
    const parsed = raw === null ? Number.NaN : Number.parseInt(raw, 10);
    return Number.isFinite(parsed) ? clampZoomLevel(parsed) : 0;
  } catch {
    return 0;
  }
}

function persistZoomLevel(level: number): void {
  try {
    window.localStorage.setItem(ZOOM_STORAGE_KEY, String(level));
  } catch {
    // localStorage may be unavailable in some environments.
  }
}

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
  zoomLevel: number;
  setZoomLevel: (level: number) => void;
};

export const useEditorSettingsStore = create<EditorSettingsState>((set) => ({
  spellcheckEnabled: getStoredSpellcheckEnabled(),
  setSpellcheckEnabled: (enabled: boolean) => {
    persistSpellcheckEnabled(enabled);
    set({ spellcheckEnabled: enabled });
  },
  zoomLevel: getStoredZoomLevel(),
  setZoomLevel: (level: number) => {
    const clamped = clampZoomLevel(level);
    persistZoomLevel(clamped);
    set({ zoomLevel: clamped });
  }
}));
