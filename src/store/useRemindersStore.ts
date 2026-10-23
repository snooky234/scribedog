import { create } from "zustand";

import type { ReminderVaultReader } from "@/lib/reminders/reminderVaultReader";
import { compareReminders, extractNoteReminders, type NoteReminder, type VaultReminder } from "@/lib/reminders/vaultReminders";
import { readTextFile } from "@/platform/vaultFs";

// The list behind the bell in the sidebar, across every vault of the vault
// menu. The reminders live in the notes themselves (see reminderMarker.ts),
// so this is only an index. The open vault's part is kept current from what
// the app store already tracks: a note that is open (or has unsaved edits) is
// read from its in-memory document, every other note from disk whenever its
// mtime changes, which covers saves, the folder watcher and edits by the
// agent. The other vaults have no watcher; they are scanned now and then
// (useReminderScheduler), again reading only what changed.

/** Where a file's entries were read from: the in-memory text, or the file at an mtime. */
type IndexSource = { kind: "document"; content: string } | { kind: "disk"; mtimeMs: number };

export type ReminderIndexInput = {
  folderPath: string | null;
  filePaths: string[];
  fileMtimeMs: Record<string, number>;
  /** The text of every note held in memory (open or with unsaved edits). */
  documents: Record<string, string>;
};

/** What is known about a vault that is not open: its reminders, and the mtimes they were read at. */
export type BackgroundVaultIndex = {
  byFile: Record<string, NoteReminder[]>;
  mtimes: Record<string, number>;
};

/** A reminder the editor should select once its note is open. */
export type ReminderRevealRequest = { filePath: string; ordinal: number; due: string };

type RemindersState = {
  folderPath: string | null;
  byFile: Record<string, NoteReminder[]>;
  sources: Record<string, IndexSource>;
  /** Every other vault of the vault menu, by root. */
  otherVaults: Record<string, BackgroundVaultIndex>;
  revealRequest: ReminderRevealRequest | null;
  /** Whether the sidebar's list is open; the overdue notice opens it too. */
  popoverOpen: boolean;

  syncIndex: (input: ReminderIndexInput, read?: (filePath: string) => Promise<string>) => Promise<void>;
  /** Reads a vault that is not open; rejects when it cannot be listed, keeping what was known. */
  scanVault: (root: string, reader: ReminderVaultReader) => Promise<void>;
  /** Forgets the vaults that left the vault menu. */
  retainVaults: (roots: string[]) => void;
  requestReveal: (request: ReminderRevealRequest | null) => void;
  setPopoverOpen: (open: boolean) => void;
};

const READ_CONCURRENCY = 4;

function sameSource(a: IndexSource | undefined, b: IndexSource): boolean {
  if (!a || a.kind !== b.kind) {
    return false;
  }

  return a.kind === "document" ? a.content === (b as { content: string }).content : a.mtimeMs === (b as { mtimeMs: number }).mtimeMs;
}

// What a vault's live index leaves behind once another vault opens: a note
// read from memory gets no mtime, so the next scan reads it from disk.
function toBackgroundIndex(byFile: Record<string, NoteReminder[]>, sources: Record<string, IndexSource>): BackgroundVaultIndex {
  const mtimes: Record<string, number> = {};

  for (const [filePath, source] of Object.entries(sources)) {
    if (source.kind === "disk") {
      mtimes[filePath] = source.mtimeMs;
    }
  }

  return { byFile, mtimes };
}

/**
 * Reads the files a few at a time. `onRead` gets null for a file that could
 * not be read and answers whether to go on.
 */
async function readAll(
  filePaths: string[],
  read: (filePath: string) => Promise<string>,
  onRead: (filePath: string, found: NoteReminder[] | null) => boolean
): Promise<void> {
  let next = 0;

  const worker = async () => {
    while (next < filePaths.length) {
      const filePath = filePaths[next++];
      let found: NoteReminder[] | null;

      try {
        found = extractNoteReminders(await read(filePath));
      } catch {
        // Unreadable (deleted in the meantime, no permission): no reminders.
        found = null;
      }

      if (!onRead(filePath, found)) {
        return;
      }
    }
  };

  await Promise.all(Array.from({ length: Math.min(READ_CONCURRENCY, filePaths.length) }, worker));
}

let syncGeneration = 0;

