/**
 * Derives a theme's complete set of CSS custom properties from a handful of
 * base colours plus a light/dark mode.
 *
 * The built-in light and dark palettes in src/styles/tokens.css stay the
 * source of truth for the two default themes; this module is what a custom
 * theme is resolved with. Each derived token is described as a step away
 * from one base colour, and the size of that step is measured on the
 * built-in palette of the same mode (the `reference` value). Deriving from
 * the default base colours therefore reproduces tokens.css (derive.test.ts
 * checks exactly that), and deriving from other base colours keeps every
 * hover, active, selection and backdrop at the same perceptual distance
 * from its base as in the built-in themes.
 */

import { buildAccentPalette, hexToRgb, rgbToHex, type Rgb } from "@/lib/color";

import { oklabToRgb, parseCssColor, rgbToOklab, type Oklab } from "./oklab";

export type ThemeMode = "light" | "dark";

export const BASE_COLOR_KEYS = [
  "background",
  "surface",
  "text",
  "muted",
  "chrome",
  "accent"
] as const;

export type BaseColorKey = (typeof BASE_COLOR_KEYS)[number];

/** The colours a theme is built from, each as `#rrggbb`:
 *  - background: the window behind the panels (top of the body gradient)
 *  - surface: panels, sidebar, editor, dialogs
 *  - text: body text; also the light theme's overlay and shadow tone
 *  - muted: secondary text, hints, meta lines
 *  - chrome: scrollbars and the tint of hover, active and selection
 *  - accent: AI buttons, links, active markers (the whole accent ramp) */
export type ThemeBaseColors = Record<BaseColorKey, string>;

/** The base colours the built-in themes are made of (read off tokens.css). */
export const DEFAULT_BASE_COLORS: Record<ThemeMode, ThemeBaseColors> = {
  light: {
    background: "#eff3f6",
    surface: "#ffffff",
    text: "#0f172a",
    muted: "#64748b",
    chrome: "#767a7f",
    accent: "#a855f7"
  },
  dark: {
    background: "#111214",
    surface: "#18181a",
    text: "#e2e8f0",
    muted: "#94a3b8",
    chrome: "#a0a0a4",
    accent: "#a855f7"
  }
};

/** The "Advanced" colours. Each one is optional in a theme: left out, the
 *  tokens it drives keep the built-in theme's values for the mode verbatim. */
export const ADVANCED_COLOR_KEYS = [
  "error",
  "success",
  "warning",
  "info",
  "marker",
  "findMatch",
  "findCurrent",
  "diffRemoved",
  "diffAdded",
  "codeComment",
  "codeKeyword",
  "codeString",
  "codeNumber",
  "codeFunction",
  "codeType",
  "codeVariable"
] as const;

export type AdvancedColorKey = (typeof ADVANCED_COLOR_KEYS)[number];
export type ThemeAdvancedColors = Partial<Record<AdvancedColorKey, string>>;

/** What each advanced colour stands for in the built-in themes: the
 *  Tailwind 500 step for the status roles, the literal colour elsewhere. */
export const DEFAULT_ADVANCED_COLORS: Record<ThemeMode, Record<AdvancedColorKey, string>> = {
  light: {
    error: "#ef4444",
    success: "#22c55e",
    warning: "#eab308",
    info: "#3b82f6",
    marker: "#fde047",
    findMatch: "#facc15",
    findCurrent: "#f97316",
    diffRemoved: "#dc2626",
    diffAdded: "#16a34a",
    codeComment: "#94a3b8",
    codeKeyword: "#c4b5fd",
    codeString: "#86efac",
    codeNumber: "#fdba74",
    codeFunction: "#93c5fd",
    codeType: "#67e8f9",
    codeVariable: "#f0abfc"
  },
  dark: {
    error: "#ef4444",
    success: "#22c55e",
    warning: "#eab308",
    info: "#3b82f6",
    marker: "#ca8a04",
    findMatch: "#facc15",
    findCurrent: "#f97316",
    diffRemoved: "#f87171",
    diffAdded: "#4ade80",
    codeComment: "#7c8798",
    codeKeyword: "#b3a2f7",
    codeString: "#7ddba4",
    codeNumber: "#f0ad76",
    codeFunction: "#85b8f5",
    codeType: "#63d5e6",
    codeVariable: "#e39cf0"
  }
};

