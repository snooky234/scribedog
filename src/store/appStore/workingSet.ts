import { normalizePathKey } from "./pathUtils";

/**
 * The "In progress" list above the file tree: the notes the user is working
 * on, as opposed to the ones merely looked at. Ordered by admission, until
 * the user drags an entry somewhere else (moveWorkingSetEntry); that order is
 * what gets stored.
 *
 * Two rules decide membership, and nothing else does: a note enters when it
 * becomes dirty (the user typed into it) or when the user pins it on purpose
 * (the tree's pin, Shift+Enter, the context menu, and a double-click where
 * a single click already opens). Selecting a note in the tree, arrow
 * keys included, never adds it, otherwise ten seconds of browsing would fill
 * the list with everything passed on the way. Saving never removes an entry
 * either: a row that vanishes while the note it stands for is on screen
 * reads as a bug every single time; closing costs one click.
 */
export type WorkingSetEntry = {
  filePath: string;
  pinned: boolean;
};

/** What `.scribedog/open-files.json` holds: vault-relative paths, like order.json. */
export type StoredWorkingSet = {
  version: 1;
  entries: { path: string; pinned: boolean }[];
};

export function findWorkingSetEntry(
  entries: readonly WorkingSetEntry[],
  filePath: string
): WorkingSetEntry | undefined {
  const key = normalizePathKey(filePath);

  return entries.find((entry) => normalizePathKey(entry.filePath) === key);
}

export function hasWorkingSetEntry(entries: readonly WorkingSetEntry[], filePath: string): boolean {
  return findWorkingSetEntry(entries, filePath) !== undefined;
}

/**
 * Admits a note, at the end. An existing entry stays where it is; pinning an
 * existing entry only flips its flag, an unpinned admission of a pinned
 * entry leaves the pin alone.
 */
export function addWorkingSetEntry(
  entries: readonly WorkingSetEntry[],
  filePath: string,
  pinned = false
): WorkingSetEntry[] {
  const existing = findWorkingSetEntry(entries, filePath);

  if (!existing) {
    return [...entries, { filePath, pinned }];
  }

  if (pinned && !existing.pinned) {
    return entries.map((entry) => (entry === existing ? { ...entry, pinned: true } : entry));
  }

  return [...entries];
}

export function setWorkingSetPinned(
  entries: readonly WorkingSetEntry[],
  filePath: string,
  pinned: boolean
): WorkingSetEntry[] {
  const existing = findWorkingSetEntry(entries, filePath);

  if (!existing) {
    return pinned ? [...entries, { filePath, pinned: true }] : [...entries];
  }

  return entries.map((entry) => (entry === existing ? { ...entry, pinned } : entry));
}

export function removeWorkingSetEntry(entries: readonly WorkingSetEntry[], filePath: string): WorkingSetEntry[] {
  const key = normalizePathKey(filePath);

  return entries.filter((entry) => normalizePathKey(entry.filePath) !== key);
}

/**
 * Drag & drop inside the list: the entry goes in front of the one at
 * `beforeIndex` (an index into the list as it is now, so `entries.length`
 * means the end). Dropping an entry onto its own place changes nothing.
 */
export function moveWorkingSetEntry(
  entries: readonly WorkingSetEntry[],
  filePath: string,
  beforeIndex: number
): WorkingSetEntry[] {
  const existing = findWorkingSetEntry(entries, filePath);

  if (!existing) {
    return [...entries];
  }

  const fromIndex = entries.indexOf(existing);
  const clamped = Math.min(entries.length, Math.max(0, beforeIndex));
  // Taking the entry out first shifts everything behind it up by one.
  const toIndex = clamped > fromIndex ? clamped - 1 : clamped;
  const next = entries.filter((entry) => entry !== existing);

  next.splice(toIndex, 0, existing);

  return next;
}

/** Rename and move: every entry's path goes through the mapper, order kept. */
export function remapWorkingSetPaths(
  entries: readonly WorkingSetEntry[],
  mapPath: (filePath: string) => string
): WorkingSetEntry[] {
  return entries.map((entry) => {
    const filePath = mapPath(entry.filePath);

    return filePath === entry.filePath ? entry : { ...entry, filePath };
  });
}

/**
 * Drops the entries whose note is gone. `isAlive` is the same rule the
 * document map applies (pruneDocumentsToCurrentFolder): on disk, or dirty,
 * or a note that exists only as a proposal or an unwritten folder note.
 */
export function pruneWorkingSet(
  entries: readonly WorkingSetEntry[],
  isAlive: (filePath: string) => boolean
): WorkingSetEntry[] {
  return entries.filter((entry) => isAlive(entry.filePath));
}

