/**
 * The custom theme data model and its JSON form, used both for the list in
 * localStorage and for export/import.
 *
 * A theme stores its base colours, never the resolved custom properties:
 * an exported theme stays valid when tokens are renamed or the derivation
 * improves. Imported files are validated strictly, since whatever passes
 * ends up in `style.setProperty` and in a generated stylesheet: known keys
 * only, colours only as `#rrggbb`, and a name without control characters.
 * The highlight colours of the open note are the one exception, and only
 * they: they take an optional `aa` suffix, because a mark has to be
 * dimmable down to invisible.
 */

import {
  ADVANCED_COLOR_KEYS,
  ALPHA_COLOR_KEYS,
  BASE_COLOR_KEYS,
  deriveThemeVariables,
  derivePaperProseVariables,
  derivePaperVariables,
  deriveProseVariables,
  DEFAULT_BASE_COLORS,
  DEFAULT_PAPER_COLORS,
  isDarkColor,
  type AdvancedColorKey,
  type ThemeAdvancedColors,
  type ThemeBaseColors,
  type ThemeMode,
  type ThemePaperColors,
  type ThemeZenColors
} from "./derive";

export const THEME_FILE_FORMAT = "scribedog-theme";
export const THEME_FORMAT_VERSION = 1;
export const THEME_NAME_MAX_LENGTH = 60;

export type CustomTheme = {
  id: string;
  name: string;
  mode: ThemeMode;
  base: ThemeBaseColors;
  /** The sheet of the paper surface; left out, it is the light default. */
  paper?: ThemePaperColors;
  /** Only the advanced colours the user changed. */
  advanced?: ThemeAdvancedColors;
  /** Zen mode's own page; left out, Zen mode shows the theme itself. */
  zen?: ThemeZenColors;
};

export type ThemeParseError = "invalidJson" | "notATheme" | "unsupportedVersion" | "invalidTheme";

export type ThemeParseResult = { ok: true; theme: CustomTheme } | { ok: false; error: ThemeParseError };

const HEX_COLOR = /^#[0-9a-f]{6}$/i;
const HEX_COLOR_ALPHA = /^#[0-9a-f]{6}([0-9a-f]{2})?$/i;
const THEME_ID = /^[a-z0-9][a-z0-9-]{0,63}$/;
// Control characters, including the line/paragraph separators: a name is one
// line of text in a select and a file name.
const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f-\u009f\u2028\u2029]/;

const TOP_LEVEL_KEYS = new Set(["format", "version", "id", "name", "mode", "base", "paper", "advanced", "zen"]);

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Every key present must be known; `required` keys must all be there.
 *  `alphaKeys` names the few that may carry an `aa` suffix — every other
 *  key stays on the strict six-digit rule, since an alpha on a base or
 *  paper colour would let the page through a surface that is meant to be
 *  opaque. */
function readColorMap<K extends string>(
  value: unknown,
  keys: readonly K[],
  required: boolean,
  alphaKeys: ReadonlySet<string> = new Set()
): Partial<Record<K, string>> | null {
  if (!isPlainObject(value)) {
    return null;
  }
  const allowed = new Set<string>(keys);
  const result: Partial<Record<K, string>> = {};
  for (const [key, color] of Object.entries(value)) {
    const pattern = alphaKeys.has(key) ? HEX_COLOR_ALPHA : HEX_COLOR;
    if (!allowed.has(key) || typeof color !== "string" || !pattern.test(color)) {
      return null;
    }
    result[key as K] = color.toLowerCase();
  }
  if (required && keys.some((key) => result[key] === undefined)) {
    return null;
  }
  return result;
}

export function normalizeThemeName(name: string): string {
  return name.trim().replace(/\s+/g, " ");
}

export function isValidThemeName(name: string): boolean {
  const normalized = normalizeThemeName(name);
  return normalized.length > 0 && normalized.length <= THEME_NAME_MAX_LENGTH && !CONTROL_CHARACTERS.test(name);
}

export function isValidThemeId(id: string): boolean {
  return THEME_ID.test(id);
}

/** Validates a parsed theme document (from a file, the clipboard or the
 *  stored list). */
