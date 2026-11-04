// The icons used last, per font, for the first row of the icon picker: out of
// ten thousand glyphs a person reuses a handful. A per-person convenience, so
// it lives in localStorage and the picker works without it.

const STORAGE_KEY = "scribedog-recent-icons";
export const MAX_RECENT_ICONS = 18;

type RecentIcons = Record<string, number[]>;

function isCodepoint(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0 && value <= 0x10ffff;
}

export function parseRecentIcons(raw: string | null): RecentIcons {
  try {
    const parsed: unknown = raw ? JSON.parse(raw) : null;

    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
      return {};
    }

    const result: RecentIcons = {};

    for (const [fontId, list] of Object.entries(parsed)) {
      if (Array.isArray(list)) {
        result[fontId] = list.filter(isCodepoint).slice(0, MAX_RECENT_ICONS);
      }
    }

    return result;
  } catch {
    return {};
  }
}

/** `codepoint` moved to the front of `list`, without a duplicate and capped. */
export function pushRecentIcon(list: number[], codepoint: number): number[] {
  return [codepoint, ...list.filter((entry) => entry !== codepoint)].slice(0, MAX_RECENT_ICONS);
}

export function readRecentIcons(fontId: string): number[] {
  try {
    return parseRecentIcons(window.localStorage.getItem(STORAGE_KEY))[fontId] ?? [];
  } catch {
    return [];
  }
}

export function rememberIcon(fontId: string, codepoint: number): void {
  try {
    const all = parseRecentIcons(window.localStorage.getItem(STORAGE_KEY));
    all[fontId] = pushRecentIcon(all[fontId] ?? [], codepoint);
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(all));
  } catch {
    // Private window or blocked storage: the picker just has no history.
  }
}
