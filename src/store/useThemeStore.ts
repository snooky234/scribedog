import { create } from "zustand";

export const THEME_STORAGE_KEY = "scribedog-theme";
export const THEMES = ["light", "dark", "system"] as const;
export type Theme = (typeof THEMES)[number];
export type ResolvedTheme = "light" | "dark";

function isTheme(value: string | null): value is Theme {
  return value !== null && (THEMES as readonly string[]).includes(value);
}

function getStoredTheme(): Theme {
  try {
    const stored = window.localStorage.getItem(THEME_STORAGE_KEY);
    return isTheme(stored) ? stored : "system";
  } catch {
    return "system";
  }
}

function persistTheme(theme: Theme): void {
  try {
    window.localStorage.setItem(THEME_STORAGE_KEY, theme);
  } catch {
    // localStorage may be unavailable in some environments.
  }
}

function getSystemTheme(): ResolvedTheme {
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

function resolveTheme(theme: Theme): ResolvedTheme {
  return theme === "system" ? getSystemTheme() : theme;
}

function applyResolvedTheme(resolvedTheme: ResolvedTheme): void {
  document.documentElement.classList.toggle("dark", resolvedTheme === "dark");
  document.documentElement.style.colorScheme = resolvedTheme;
}

type ThemeState = {
  theme: Theme;
  resolvedTheme: ResolvedTheme;
  setTheme: (theme: Theme) => void;
};

const initialTheme = getStoredTheme();

export const useThemeStore = create<ThemeState>((set) => ({
  theme: initialTheme,
  resolvedTheme: resolveTheme(initialTheme),
  setTheme: (theme: Theme) => {
    persistTheme(theme);
    const resolvedTheme = resolveTheme(theme);
    applyResolvedTheme(resolvedTheme);
    set({ theme, resolvedTheme });
  }
}));

applyResolvedTheme(useThemeStore.getState().resolvedTheme);

if (typeof window !== "undefined" && window.matchMedia) {
  window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => {
    if (useThemeStore.getState().theme !== "system") {
      return;
    }

    const resolvedTheme = getSystemTheme();
    applyResolvedTheme(resolvedTheme);
    useThemeStore.setState({ resolvedTheme });
  });
}