/** The "paper" surface inside a dark UI (tokens.css): a page colour and the
 *  text on it. Everything else on the page follows the light defaults. */
export type ThemePaperColors = { background: string; text: string };

export const DEFAULT_PAPER_COLORS: ThemePaperColors = {
  background: DEFAULT_BASE_COLORS.light.surface,
  text: DEFAULT_BASE_COLORS.light.text
};

/** Zen mode's own page: background and text, both optional as a pair. */
export type ThemeZenColors = { background: string; text: string };

/** Whether a colour reads as a dark page, which decides the direction a
 *  palette built on it is derived in (Zen mode picks its own). */
export function isDarkColor(hex: string): boolean {
  return toOklab(hex).l < 0.6;
}

type ColorKey = BaseColorKey | AdvancedColorKey;

type OutputFormat = "triplet" | "hex" | "css" | "rgba";

type Rule = {
  /** The colour the token starts from: its lightness plus the step. */
  from: ColorKey;
  /** The token's value in the built-in theme of this mode. The lightness
   *  step is `reference - from` on the default colours, and the
   *  reference's alpha is carried over. */
  reference: string;
  /** A second colour the hue is pulled toward, by `pull` (0–1). This is how
   *  hover/active/selection pick up the chrome colour's tint. */
  tint?: ColorKey;
  pull?: number;
  /** Multiplier on the result's chroma; 0 yields a neutral gray. */
  chroma?: number;
  /** Take chroma and hue relative too: scale the chroma and turn the hue the
   *  way the reference does against its default source. How a pale status
   *  panel or a dark message text follows one picked status colour. */
  relative?: boolean;
};

type DerivedToken = { format: OutputFormat; light: Rule; dark: Rule };

/** Chrome pull shared by the surface steps. Fitted so the light theme's
 *  slate hover/active rows come out exactly; the dark surfaces are neutral,
 *  where the pull makes no visible difference. */
const RAISED_PULL = 0.078;
const HOVER_PULL = 0.272;
const ACTIVE_PULL = 0.575;
const BODY_END_PULL = 0.018;

