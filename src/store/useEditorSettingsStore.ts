import { create } from "zustand";

export const SPELLCHECK_STORAGE_KEY = "scribedog-spellcheck-enabled";
export const ZOOM_STORAGE_KEY = "scribedog-zoom-level";
export const ZEN_WIDTH_STORAGE_KEY = "scribedog-zen-width";

// Zoom level is an offset in percent relative to normal size (0 = 100%).
export const ZOOM_MIN = -30;
export const ZOOM_MAX = 50;
export const ZOOM_STEP = 10;

// Zen-mode text-column width in pixels. Applies only to Zen mode; normal
// editing keeps its own layout.
export const ZEN_WIDTH_MIN = 360;
export const ZEN_WIDTH_MAX = 1400;
export const ZEN_WIDTH_DEFAULT = 760;
export const ZEN_WIDTH_STEP = 40;

export function clampZoomLevel(level: number): number {
  const stepped = Math.round(level / ZOOM_STEP) * ZOOM_STEP;
  return Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, stepped));
}

export function clampZenWidth(width: number): number {
  return Math.min(ZEN_WIDTH_MAX, Math.max(ZEN_WIDTH_MIN, Math.round(width)));
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

function getStoredZenWidth(): number {
  try {
    const raw = window.localStorage.getItem(ZEN_WIDTH_STORAGE_KEY);
    const parsed = raw === null ? Number.NaN : Number.parseInt(raw, 10);
    return Number.isFinite(parsed) ? clampZenWidth(parsed) : ZEN_WIDTH_DEFAULT;
  } catch {
    return ZEN_WIDTH_DEFAULT;
  }
}

function persistZenWidth(width: number): void {
  try {
    window.localStorage.setItem(ZEN_WIDTH_STORAGE_KEY, String(width));
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
  zenWidth: number;
  setZenWidth: (width: number) => void;
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
  },
  zenWidth: getStoredZenWidth(),
  setZenWidth: (width: number) => {
    const clamped = clampZenWidth(width);
    persistZenWidth(clamped);
    set({ zenWidth: clamped });
  }
}));