export const useRemindersStore = create<RemindersState>((set, get) => ({
  folderPath: null,
  byFile: {},
  sources: {},
  otherVaults: {},
  revealRequest: null,
  popoverOpen: false,

  syncIndex: async (input, read = readTextFile) => {
    const generation = ++syncGeneration;
    const state = get();
    const sameVault = state.folderPath === input.folderPath;
    let previousSources = sameVault ? state.sources : {};
    let previousByFile = sameVault ? state.byFile : {};

    if (!sameVault) {
      // The vault that closes stays in the list as one of the others, and the
      // one that opens starts from what its last scan found.
      const otherVaults = { ...state.otherVaults };

      if (state.folderPath) {
        otherVaults[state.folderPath] = toBackgroundIndex(state.byFile, state.sources);
      }

      const known = input.folderPath ? otherVaults[input.folderPath] : undefined;

      if (known && input.folderPath) {
        previousByFile = known.byFile;
        previousSources = Object.fromEntries(
          Object.entries(known.mtimes).map(([filePath, mtimeMs]): [string, IndexSource] => [filePath, { kind: "disk", mtimeMs }])
        );
        delete otherVaults[input.folderPath];
      }

      set({ otherVaults });
    }

    if (!input.folderPath) {
      set({ folderPath: null, byFile: {}, sources: {} });
      return;
    }

    const byFile: Record<string, NoteReminder[]> = {};
    const sources: Record<string, IndexSource> = {};
    const toRead: string[] = [];

    for (const filePath of input.filePaths) {
      const content = input.documents[filePath];
      const source: IndexSource =
        content !== undefined ? { kind: "document", content } : { kind: "disk", mtimeMs: input.fileMtimeMs[filePath] ?? 0 };

      sources[filePath] = source;

      if (sameSource(previousSources[filePath], source)) {
        if (previousByFile[filePath]) {
          byFile[filePath] = previousByFile[filePath];
        }
      } else if (source.kind === "document") {
        const found = extractNoteReminders(source.content);

        if (found.length > 0) {
          byFile[filePath] = found;
        }
      } else {
        toRead.push(filePath);
      }
    }

    // What is known right away is shown right away; the files that have to
    // be read keep their previous entries until they are.
    for (const filePath of toRead) {
      if (previousByFile[filePath]) {
        byFile[filePath] = previousByFile[filePath];
      }
    }

    // A file still to be read keeps its previous source too, so a sync that
    // overtakes this one reads it again instead of taking it as current.
    const settledSources = { ...sources };

    for (const filePath of toRead) {
      if (previousSources[filePath]) {
        settledSources[filePath] = previousSources[filePath];
      } else {
        delete settledSources[filePath];
      }
    }

    set({ folderPath: input.folderPath, byFile: { ...byFile }, sources: settledSources });

    await readAll(toRead, read, (filePath, found) => {
      if (generation !== syncGeneration) {
        return false;
      }

      if (found && found.length > 0) {
        byFile[filePath] = found;
      } else {
        delete byFile[filePath];
      }

      return true;
    });

    if (generation === syncGeneration && toRead.length > 0) {
      set({ byFile: { ...byFile }, sources });
    } else if (generation === syncGeneration) {
      set({ sources });
    }
  },

  scanVault: async (root, reader) => {
    const previous = get().otherVaults[root];
    const records = await reader.listMarkdownFiles(root, previous?.mtimes ?? {});
    const byFile: Record<string, NoteReminder[]> = {};
    const mtimes: Record<string, number> = {};
    const toRead: string[] = [];
    const mtimeOf = new Map<string, number>();

    for (const { filePath, mtimeMs } of records) {
      mtimeOf.set(filePath, mtimeMs);

      if (previous && previous.mtimes[filePath] === mtimeMs) {
        mtimes[filePath] = mtimeMs;

        if (previous.byFile[filePath]) {
          byFile[filePath] = previous.byFile[filePath];
        }
      } else {
        toRead.push(filePath);
      }
    }

    await readAll(
      toRead,
      (filePath) => reader.readTextFile(filePath),
      (filePath, found) => {
        // Without an mtime, a file that could not be read is tried again next time.
        if (found) {
          mtimes[filePath] = mtimeOf.get(filePath) ?? 0;
        }

        if (found && found.length > 0) {
          byFile[filePath] = found;
        }

        return true;
      }
    );

    // Opened while it was being read: the live index has it now.
    if (get().folderPath !== root) {
      set((state) => ({ otherVaults: { ...state.otherVaults, [root]: { byFile, mtimes } } }));
    }
  },

  retainVaults: (roots) => {
    const keep = new Set(roots);

    set((state) => ({
      otherVaults: Object.fromEntries(Object.entries(state.otherVaults).filter(([root]) => keep.has(root)))
    }));
  },

  requestReveal: (revealRequest) => set({ revealRequest }),
  setPopoverOpen: (popoverOpen) => set({ popoverOpen })
}));

/** Every reminder of one vault, earliest first. */
export function listVaultReminders(byFile: Record<string, NoteReminder[]>, vaultRoot: string): VaultReminder[] {
  return Object.entries(byFile)
    .flatMap(([filePath, reminders]) => reminders.map((reminder) => ({ ...reminder, filePath, vaultRoot })))
    .sort(compareReminders);
}

/** Every reminder of every vault the list knows, the open one included, earliest first. */
export function listAllReminders(state: Pick<RemindersState, "folderPath" | "byFile" | "otherVaults">): VaultReminder[] {
  const reminders = state.folderPath ? listVaultReminders(state.byFile, state.folderPath) : [];

  for (const [root, index] of Object.entries(state.otherVaults)) {
    if (root !== state.folderPath) {
      reminders.push(...listVaultReminders(index.byFile, root));
    }
  }

  return reminders.sort(compareReminders);
}