const DERIVED_TOKENS: Record<string, DerivedToken> = {
  "--text-rgb": {
    format: "triplet",
    light: { from: "text", reference: "15, 23, 42" },
    dark: { from: "text", reference: "226, 232, 240" }
  },
  "--muted-rgb": {
    format: "triplet",
    light: { from: "muted", reference: "100, 116, 139" },
    dark: { from: "muted", reference: "148, 163, 184" }
  },
  "--surface-rgb": {
    format: "triplet",
    light: { from: "surface", reference: "255, 255, 255" },
    dark: { from: "surface", reference: "24, 24, 26" }
  },
  "--chrome-rgb": {
    format: "triplet",
    light: { from: "chrome", reference: "118, 122, 127" },
    dark: { from: "chrome", reference: "160, 160, 164" }
  },
  "--body-bg-start": {
    format: "hex",
    light: { from: "background", reference: "#eff3f6" },
    dark: { from: "background", reference: "#111214" }
  },
  "--body-bg-end": {
    format: "hex",
    light: { from: "background", reference: "#e9edf0", tint: "chrome", pull: BODY_END_PULL },
    dark: { from: "background", reference: "#090a0c", tint: "chrome", pull: BODY_END_PULL }
  },
  // Faint borders and washes: the text colour in light mode, pure white on
  // dark, where a tinted overlay reads dirty.
  "--overlay-rgb": {
    format: "triplet",
    light: { from: "text", reference: "15, 23, 42" },
    dark: { from: "text", reference: "255, 255, 255", chroma: 0 }
  },
  "--shadow-rgb": {
    format: "triplet",
    light: { from: "text", reference: "15, 23, 42" },
    dark: { from: "text", reference: "0, 0, 0", chroma: 0 }
  },
  "--surface-raised-rgb": {
    format: "triplet",
    light: { from: "surface", reference: "249, 250, 250", tint: "chrome", pull: RAISED_PULL },
    dark: { from: "surface", reference: "28, 28, 30", tint: "chrome", pull: RAISED_PULL }
  },
  "--surface-strong-rgb": {
    format: "triplet",
    light: { from: "surface", reference: "255, 255, 255" },
    dark: { from: "surface", reference: "18, 18, 20" }
  },
  "--surface-hover-rgb": {
    format: "triplet",
    light: { from: "surface", reference: "231, 233, 234", tint: "chrome", pull: HOVER_PULL },
    dark: { from: "surface", reference: "34, 34, 36", tint: "chrome", pull: HOVER_PULL }
  },
  "--surface-active-rgb": {
    format: "triplet",
    light: { from: "surface", reference: "208, 210, 213", tint: "chrome", pull: ACTIVE_PULL },
    dark: { from: "surface", reference: "42, 42, 44", tint: "chrome", pull: ACTIVE_PULL }
  },
  "--selection-rgb": {
    format: "triplet",
    light: { from: "chrome", reference: "83, 91, 102", tint: "muted", pull: 0.362 },
    dark: { from: "chrome", reference: "160, 160, 164" }
  },
  "--backdrop-rgb": {
    format: "triplet",
    light: { from: "background", reference: "94, 110, 132", tint: "muted", pull: 1 },
    dark: { from: "background", reference: "6, 8, 11", tint: "muted", pull: 0.084 }
  },

  // shadcn/ui tokens (src/components/ui/, the base layer in App.css). The
  // built-in values are neutral grays; derived ones keep the base colour's
  // hue, so a warm theme does not get cold gray buttons.
  "--background": {
    format: "css",
    light: { from: "surface", reference: "oklch(1 0 0)" },
    dark: { from: "background", reference: "oklch(0.145 0 0)" }
  },
  "--foreground": {
    format: "css",
    light: { from: "text", reference: "oklch(0.145 0 0)" },
    dark: { from: "text", reference: "oklch(0.985 0 0)" }
  },
  "--popover": {
    format: "css",
    light: { from: "surface", reference: "oklch(1 0 0)" },
    dark: { from: "surface", reference: "oklch(0.205 0 0)" }
  },
  "--popover-foreground": {
    format: "css",
    light: { from: "text", reference: "oklch(0.145 0 0)" },
    dark: { from: "text", reference: "oklch(0.985 0 0)" }
  },
  "--primary": {
    format: "css",
    light: { from: "text", reference: "oklch(0.205 0 0)" },
    dark: { from: "text", reference: "oklch(0.922 0 0)" }
  },
  "--primary-foreground": {
    format: "css",
    light: { from: "surface", reference: "oklch(0.985 0 0)" },
    dark: { from: "surface", reference: "oklch(0.205 0 0)" }
  },
  "--secondary": {
    format: "css",
    light: { from: "surface", reference: "oklch(0.97 0 0)" },
    dark: { from: "surface", reference: "oklch(0.269 0 0)" }
  },
  "--secondary-foreground": {
    format: "css",
    light: { from: "text", reference: "oklch(0.205 0 0)" },
    dark: { from: "text", reference: "oklch(0.985 0 0)" }
  },
  "--muted": {
    format: "css",
    light: { from: "surface", reference: "oklch(0.97 0 0)" },
    dark: { from: "surface", reference: "oklch(0.269 0 0)" }
  },
  "--accent": {
    format: "css",
    light: { from: "surface", reference: "oklch(0.97 0 0)" },
    dark: { from: "surface", reference: "oklch(0.269 0 0)" }
  },
  "--accent-foreground": {
    format: "css",
    light: { from: "text", reference: "oklch(0.205 0 0)" },
    dark: { from: "text", reference: "oklch(0.985 0 0)" }
  },
  "--border": {
    format: "css",
    light: { from: "surface", reference: "oklch(0.922 0 0)" },
    dark: { from: "text", reference: "oklch(1 0 0 / 10%)", chroma: 0 }
  },
  "--input": {
    format: "css",
    light: { from: "surface", reference: "oklch(0.922 0 0)" },
    dark: { from: "text", reference: "oklch(1 0 0 / 15%)", chroma: 0 }
  },
  "--ring": {
    format: "css",
    light: { from: "muted", reference: "oklch(0.708 0 0)" },
    dark: { from: "muted", reference: "oklch(0.556 0 0)" }
  }
};

