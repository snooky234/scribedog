import { create } from "zustand";

import {
  parseStoredThemes,
  resolveTheme,
  serializeStoredThemes,
  themeBootInfo,
  themeStylesheet,
  type CustomTheme
} from "@/lib/theme/themeFormat";
import { isValidHexColor } from "@/lib/color";
import { findPresetTheme } from "@/lib/theme/presets";
import { applyAccentColor, useAccentColorStore } from "@/store/useAccentColorStore";

export const THEME_STORAGE_KEY = "scribedog-theme";
/** The user's custom themes, as theme documents (lib/theme/themeFormat.ts).
 *  A user setting, not a vault setting, so not in `.scribedog/`. */
export const CUSTOM_THEMES_STORAGE_KEY = "scribedog-custom-themes";
/** Mode and root background of the active custom theme, for
 *  public/theme-boot.js, which runs before the bundle and cannot derive. */
export const THEME_BOOT_STORAGE_KEY = "scribedog-theme-boot";
/** The accent colour the user picked for a shipped template, by preset id.
 *  The template itself stays read-only; only its accent can be swapped, so
 *  this is stored next to it instead of copying the template. */
export const PRESET_ACCENTS_STORAGE_KEY = "scribedog-preset-accents";

export const BUILT_IN_THEMES = ["light", "dark", "system"] as const;
export type BuiltInTheme = (typeof BUILT_IN_THEMES)[number];
export type CustomThemeKey = `custom:${string}`;
/** One of the shipped templates in lib/theme/presets.ts. */
export type PresetThemeKey = `preset:${string}`;
export type Theme = BuiltInTheme | CustomThemeKey | PresetThemeKey;
export type ResolvedTheme = "light" | "dark";

const CUSTOM_PREFIX = "custom:";
const PRESET_PREFIX = "preset:";

export function customThemeKey(id: string): CustomThemeKey {
  return `${CUSTOM_PREFIX}${id}`;
}

export function customThemeIdOf(theme: Theme): string | null {
  return theme.startsWith(CUSTOM_PREFIX) ? theme.slice(CUSTOM_PREFIX.length) : null;
}

export function presetThemeKey(id: string): PresetThemeKey {
  return `${PRESET_PREFIX}${id}`;
}

export function presetThemeIdOf(theme: Theme): string | null {
  return theme.startsWith(PRESET_PREFIX) ? theme.slice(PRESET_PREFIX.length) : null;
}

function readStorage(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeStorage(key: string, value: string | null): void {
  try {
    if (value === null) {
      window.localStorage.removeItem(key);
    } else {
      window.localStorage.setItem(key, value);
    }
  } catch {
    // localStorage may be unavailable in some environments.
  }
}

export type PresetAccents = Record<string, string>;

/** Known preset ids with a valid `#rrggbb` colour; anything else is dropped. */
function parsePresetAccents(raw: string | null): PresetAccents {
  if (!raw) {
    return {};
  }
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return {};
    }
    const result: PresetAccents = {};
    for (const [id, color] of Object.entries(parsed as Record<string, unknown>)) {
      if (typeof color === "string" && isValidHexColor(color) && findPresetTheme(id)) {
        result[id] = color.toLowerCase();
      }
    }
    return result;
  } catch {
    return {};
  }
}

/** The theme object behind a `custom:` or `preset:` key; null for the
 *  built-in light/dark/system and for a key whose theme is gone. A preset
 *  comes back with the user's accent for it, if there is one. */
function findCustomTheme(themes: CustomTheme[], theme: Theme, presetAccents: PresetAccents = {}): CustomTheme | null {
  const presetId = presetThemeIdOf(theme);
  if (presetId !== null) {
    const preset = findPresetTheme(presetId);
    const accent = presetAccents[presetId];
    return preset && accent ? { ...preset, base: { ...preset.base, accent } } : preset;
  }
  const id = customThemeIdOf(theme);
  return id === null ? null : (themes.find((entry) => entry.id === id) ?? null);
}