export function validateTheme(value: unknown): ThemeParseResult {
  if (!isPlainObject(value) || value.format !== THEME_FILE_FORMAT) {
    return { ok: false, error: "notATheme" };
  }
  if (typeof value.version !== "number" || !Number.isInteger(value.version) || value.version < 1) {
    return { ok: false, error: "invalidTheme" };
  }
  if (value.version > THEME_FORMAT_VERSION) {
    return { ok: false, error: "unsupportedVersion" };
  }
  if (Object.keys(value).some((key) => !TOP_LEVEL_KEYS.has(key))) {
    return { ok: false, error: "invalidTheme" };
  }

  const { id, name, mode } = value;
  if (typeof id !== "string" || !isValidThemeId(id)) {
    return { ok: false, error: "invalidTheme" };
  }
  if (typeof name !== "string" || !isValidThemeName(name)) {
    return { ok: false, error: "invalidTheme" };
  }
  if (mode !== "light" && mode !== "dark") {
    return { ok: false, error: "invalidTheme" };
  }

  const base = readColorMap(value.base, BASE_COLOR_KEYS, true);
  if (!base) {
    return { ok: false, error: "invalidTheme" };
  }

  const theme: CustomTheme = { id, name: normalizeThemeName(name), mode, base: base as ThemeBaseColors };

  if (value.paper !== undefined) {
    const paper = readColorMap(value.paper, ["background", "text"] as const, true);
    if (!paper) {
      return { ok: false, error: "invalidTheme" };
    }
    theme.paper = paper as ThemePaperColors;
  }

  if (value.zen !== undefined) {
    const zen = readColorMap(value.zen, ["background", "text"] as const, true);
    if (!zen) {
      return { ok: false, error: "invalidTheme" };
    }
    theme.zen = zen as ThemeZenColors;
  }

  if (value.advanced !== undefined) {
    const advanced = readColorMap<AdvancedColorKey>(
      value.advanced,
      ADVANCED_COLOR_KEYS,
      false,
      ALPHA_COLOR_KEYS
    );
    if (!advanced) {
      return { ok: false, error: "invalidTheme" };
    }
    if (Object.keys(advanced).length > 0) {
      theme.advanced = advanced;
    }
  }

  return { ok: true, theme };
}

export function parseThemeJson(raw: string): ThemeParseResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { ok: false, error: "invalidJson" };
  }
  return validateTheme(parsed);
}

/** The document form of a theme: what is exported and what is stored. The
 *  key order is fixed so an exported file reads top to bottom. */
export function toThemeDocument(theme: CustomTheme): Record<string, unknown> {
  const document: Record<string, unknown> = {
    format: THEME_FILE_FORMAT,
    version: THEME_FORMAT_VERSION,
    id: theme.id,
    name: theme.name,
    mode: theme.mode,
    base: Object.fromEntries(BASE_COLOR_KEYS.map((key) => [key, theme.base[key]]))
  };
  if (theme.paper) {
    document.paper = { background: theme.paper.background, text: theme.paper.text };
  }
  if (theme.zen) {
    document.zen = { background: theme.zen.background, text: theme.zen.text };
  }
  const advanced = theme.advanced ?? {};
  const advancedKeys = ADVANCED_COLOR_KEYS.filter((key) => advanced[key] !== undefined);
  if (advancedKeys.length > 0) {
    document.advanced = Object.fromEntries(advancedKeys.map((key) => [key, advanced[key]]));
  }
  return document;
}

export function serializeTheme(theme: CustomTheme): string {
  return `${JSON.stringify(toThemeDocument(theme), null, 2)}\n`;
}

export function createThemeId(): string {
  const random =
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID()
      : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  return `theme-${random.toLowerCase()}`;
}

/** A file name for the export: the theme name reduced to safe characters. */
export function themeFileName(theme: CustomTheme): string {
  const slug = theme.name
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
  return `${slug || "theme"}.scribedog-theme.json`;
}

export type ResolvedTheme = {
  /** Custom properties for `<html>`. */
  root: Record<string, string>;
  /** The document colours (Tailwind Typography) for the editor surface. */
  prose: Record<string, string>;
  /** The paper sheet's palette and document colours; null for a light theme,
   *  where the paper option has nothing to do (the page is already light). */
  paper: { palette: Record<string, string>; prose: Record<string, string> } | null;
  /** Zen mode's page, when the theme sets one. Its mode follows the page's
   *  own lightness, so a dark Zen page in a light theme derives dark. */
  zen: {
    mode: ThemeMode;
    background: string;
    palette: Record<string, string>;
    prose: Record<string, string>;
  } | null;
};

/** Zen mode as its own small theme: the page colour is both background and
 *  surface. Muted, chrome and the advanced colours come along when the page
 *  has the theme's own mode, and from that mode's defaults otherwise, since
 *  a light theme's muted grey is tuned for a light page. */
function resolveZen(theme: CustomTheme, zen: ThemeZenColors): NonNullable<ResolvedTheme["zen"]> {
  const mode: ThemeMode = isDarkColor(zen.background) ? "dark" : "light";
  const sameMode = mode === theme.mode;
  const base: ThemeBaseColors = {
    ...(sameMode ? theme.base : DEFAULT_BASE_COLORS[mode]),
    accent: theme.base.accent,
    background: zen.background,
    surface: zen.background,
    text: zen.text
  };
  return {
    mode,
    background: zen.background,
    palette: deriveThemeVariables(mode, base, sameMode ? theme.advanced : undefined),
    prose: deriveProseVariables(mode, base)
  };
}