/** Status colours shared by both built-in themes (tokens.css). */
const STATUS_COLORS: Record<string, string> = {
  "--error-soft-rgb": "248, 113, 113",
  "--error-rgb": "239, 68, 68",
  "--error-strong-rgb": "220, 38, 38",
  "--success-soft-rgb": "74, 222, 128",
  "--success-rgb": "34, 197, 94",
  "--success-strong-rgb": "22, 163, 74",
  "--warning-soft-rgb": "251, 191, 36",
  "--warning-rgb": "234, 179, 8",
  "--warning-strong-rgb": "202, 138, 4",
  "--info-soft-rgb": "147, 197, 253",
  "--info-rgb": "59, 130, 246",
  "--find-match-rgb": "250, 204, 21",
  "--find-current-rgb": "249, 115, 22",
  "--on-accent-rgb": "245, 240, 255"
};

/** Tokens that are not derived but come with the mode: the status text and
 *  panel colours, the marker and diff highlights and the code palette, each
 *  tuned for a light or a dark page. A custom theme inherits them from the
 *  built-in theme of its mode. */
const MODE_DEFAULTS: Record<ThemeMode, Record<string, string>> = {
  light: {
    ...STATUS_COLORS,
    "--text-default-alpha": "0.82",
    "--amber-fg": "#92400e",
    "--blue-fg": "#1d4ed8",
    "--error-fg": "#b91c1c",
    "--success-fg": "#166534",
    "--error-bg-rgb": "254, 226, 226",
    "--success-bg-rgb": "220, 252, 231",
    "--warning-bg-rgb": "255, 251, 235",
    "--info-bg-rgb": "239, 246, 255",
    "--unsaved-rgb": "245, 158, 11",
    "--highlight-bg": "rgba(253, 224, 71, 0.55)",
    "--diff-removed-bg": "rgba(220, 38, 38, 0.16)",
    "--diff-removed-accent": "rgba(185, 28, 28, 0.55)",
    "--diff-added-bg": "rgba(22, 163, 74, 0.16)",
    "--diff-added-accent": "rgba(21, 128, 61, 0.55)",
    "--code-comment": "#94a3b8",
    "--code-keyword": "#c4b5fd",
    "--code-string": "#86efac",
    "--code-number": "#fdba74",
    "--code-function": "#93c5fd",
    "--code-type": "#67e8f9",
    "--code-variable": "#f0abfc",
    "--destructive": "oklch(0.577 0.245 27.325)"
  },
  dark: {
    ...STATUS_COLORS,
    "--text-default-alpha": "0.82",
    "--amber-fg": "#fde68a",
    "--blue-fg": "#bfdbfe",
    "--error-fg": "#fecaca",
    "--success-fg": "#bbf7d0",
    "--error-bg-rgb": "44, 18, 18",
    "--success-bg-rgb": "18, 34, 24",
    "--warning-bg-rgb": "69, 49, 7",
    "--info-bg-rgb": "15, 33, 62",
    "--unsaved-rgb": "253, 230, 138",
    "--highlight-bg": "rgba(231, 189, 17, 0.18)",
    "--diff-removed-bg": "rgba(248, 113, 113, 0.26)",
    "--diff-removed-accent": "rgba(252, 165, 165, 0.7)",
    "--diff-added-bg": "rgba(74, 222, 128, 0.22)",
    "--diff-added-accent": "rgba(134, 239, 172, 0.7)",
    "--code-comment": "#7c8798",
    "--code-keyword": "#b3a2f7",
    "--code-string": "#7ddba4",
    "--code-number": "#f0ad76",
    "--code-function": "#85b8f5",
    "--code-type": "#63d5e6",
    "--code-variable": "#e39cf0",
    "--destructive": "oklch(0.704 0.191 22.216)"
  }
};