/**
 * Whether a note shows as pinned outside the list (the tree's pin) and what
 * its pin toggles back to. With pin-only admission every entry got in by a
 * pin, so being listed is being pinned, and taking the pin away means taking
 * the entry out; the context menu has always read it that way.
 */
export function isShownAsPinned(
  entries: readonly WorkingSetEntry[],
  filePath: string,
  autoAdmit: boolean
): boolean {
  const entry = findWorkingSetEntry(entries, filePath);

  return autoAdmit ? entry?.pinned === true : entry !== undefined;
}

export type PinToggleAction = "pin" | "unpin" | "close";

/**
 * What the pin and Shift+Enter do to one note. "close" goes through the
 * list's own close, which asks first when the note is dirty.
 *
 * Taking a pin away always takes the entry out of the list, in either mode:
 * a pin that leaves the row where it was looks like it did nothing, and the
 * pin is the only reason the user put that row there. What a note admitted
 * by editing does *not* get is this: its way out is the cross next to the
 * pin, so nothing the user never pinned disappears from a pin.
 */
export function pinToggleAction(
  entries: readonly WorkingSetEntry[],
  filePath: string,
  autoAdmit: boolean
): PinToggleAction {
  if (!isShownAsPinned(entries, filePath, autoAdmit)) {
    return "pin";
  }

  return "close";
}

/**
 * Shift+Enter on a multi-selection, one toggle for all of it. A mixed
 * selection has no single state to flip, so it goes towards pinned first:
 * as long as one note lacks its pin, the notes without one get it and none
 * loses one. Once every note is pinned, the next press takes all the pins
 * away, which closes the entries (the list's close queue, asking note by
 * note where one is dirty).
 */
export function pinSelectionToggle(
  entries: readonly WorkingSetEntry[],
  filePaths: readonly string[],
  autoAdmit: boolean
): { action: PinToggleAction; filePaths: string[] } {
  const unpinned = filePaths.filter((filePath) => !isShownAsPinned(entries, filePath, autoAdmit));

  if (unpinned.length > 0) {
    return { action: "pin", filePaths: unpinned };
  }

  return { action: "close", filePaths: [...filePaths] };
}

/** The clean entries that are not pinned; what "close saved" removes. */
export function closableWorkingSetEntries(
  entries: readonly WorkingSetEntry[],
  isDirty: (filePath: string) => boolean
): WorkingSetEntry[] {
  return entries.filter((entry) => !entry.pinned && !isDirty(entry.filePath));
}

export function normalizeStoredWorkingSet(parsed: unknown): StoredWorkingSet {
  if (typeof parsed !== "object" || parsed === null) {
    return { version: 1, entries: [] };
  }

  const rawEntries = (parsed as { entries?: unknown }).entries;

  if (!Array.isArray(rawEntries)) {
    return { version: 1, entries: [] };
  }

  const seen = new Set<string>();
  const entries: StoredWorkingSet["entries"] = [];

  for (const raw of rawEntries) {
    if (typeof raw !== "object" || raw === null) {
      continue;
    }

    const candidate = raw as { path?: unknown; pinned?: unknown };

    if (typeof candidate.path !== "string" || !candidate.path) {
      continue;
    }

    const path = candidate.path.replace(/\\/g, "/").replace(/^\/+/, "");
    const key = path.toLowerCase();

    if (!path || seen.has(key)) {
      continue;
    }

    seen.add(key);
    entries.push({ path, pinned: candidate.pinned === true });
  }

  return { version: 1, entries };
}

/**
 * The stored list resolved against the notes that exist: each relative path
 * is looked up in the current file list (case-insensitively, the list is the
 * authority on spelling), entries whose note is gone are dropped without a
 * word. `relativePathOf` turns a stored path into the key the lookup uses.
 */
export function resolveStoredWorkingSet(
  stored: StoredWorkingSet,
  filePaths: readonly string[],
  relativePathOf: (filePath: string) => string
): WorkingSetEntry[] {
  const byRelativeKey = new Map(filePaths.map((filePath) => [normalizePathKey(relativePathOf(filePath)), filePath]));
  const entries: WorkingSetEntry[] = [];

  for (const entry of stored.entries) {
    const filePath = byRelativeKey.get(normalizePathKey(entry.path));

    if (filePath) {
      entries.push({ filePath, pinned: entry.pinned });
    }
  }

  return entries;
}

export function toStoredWorkingSet(
  entries: readonly WorkingSetEntry[],
  relativePathOf: (filePath: string) => string
): StoredWorkingSet {
  return {
    version: 1,
    entries: entries.map((entry) => ({ path: relativePathOf(entry.filePath), pinned: entry.pinned }))
  };
}
