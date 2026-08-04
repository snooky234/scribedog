import { create } from "zustand";

import { buildAccentPalette, isValidHexColor } from "@/lib/color";

export const ACCENT_COLOR_STORAGE_KEY = "scribedog-accent-color";
export const DEFAULT_ACCENT_COLOR = "#a855f7";

/** Maps a palette shade to the CSS custom property it drives — every
 *  stylesheet reads these instead of a hardcoded violet triplet. */
const ACCENT_CSS_VARS: Record<string, string> = {
  base: "--accent-rgb",
  pale: "--accent-pale-rgb",
  lighter: "--accent-lighter-rgb",
  light: "--accent-light-rgb",
  dark: "--accent-dark-rgb",
  darker: "--accent-darker-rgb",
  darkest: "--accent-darkest-rgb"
};

function getStoredAccentColor(): string {
  try {
    const stored = window.localStorage.getItem(ACCENT_COLOR_STORAGE_KEY);
    return stored && isValidHexColor(stored) ? stored : DEFAULT_ACCENT_COLOR;
  } catch {
    return DEFAULT_ACCENT_COLOR;
  }
}

function persistAccentColor(color: string): void {
  try {
    window.localStorage.setItem(ACCENT_COLOR_STORAGE_KEY, color);
  } catch {
    // localStorage may be unavailable in some environments.
  }
}

function applyAccentColor(color: string): void {
  const palette = buildAccentPalette(color);
  if (!palette) {
    return;
  }

  const root = document.documentElement.style;
  for (const [shade, cssVar] of Object.entries(ACCENT_CSS_VARS)) {
    root.setProperty(cssVar, palette[shade as keyof typeof palette]);
  }
}

type AccentColorState = {
  accentColor: string;
  setAccentColor: (color: string) => void;
  resetAccentColor: () => void;
};

const initialAccentColor = getStoredAccentColor();

export const useAccentColorStore = create<AccentColorState>((set) => ({
  accentColor: initialAccentColor,
  setAccentColor: (color: string) => {
    if (!isValidHexColor(color)) {
      return;
    }
    persistAccentColor(color);
    applyAccentColor(color);
    set({ accentColor: color });
  },
  resetAccentColor: () => {
    persistAccentColor(DEFAULT_ACCENT_COLOR);
    applyAccentColor(DEFAULT_ACCENT_COLOR);
    set({ accentColor: DEFAULT_ACCENT_COLOR });
  }
}));

applyAccentColor(useAccentColorStore.getState().accentColor);