type AdvancedToken = { format: OutputFormat; light: Rule; dark: Rule };

const both = (rule: Rule, format: OutputFormat): AdvancedToken => ({ format, light: rule, dark: rule });

/** One status role: its saturated steps (shared by both modes) plus the
 *  per-mode message text and panel colours, all from one picked colour. */
function statusTokens(
  key: "error" | "success" | "warning" | "info",
  names: { soft: string; base: string; strong?: string; fg: string; bg: string },
  references: { soft: string; strong?: string; fg: Record<ThemeMode, string>; bg: Record<ThemeMode, string> }
): Record<string, AdvancedToken> {
  const tokens: Record<string, AdvancedToken> = {
    [names.base]: both({ from: key, reference: STATUS_COLORS[names.base] }, "triplet"),
    [names.soft]: both({ from: key, reference: references.soft, relative: true }, "triplet"),
    [names.fg]: {
      format: "hex",
      light: { from: key, reference: references.fg.light, relative: true },
      dark: { from: key, reference: references.fg.dark, relative: true }
    },
    [names.bg]: {
      format: "triplet",
      light: { from: key, reference: references.bg.light, relative: true },
      dark: { from: key, reference: references.bg.dark, relative: true }
    }
  };
  if (names.strong && references.strong) {
    tokens[names.strong] = both({ from: key, reference: references.strong, relative: true }, "triplet");
  }
  return tokens;
}

function codeToken(key: AdvancedColorKey, name: string): Record<string, AdvancedToken> {
  return {
    [name]: {
      format: "hex",
      light: { from: key, reference: DEFAULT_ADVANCED_COLORS.light[key] },
      dark: { from: key, reference: DEFAULT_ADVANCED_COLORS.dark[key] }
    }
  };
}

/** The tokens each advanced colour drives. The references are the built-in
 *  values (the same ones MODE_DEFAULTS carries), so the steps between, say,
 *  the error colour and the error panel stay what they are today. */
