import { iconPathKey } from "@/lib/vaultIcons";

// Placemarks (issue #91): blocks of a note the reader wants to come back to,
// each with an optional comment. This module is the pure half: the stored
// form, how a stored mark finds its block again, and the path arithmetic for
// renames and deletions. The editor plugin is lib/editor/placemarkPlugin.ts,
// the state and the sidecar usePlacemarksStore.
//
// A mark is kept as the block's number plus the start of its text. The number
// alone would point at the wrong block after any edit above it made outside
// this session (another editor, a sync, the agent), the text alone is
// ambiguous in a note with repeated lines. So the text decides and the number
// breaks ties; only when the text is nowhere to be found does the number
// stand on its own. A mark is never dropped for not being found: it stays
// close to where it was, which is a better hint than nothing.

export type PlacemarkAnchor = {
  /** 0-based index of the numbered block (lib/editor/blockPosition.ts). */
  block: number;
  /** The start of the block's text, whitespace collapsed; "" for an image or a rule. */
  quote: string;
  comment?: string;
};

/** Vault-relative note path (keyed like icons, see iconPathKey) -> its marks in document order. */
export type PlacemarkFileMap = Record<string, PlacemarkAnchor[]>;

export type StoredPlacemarks = {
  version: 1;
  files: PlacemarkFileMap;
};

/** Long enough to tell lines apart, short enough to keep the sidecar small. */
export const PLACEMARK_QUOTE_LENGTH = 80;
export const PLACEMARK_COMMENT_MAX_LENGTH = 500;
/** A guard against a hand-edited or runaway file, not a limit anyone reaches. */
const MAX_PLACEMARKS_PER_FILE = 500;
/** How much of a quote has to match when the block was edited since. */
const PREFIX_MATCH_LENGTH = 24;

export function placemarkQuote(text: string): string {
  return text.replace(/\s+/g, " ").trim().slice(0, PLACEMARK_QUOTE_LENGTH);
}

export function normalizePlacemarkComment(comment: string): string {
  return comment.trim().slice(0, PLACEMARK_COMMENT_MAX_LENGTH);
}

export function placemarkPathKey(relativePath: string): string {
  return iconPathKey(relativePath);
}

function nearest(candidates: number[], target: number): number | null {
  let best: number | null = null;

  for (const candidate of candidates) {
    if (best === null || Math.abs(candidate - target) < Math.abs(best - target)) {
      best = candidate;
    }
  }

  return best;
}

function sharedPrefixMatches(a: string, b: string): boolean {
  const length = Math.min(PREFIX_MATCH_LENGTH, a.length, b.length);
  return length > 0 && a.slice(0, length) === b.slice(0, length);
}

/** The block a stored mark belongs to in a document whose blocks start with `blockQuotes`. */
export function resolvePlacemarkBlock(blockQuotes: string[], anchor: PlacemarkAnchor): number | null {
  if (blockQuotes.length === 0) {
    return null;
  }

  const fallback = Math.min(Math.max(0, anchor.block), blockQuotes.length - 1);

  if (anchor.quote === "") {
    return fallback;
  }

  if (blockQuotes[anchor.block] === anchor.quote) {
    return anchor.block;
  }

  const exact: number[] = [];
  const similar: number[] = [];

  blockQuotes.forEach((quote, index) => {
    if (quote === anchor.quote) {
      exact.push(index);
    } else if (sharedPrefixMatches(quote, anchor.quote)) {
      similar.push(index);
    }
  });

  return nearest(exact, anchor.block) ?? nearest(similar, anchor.block) ?? fallback;
}

export type ResolvedPlacemark = {
  block: number;
  comment: string;
};

/**
 * Every stored mark resolved against the document, in document order. Two
 * marks that land on the same block become one; the first comment that is
 * not empty survives, since dropping a comment someone wrote would be the
 * worse surprise.
 */
export function resolvePlacemarks(blockQuotes: string[], anchors: PlacemarkAnchor[]): ResolvedPlacemark[] {
  const byBlock = new Map<number, ResolvedPlacemark>();

  for (const anchor of anchors) {
    const block = resolvePlacemarkBlock(blockQuotes, anchor);

    if (block === null) {
      continue;
    }

    const existing = byBlock.get(block);
    const comment = anchor.comment ?? "";

    if (!existing) {
      byBlock.set(block, { block, comment });
    } else if (!existing.comment && comment) {
      existing.comment = comment;
    }
  }

  return [...byBlock.values()].sort((a, b) => a.block - b.block);
}