export function resolveTheme(theme: CustomTheme): ResolvedTheme {
  const paper = theme.paper ?? DEFAULT_PAPER_COLORS;
  return {
    root: deriveThemeVariables(theme.mode, theme.base, theme.advanced),
    prose: deriveProseVariables(theme.mode, theme.base),
    paper:
      theme.mode === "dark"
        ? { palette: derivePaperVariables(paper), prose: derivePaperProseVariables(paper) }
        : null,
    zen: theme.zen ? resolveZen(theme, theme.zen) : null
  };
}

/** Serializes a set of custom properties into declarations for a
 *  generated stylesheet. Values come from the derivation (validated hex in,
 *  colour syntax out); the pattern check is the last line against anything
 *  that could end a declaration or a rule. */
export function toCssDeclarations(variables: Record<string, string>): string {
  const safeValue = /^[\w\s#.,%()/-]+$/;
  return Object.entries(variables)
    .filter(([name, value]) => /^--[\w-]+$/.test(name) && safeValue.test(value))
    .map(([name, value]) => `${name}: ${value};`)
    .join(" ");
}

/** The part of a custom theme that cannot live on `<html>`. Typography sets
 *  its colours on the editor element and the paper surface redeclares the
 *  light palette (tokens.css), so both are replaced by rules here. They are
 *  unlayered, which beats Typography's rules in Tailwind's utilities layer,
 *  and the paper rules are one step more specific than their counterparts. */
export function themeStylesheet(resolved: ResolvedTheme): string {
  const rules = [`.editor-view__surface.prose { ${toCssDeclarations(resolved.prose)} }`];
  if (resolved.zen) {
    // The workspace fills the window, so its background is Zen mode's page;
    // everything inside (the exit button, the dirty dot, the text) reads the
    // Zen palette by inheritance. The paper sheet still wins on its own
    // element, as outside Zen mode.
    rules.push(
      `.workspace:has(> .workspace-grid--zen) { ${toCssDeclarations(resolved.zen.palette)} background: ${resolved.zen.background}; color-scheme: ${resolved.zen.mode}; }`,
      `.workspace-grid--zen .editor-view__surface.prose { ${toCssDeclarations(resolved.zen.prose)} }`
    );
  }
  if (resolved.paper) {
    rules.push(
      `html.dark .editor-view__surface--paper, html.dark .paper-palette { ${toCssDeclarations(resolved.paper.palette)} }`,
      `html.dark .editor-view__surface--paper.prose { ${toCssDeclarations(resolved.paper.prose)} }`
    );
  }
  return rules.join("\n");
}

/** The stored custom theme list: invalid entries are dropped one by one
 *  rather than losing the whole list. */
export function parseStoredThemes(raw: string | null): CustomTheme[] {
  if (!raw) {
    return [];
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) {
    return [];
  }
  const themes: CustomTheme[] = [];
  const seen = new Set<string>();
  for (const entry of parsed) {
    const result = validateTheme(entry);
    if (result.ok && !seen.has(result.theme.id)) {
      seen.add(result.theme.id);
      themes.push(result.theme);
    }
  }
  return themes;
}

export function serializeStoredThemes(themes: CustomTheme[]): string {
  return JSON.stringify(themes.map(toThemeDocument));
}

/** What public/theme-boot.js reads before the bundle loads: the mode and the
 *  root background of the active custom theme. */
export type ThemeBootInfo = { mode: ThemeMode; background: string };

export function themeBootInfo(theme: CustomTheme): ThemeBootInfo {
  return { mode: theme.mode, background: resolveTheme(theme).root["--body-bg-end"] };
}

/** `name`, or `name (2)`, `name (3)`, … when the list already has it, cut so
 *  the result stays within the name limit. */
export function uniqueThemeName(name: string, existing: string[]): string {
  const taken = new Set(existing.map((entry) => entry.toLocaleLowerCase()));
  const base = normalizeThemeName(name);
  if (!taken.has(base.toLocaleLowerCase())) {
    return base;
  }
  for (let counter = 2; ; counter += 1) {
    const suffix = ` (${counter})`;
    const candidate = `${base.slice(0, THEME_NAME_MAX_LENGTH - suffix.length).trimEnd()}${suffix}`;
    if (!taken.has(candidate.toLocaleLowerCase())) {
      return candidate;
    }
  }
}

/** Same content, ignoring how an empty advanced block or a default paper is
 *  spelled (the builder's "unsaved changes"). */
export function themesEqual(a: CustomTheme, b: CustomTheme): boolean {
  return serializeTheme(a) === serializeTheme(b);
}