const ADVANCED_TOKENS: Record<AdvancedColorKey, Record<string, AdvancedToken>> = {
  error: statusTokens(
    "error",
    { soft: "--error-soft-rgb", base: "--error-rgb", strong: "--error-strong-rgb", fg: "--error-fg", bg: "--error-bg-rgb" },
    {
      soft: STATUS_COLORS["--error-soft-rgb"],
      strong: STATUS_COLORS["--error-strong-rgb"],
      fg: { light: "#b91c1c", dark: "#fecaca" },
      bg: { light: "254, 226, 226", dark: "44, 18, 18" }
    }
  ),
  success: statusTokens(
    "success",
    {
      soft: "--success-soft-rgb",
      base: "--success-rgb",
      strong: "--success-strong-rgb",
      fg: "--success-fg",
      bg: "--success-bg-rgb"
    },
    {
      soft: STATUS_COLORS["--success-soft-rgb"],
      strong: STATUS_COLORS["--success-strong-rgb"],
      fg: { light: "#166534", dark: "#bbf7d0" },
      bg: { light: "220, 252, 231", dark: "18, 34, 24" }
    }
  ),
  warning: statusTokens(
    "warning",
    {
      soft: "--warning-soft-rgb",
      base: "--warning-rgb",
      strong: "--warning-strong-rgb",
      fg: "--amber-fg",
      bg: "--warning-bg-rgb"
    },
    {
      soft: STATUS_COLORS["--warning-soft-rgb"],
      strong: STATUS_COLORS["--warning-strong-rgb"],
      fg: { light: "#92400e", dark: "#fde68a" },
      bg: { light: "255, 251, 235", dark: "69, 49, 7" }
    }
  ),
  info: statusTokens(
    "info",
    { soft: "--info-soft-rgb", base: "--info-rgb", fg: "--blue-fg", bg: "--info-bg-rgb" },
    {
      soft: STATUS_COLORS["--info-soft-rgb"],
      fg: { light: "#1d4ed8", dark: "#bfdbfe" },
      bg: { light: "239, 246, 255", dark: "15, 33, 62" }
    }
  ),
  marker: {
    "--highlight-bg": {
      format: "rgba",
      light: { from: "marker", reference: "rgba(253, 224, 71, 0.55)" },
      dark: { from: "marker", reference: "rgba(202, 138, 4, 0.2)" }
    }
  },
  findMatch: { "--find-match-rgb": both({ from: "findMatch", reference: STATUS_COLORS["--find-match-rgb"] }, "triplet") },
  findCurrent: {
    "--find-current-rgb": both({ from: "findCurrent", reference: STATUS_COLORS["--find-current-rgb"] }, "triplet")
  },
  diffRemoved: {
    "--diff-removed-bg": {
      format: "rgba",
      light: { from: "diffRemoved", reference: "rgba(220, 38, 38, 0.16)" },
      dark: { from: "diffRemoved", reference: "rgba(248, 113, 113, 0.26)" }
    },
    "--diff-removed-accent": {
      format: "rgba",
      light: { from: "diffRemoved", reference: "rgba(185, 28, 28, 0.55)", relative: true },
      dark: { from: "diffRemoved", reference: "rgba(252, 165, 165, 0.7)", relative: true }
    }
  },
  diffAdded: {
    "--diff-added-bg": {
      format: "rgba",
      light: { from: "diffAdded", reference: "rgba(22, 163, 74, 0.16)" },
      dark: { from: "diffAdded", reference: "rgba(74, 222, 128, 0.22)" }
    },
    "--diff-added-accent": {
      format: "rgba",
      light: { from: "diffAdded", reference: "rgba(21, 128, 61, 0.55)", relative: true },
      dark: { from: "diffAdded", reference: "rgba(134, 239, 172, 0.7)", relative: true }
    }
  },
  codeComment: codeToken("codeComment", "--code-comment"),
  codeKeyword: codeToken("codeKeyword", "--code-keyword"),
  codeString: codeToken("codeString", "--code-string"),
  codeNumber: codeToken("codeNumber", "--code-number"),
  codeFunction: codeToken("codeFunction", "--code-function"),
  codeType: codeToken("codeType", "--code-type"),
  codeVariable: codeToken("codeVariable", "--code-variable")
};

/** The custom properties an advanced colour drives (for the tests). */
export function advancedTokenNames(key: AdvancedColorKey): string[] {
  return Object.keys(ADVANCED_TOKENS[key]);
}

/** Maps an accent palette shade to its custom property (same table as
 *  useAccentColorStore). */
const ACCENT_TOKENS: Record<string, string> = {
  base: "--accent-rgb",
  pale: "--accent-pale-rgb",
  lighter: "--accent-lighter-rgb",
  light: "--accent-light-rgb",
  dark: "--accent-dark-rgb",
  darker: "--accent-darker-rgb",
  darkest: "--accent-darkest-rgb"
};

function toOklab(hex: string): Oklab {
  const rgb = hexToRgb(hex);
  if (!rgb) {
    throw new Error(`Not a #rrggbb colour: ${hex}`);
  }
  return rgbToOklab(rgb);
}

function formatColor(rgb: Rgb, alpha: number, format: OutputFormat): string {
  const r = Math.round(rgb.r);
  const g = Math.round(rgb.g);
  const b = Math.round(rgb.b);
  switch (format) {
    case "triplet":
      return `${r}, ${g}, ${b}`;
    case "hex":
      return rgbToHex({ r, g, b });
    case "rgba":
      return `rgba(${r}, ${g}, ${b}, ${Number(alpha.toFixed(3))})`;
    case "css":
      return alpha < 1 ? `rgb(${r} ${g} ${b} / ${Math.round(alpha * 100)}%)` : `rgb(${r} ${g} ${b})`;
  }
}

type ColorSet = Record<ColorKey, string>;

