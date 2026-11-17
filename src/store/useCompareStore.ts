import { create } from "zustand";

import { compareTargetAfterSelection, compareTargetAfterTreeChange } from "@/lib/compareTarget";
import { useAppStore } from "@/store/useAppStore";

/**
 * "Open as reference": the note shown read-only beside the editor. Not persisted:
 * a comparison is something done now, and a pane that comes back on its own
 * next week reads as a layout bug. What is kept (localStorage, app-wide) is
 * how the pane looks: its width and whether the differences are marked,
 * which starts off, because a template and a filled-in copy differ almost
 * everywhere and a page of colour is no help until someone asks for it.
 */
export const COMPARE_PANE_MIN_WIDTH = 280;
export const COMPARE_PANE_DEFAULT_WIDTH = 480;

const HIGHLIGHT_STORAGE_KEY = "scribedog-compare-highlight";
const WIDTH_STORAGE_KEY = "scribedog-compare-width";

function readHighlight(): boolean {
  try {
    return window.localStorage.getItem(HIGHLIGHT_STORAGE_KEY) === "true";
  } catch {
    return false;
  }
}

function readWidth(): number {
  try {
    const value = Number(window.localStorage.getItem(WIDTH_STORAGE_KEY));

    return Number.isFinite(value) && value >= COMPARE_PANE_MIN_WIDTH ? value : COMPARE_PANE_DEFAULT_WIDTH;
  } catch {
    return COMPARE_PANE_DEFAULT_WIDTH;
  }
}

function store(key: string, value: string): void {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    // Without storage the choice simply lasts until the app closes.
  }
}

type CompareState = {
  filePath: string | null;
  highlight: boolean;
  width: number;
  open: (filePath: string) => void;
  close: () => void;
  setHighlight: (highlight: boolean) => void;
  setWidth: (width: number) => void;
};

export const useCompareStore = create<CompareState>((set) => ({
  filePath: null,
  highlight: typeof window === "undefined" ? false : readHighlight(),
  width: typeof window === "undefined" ? COMPARE_PANE_DEFAULT_WIDTH : readWidth(),
  open: (filePath) => set({ filePath }),
  close: () => set({ filePath: null }),
  setHighlight: (highlight) => {
    store(HIGHLIGHT_STORAGE_KEY, String(highlight));
    set({ highlight });
  },
  setWidth: (width) => {
    const next = Math.max(COMPARE_PANE_MIN_WIDTH, Math.round(width));
    store(WIDTH_STORAGE_KEY, String(next));
    set({ width: next });
  }
}));

// Follows the vault: see compareTarget.ts for the rules. Another vault
// closes the pane outright.
useAppStore.subscribe((state, previous) => {
  const { filePath } = useCompareStore.getState();

  if (filePath === null) {
    return;
  }

  let next: string | null = filePath;

  if (state.folderPath !== previous.folderPath) {
    next = null;
  } else {
    if (state.selectedFilePath !== previous.selectedFilePath) {
      next = compareTargetAfterSelection(next, previous.selectedFilePath, state.selectedFilePath);
    }

    if (state.filePaths !== previous.filePaths) {
      next = compareTargetAfterTreeChange(next, state.filePaths);
    }
  }

  if (next !== filePath) {
    useCompareStore.setState({ filePath: next });
  }
});