/** A stored `custom:<id>` or `preset:<id>` whose theme is gone falls back
 *  to "system". */
function sanitizeTheme(value: string | null, themes: CustomTheme[]): Theme {
  if (value === "light" || value === "dark" || value === "system") {
    return value;
  }
  if (value !== null && findCustomTheme(themes, value as Theme)) {
    return value as Theme;
  }
  return "system";
}

function getSystemTheme(): ResolvedTheme {
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

function resolveMode(theme: Theme, themes: CustomTheme[]): ResolvedTheme {
  const custom = findCustomTheme(themes, theme);
  if (custom) {
    return custom.mode;
  }
  return theme === "system" ? getSystemTheme() : (theme as ResolvedTheme);
}

// Mirrors the colours public/theme-boot.js paints before the bundle loads —
// keep both in sync with the --body-bg-end tokens.
const ROOT_BACKGROUNDS: Record<ResolvedTheme, string> = {
  light: "#e9edf0",
  dark: "#090a0c"
};

const THEME_STYLE_ID = "scribedog-custom-theme";

/** Names set inline on <html> by the last custom theme, so switching back to
 *  a built-in theme removes exactly those and lets tokens.css through again. */
let appliedVariables: string[] = [];

function clearCustomTheme(): void {
  const root = document.documentElement;
  for (const name of appliedVariables) {
    root.style.removeProperty(name);
  }
  appliedVariables = [];
  document.getElementById(THEME_STYLE_ID)?.remove();
}

/** What is on screen: a built-in mode or a custom theme. Used for the
 *  selected theme and, briefly, for "view in the app" in the builder. */
export type AppearanceTarget = ResolvedTheme | CustomTheme;

function applyAppearance(target: AppearanceTarget): void {
  const root = document.documentElement;
  clearCustomTheme();

  let mode: ResolvedTheme;
  let background: string;

  if (typeof target === "string") {
    mode = target;
    background = ROOT_BACKGROUNDS[mode];
    // Clearing took the accent ramp with it; the built-in themes wear the
    // accent colour setting.
    applyAccentColor(useAccentColorStore.getState().accentColor);
  } else {
    const resolved = resolveTheme(target);
    for (const [name, value] of Object.entries(resolved.root)) {
      root.style.setProperty(name, value);
    }
    appliedVariables = Object.keys(resolved.root);

    // The document colours and the paper sheet cannot come from <html>
    // (see themeStylesheet), so they get a generated stylesheet.
    const style = document.createElement("style");
    style.id = THEME_STYLE_ID;
    style.textContent = themeStylesheet(resolved);
    document.head.appendChild(style);

    mode = target.mode;
    background = resolved.root["--body-bg-end"];
  }

  root.classList.toggle("dark", mode === "dark");
  root.style.colorScheme = mode;
  root.style.backgroundColor = background;
}

function persistBootInfo(custom: CustomTheme | null): void {
  writeStorage(THEME_BOOT_STORAGE_KEY, custom ? JSON.stringify(themeBootInfo(custom)) : null);
}

type ThemeState = {
  theme: Theme;
  resolvedTheme: ResolvedTheme;
  customThemes: CustomTheme[];
  /** The user's accent per shipped template (see PRESET_ACCENTS_STORAGE_KEY). */
  presetAccents: PresetAccents;
  setTheme: (theme: Theme) => void;
  /** Adds the theme, or replaces the one with the same id. */
  saveCustomTheme: (theme: CustomTheme) => void;
  /** Removes the theme; if it was active, its mode's built-in theme takes over. */
  deleteCustomTheme: (id: string) => void;
  /** Swaps the accent of a shipped template; null restores its own. */
  setPresetAccent: (presetId: string, color: string | null) => void;
  /** Shows a theme without selecting it (the builder's "view in the app");
   *  null goes back to the selected one. Nothing is persisted. */
  previewAppearance: (target: AppearanceTarget | null) => void;
};

function applyState(theme: Theme, customThemes: CustomTheme[], presetAccents: PresetAccents): ResolvedTheme {
  const custom = findCustomTheme(customThemes, theme, presetAccents);
  const resolvedTheme = resolveMode(theme, customThemes);
  applyAppearance(custom ?? resolvedTheme);
  persistBootInfo(custom);
  return resolvedTheme;
}

const initialCustomThemes = parseStoredThemes(readStorage(CUSTOM_THEMES_STORAGE_KEY));
const initialPresetAccents = parsePresetAccents(readStorage(PRESET_ACCENTS_STORAGE_KEY));
const initialTheme = sanitizeTheme(readStorage(THEME_STORAGE_KEY), initialCustomThemes);

export const useThemeStore = create<ThemeState>((set, get) => ({
  theme: initialTheme,
  resolvedTheme: resolveMode(initialTheme, initialCustomThemes),
  customThemes: initialCustomThemes,
  presetAccents: initialPresetAccents,
  setTheme: (theme: Theme) => {
    const next = sanitizeTheme(theme, get().customThemes);
    writeStorage(THEME_STORAGE_KEY, next);
    const resolvedTheme = applyState(next, get().customThemes, get().presetAccents);
    set({ theme: next, resolvedTheme });
  },
  saveCustomTheme: (theme: CustomTheme) => {
    const current = get().customThemes;
    const exists = current.some((entry) => entry.id === theme.id);
    const customThemes = exists
      ? current.map((entry) => (entry.id === theme.id ? theme : entry))
      : [...current, theme];
    writeStorage(CUSTOM_THEMES_STORAGE_KEY, serializeStoredThemes(customThemes));

    const resolvedTheme = get().theme === customThemeKey(theme.id) ? applyState(get().theme, customThemes, get().presetAccents) : get().resolvedTheme;
    set({ customThemes, resolvedTheme });
  },
  deleteCustomTheme: (id: string) => {
    const deleted = get().customThemes.find((entry) => entry.id === id);
    const customThemes = get().customThemes.filter((entry) => entry.id !== id);
    writeStorage(CUSTOM_THEMES_STORAGE_KEY, serializeStoredThemes(customThemes));
    set({ customThemes });

    if (deleted && get().theme === customThemeKey(id)) {
      get().setTheme(deleted.mode);
    }
  },
  setPresetAccent: (presetId: string, color: string | null) => {
    const preset = findPresetTheme(presetId);
    if (!preset || (color !== null && !isValidHexColor(color))) {
      return;
    }
    const presetAccents = { ...get().presetAccents };
    // The template's own colour is not an override, so it is not stored.
    if (color === null || color.toLowerCase() === preset.base.accent.toLowerCase()) {
      delete presetAccents[presetId];
    } else {
      presetAccents[presetId] = color.toLowerCase();
    }
    writeStorage(
      PRESET_ACCENTS_STORAGE_KEY,
      Object.keys(presetAccents).length > 0 ? JSON.stringify(presetAccents) : null
    );
    set({ presetAccents });
    if (get().theme === presetThemeKey(presetId)) {
      applyState(get().theme, get().customThemes, presetAccents);
    }
  },
  previewAppearance: (target: AppearanceTarget | null) => {
    if (target === null) {
      applyState(get().theme, get().customThemes, get().presetAccents);
    } else {
      applyAppearance(target);
    }
  }
}));

applyState(
  useThemeStore.getState().theme,
  useThemeStore.getState().customThemes,
  useThemeStore.getState().presetAccents
);

if (typeof window !== "undefined" && window.matchMedia) {
  window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => {
    if (useThemeStore.getState().theme !== "system") {
      return;
    }

    const resolvedTheme = getSystemTheme();
    applyAppearance(resolvedTheme);
    useThemeStore.setState({ resolvedTheme });
  });
}