/** The index of the mark to jump to from the cursor's block, wrapping around; null without marks. */
export function nextPlacemarkBlock(markedBlocks: number[], currentBlock: number, direction: 1 | -1): number | null {
  if (markedBlocks.length === 0) {
    return null;
  }

  const sorted = [...markedBlocks].sort((a, b) => a - b);

  if (direction === 1) {
    return sorted.find((block) => block > currentBlock) ?? sorted[0];
  }

  return [...sorted].reverse().find((block) => block < currentBlock) ?? sorted[sorted.length - 1];
}

function sameAnchors(a: PlacemarkAnchor[], b: PlacemarkAnchor[]): boolean {
  return (
    a.length === b.length &&
    a.every(
      (anchor, index) =>
        anchor.block === b[index].block &&
        anchor.quote === b[index].quote &&
        (anchor.comment ?? "") === (b[index].comment ?? "")
    )
  );
}

/** Stores a note's marks; returns the map it was given when nothing changed. */
export function setFilePlacemarks(
  files: PlacemarkFileMap,
  relativePath: string,
  anchors: PlacemarkAnchor[]
): PlacemarkFileMap {
  const key = placemarkPathKey(relativePath);

  if (!key) {
    return files;
  }

  const current = files[key] ?? [];

  if (sameAnchors(current, anchors)) {
    return files;
  }

  const next = { ...files };

  if (anchors.length === 0) {
    delete next[key];
  } else {
    next[key] = anchors;
  }

  return next;
}

/**
 * Carries a note's marks (and, for a folder, those of every note below it)
 * to the new path. Returns the map it was given when nothing moved.
 */
export function renamePlacemarkPath(
  files: PlacemarkFileMap,
  fromRelativePath: string,
  toRelativePath: string
): PlacemarkFileMap {
  const fromKey = placemarkPathKey(fromRelativePath);
  const toKey = placemarkPathKey(toRelativePath);

  if (!fromKey || !toKey || fromKey === toKey) {
    return files;
  }

  const result: PlacemarkFileMap = {};
  let changed = false;

  for (const [key, anchors] of Object.entries(files)) {
    if (key === fromKey) {
      result[toKey] = anchors;
      changed = true;
    } else if (key.startsWith(`${fromKey}/`)) {
      result[`${toKey}${key.slice(fromKey.length)}`] = anchors;
      changed = true;
    } else if (!(key in result)) {
      result[key] = anchors;
    }
  }

  return changed ? result : files;
}

/** Drops a note's marks, or those of every note below a deleted folder. */
export function removePlacemarkPath(files: PlacemarkFileMap, relativePath: string): PlacemarkFileMap {
  const key = placemarkPathKey(relativePath);

  if (!key) {
    return files;
  }

  const result: PlacemarkFileMap = {};
  let changed = false;

  for (const [entryKey, anchors] of Object.entries(files)) {
    if (entryKey === key || entryKey.startsWith(`${key}/`)) {
      changed = true;
    } else {
      result[entryKey] = anchors;
    }
  }

  return changed ? result : files;
}

function normalizeAnchor(value: unknown): PlacemarkAnchor | null {
  if (typeof value !== "object" || value === null) {
    return null;
  }

  const { block, quote, comment } = value as Record<string, unknown>;

  if (typeof block !== "number" || !Number.isInteger(block) || block < 0 || typeof quote !== "string") {
    return null;
  }

  const anchor: PlacemarkAnchor = { block, quote: placemarkQuote(quote) };

  if (typeof comment === "string") {
    const normalized = normalizePlacemarkComment(comment);

    if (normalized) {
      anchor.comment = normalized;
    }
  }

  return anchor;
}

/** Reads the sidecar; anything malformed is dropped entry by entry, never the whole file. */
export function normalizeStoredPlacemarks(parsed: unknown): StoredPlacemarks {
  const files: PlacemarkFileMap = {};
  const source =
    typeof parsed === "object" && parsed !== null ? (parsed as { files?: unknown }).files : undefined;

  if (typeof source !== "object" || source === null || Array.isArray(source)) {
    return { version: 1, files };
  }

  for (const [path, value] of Object.entries(source)) {
    const key = placemarkPathKey(path);

    if (!key || !Array.isArray(value)) {
      continue;
    }

    const anchors = value
      .map(normalizeAnchor)
      .filter((anchor): anchor is PlacemarkAnchor => anchor !== null)
      .slice(0, MAX_PLACEMARKS_PER_FILE);

    if (anchors.length > 0) {
      files[key] = anchors;
    }
  }

  return { version: 1, files };
}