function applyRule(rule: Rule, colors: ColorSet, defaults: ColorSet, format: OutputFormat): string {
  const reference = parseCssColor(rule.reference);
  if (!reference) {
    throw new Error(`Unparseable reference colour: ${rule.reference}`);
  }

  const referenceLab = rgbToOklab(reference);
  const defaultFrom = toOklab(defaults[rule.from]);
  const step = referenceLab.l - defaultFrom.l;
  const from = toOklab(colors[rule.from]);
  const tint = rule.tint ? toOklab(colors[rule.tint]) : from;
  const pull = rule.pull ?? 0;
  let chroma = rule.chroma ?? 1;
  let a = from.a + (tint.a - from.a) * pull;
  let b = from.b + (tint.b - from.b) * pull;

  if (rule.relative) {
    const defaultChroma = Math.hypot(defaultFrom.a, defaultFrom.b);
    if (defaultChroma > 0) {
      chroma = Math.hypot(referenceLab.a, referenceLab.b) / defaultChroma;
      const turn = Math.atan2(referenceLab.b, referenceLab.a) - Math.atan2(defaultFrom.b, defaultFrom.a);
      [a, b] = [a * Math.cos(turn) - b * Math.sin(turn), a * Math.sin(turn) + b * Math.cos(turn)];
    } else {
      chroma = 0;
    }
  }

  const derived = oklabToRgb({
    l: Math.min(1, Math.max(0, from.l + step)),
    a: a * chroma,
    b: b * chroma
  });
  return formatColor(derived, reference.alpha, format);
}

/** Every theme-controlled custom property, resolved for the given mode,
 *  base colours and optional advanced colours. All colours must be valid
 *  `#rrggbb` (the theme format's validator guarantees that before anything
 *  reaches this function). */
export function deriveThemeVariables(
  mode: ThemeMode,
  base: ThemeBaseColors,
  advanced: ThemeAdvancedColors = {}
): Record<string, string> {
  const defaults: ColorSet = { ...DEFAULT_BASE_COLORS[mode], ...DEFAULT_ADVANCED_COLORS[mode] };
  const colors: ColorSet = { ...defaults, ...base, ...advanced };
  const variables: Record<string, string> = { ...MODE_DEFAULTS[mode] };

  for (const [name, token] of Object.entries(DERIVED_TOKENS)) {
    variables[name] = applyRule(token[mode], colors, defaults, token.format);
  }

  for (const key of ADVANCED_COLOR_KEYS) {
    if (advanced[key] === undefined) {
      continue;
    }
    for (const [name, token] of Object.entries(ADVANCED_TOKENS[key])) {
      variables[name] = applyRule(token[mode], colors, defaults, token.format);
    }
  }

  const accent = buildAccentPalette(colors.accent);
  if (!accent) {
    throw new Error(`Not a #rrggbb colour: ${colors.accent}`);
  }
  for (const [shade, name] of Object.entries(ACCENT_TOKENS)) {
    variables[name] = accent[shade as keyof typeof accent];
  }

  return variables;
}

/** Tailwind's gray scale, which the editor's `prose`/`prose-invert` classes
 *  colour the document with (Tailwind Typography, default theme). */
const GRAY = {
  100: "oklch(0.967 0.003 264.542)",
  200: "oklch(0.928 0.006 264.531)",
  300: "oklch(0.872 0.01 258.338)",
  400: "oklch(0.707 0.022 261.325)",
  500: "oklch(0.551 0.027 264.364)",
  600: "oklch(0.446 0.03 256.802)",
  700: "oklch(0.373 0.034 259.733)",
  900: "oklch(0.21 0.034 264.665)"
} as const;
const WHITE = "#ffffff";

const proseToken = (from: ColorKey, light: string, dark: string): DerivedToken => ({
  format: "css",
  light: { from, reference: light },
  dark: { from, reference: dark }
});

/** The document's own colours. Tailwind Typography sets them on the editor
 *  element, not on <html>, so they are applied by a generated rule rather
 *  than with the other tokens. The code block's text and background are left
 *  alone: they are dark in every theme and the code colours are tuned for
 *  that. */
const PROSE_TOKENS: Record<string, DerivedToken> = {
  "--tw-prose-body": proseToken("text", GRAY[700], GRAY[300]),
  "--tw-prose-headings": proseToken("text", GRAY[900], WHITE),
  "--tw-prose-lead": proseToken("muted", GRAY[600], GRAY[400]),
  "--tw-prose-links": proseToken("text", GRAY[900], WHITE),
  "--tw-prose-bold": proseToken("text", GRAY[900], WHITE),
  "--tw-prose-counters": proseToken("muted", GRAY[500], GRAY[400]),
  "--tw-prose-bullets": proseToken("surface", GRAY[300], GRAY[600]),
  "--tw-prose-hr": proseToken("surface", GRAY[200], GRAY[700]),
  "--tw-prose-quotes": proseToken("text", GRAY[900], GRAY[100]),
  "--tw-prose-quote-borders": proseToken("surface", GRAY[200], GRAY[700]),
  "--tw-prose-captions": proseToken("muted", GRAY[500], GRAY[400]),
  "--tw-prose-kbd": proseToken("text", GRAY[900], WHITE),
  "--tw-prose-kbd-shadows": proseToken("text", "oklch(0.21 0.034 264.665 / 10%)", "oklch(1 0 0 / 10%)"),
  "--tw-prose-code": proseToken("text", GRAY[900], WHITE),
  "--tw-prose-th-borders": proseToken("surface", GRAY[300], GRAY[600]),
  "--tw-prose-td-borders": proseToken("surface", GRAY[200], GRAY[700])
};

/** Typography's code block, passed through unchanged (see above). */
const PROSE_CODE_BLOCK: Record<ThemeMode, Record<string, string>> = {
  light: { "--tw-prose-pre-code": GRAY[200], "--tw-prose-pre-bg": "oklch(0.278 0.033 256.848)" },
  dark: { "--tw-prose-pre-code": GRAY[300], "--tw-prose-pre-bg": "rgb(0 0 0 / 50%)" }
};

/** The Typography variables for the editor surface, from the theme's text,
 *  muted and surface colours. */
export function deriveProseVariables(mode: ThemeMode, base: ThemeBaseColors): Record<string, string> {
  const defaults: ColorSet = { ...DEFAULT_BASE_COLORS[mode], ...DEFAULT_ADVANCED_COLORS[mode] };
  const colors: ColorSet = { ...defaults, ...base };
  const variables: Record<string, string> = { ...PROSE_CODE_BLOCK[mode] };
  for (const [name, token] of Object.entries(PROSE_TOKENS)) {
    variables[name] = applyRule(token[mode], colors, defaults, token.format);
  }
  return variables;
}

/** The built-in prose colours, for the tests and the preview's reference. */
export function builtInProseReference(mode: ThemeMode): Record<string, string> {
  return Object.fromEntries(Object.entries(PROSE_TOKENS).map(([name, token]) => [name, token[mode].reference]));
}

function paperBase(paper: ThemePaperColors): ThemeBaseColors {
  return { ...DEFAULT_BASE_COLORS.light, surface: paper.background, text: paper.text };
}

/** The document colours on the paper sheet. */
export function derivePaperProseVariables(paper: ThemePaperColors): Record<string, string> {
  return deriveProseVariables("light", paperBase(paper));
}

/** Tokens the paper surface does not redeclare (tokens.css keeps them on
 *  :root only): a popover on the page still wears the dark UI's shadow and
 *  the user's accent. */
const NOT_ON_PAPER = new Set(["--shadow-rgb", ...Object.values(ACCENT_TOKENS)]);

/** The light palette the paper surface paints onto the page, built from the
 *  sheet's own background and text colour. */
export function derivePaperVariables(paper: ThemePaperColors): Record<string, string> {
  const variables = deriveThemeVariables("light", paperBase(paper));
  for (const name of NOT_ON_PAPER) {
    delete variables[name];
  }
  return variables;
}
