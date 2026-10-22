import { create } from "zustand";

import { compareReminders, extractNoteReminders, type NoteReminder, type VaultReminder } from "@/lib/reminders/vaultReminders";
import { readTextFile } from "@/platform/vaultFs";

// The vault-wide list behind the bell in the sidebar. The reminders live in
// the notes themselves (see reminderMarker.ts), so this is only an index: it
// is rebuilt from the files when a vault opens and kept current from what the
// app store already tracks. A note that is open (or has unsaved edits) is read
// from its in-memory document, every other note from disk whenever its mtime
// changes, which covers saves, the folder watcher and edits by the agent.

/** Where a file's entries were read from: the in-memory text, or the file at an mtime. */
type IndexSource = { kind: "document"; content: string } | { kind: "disk"; mtimeMs: number };

export type ReminderIndexInput = {
  folderPath: string | null;
  filePaths: string[];
  fileMtimeMs: Record<string, number>;
  /** The text of every note held in memory (open or with unsaved edits). */
  documents: Record<string, string>;
};

/** A reminder the editor should select once its note is open. */
export type ReminderRevealRequest = { filePath: string; ordinal: number; due: string };

type RemindersState = {
  folderPath: string | null;
  byFile: Record<string, NoteReminder[]>;
  sources: Record<string, IndexSource>;
  revealRequest: ReminderRevealRequest | null;
  /** Whether the sidebar's list is open; the overdue notice opens it too. */
  popoverOpen: boolean;

  syncIndex: (input: ReminderIndexInput, read?: (filePath: string) => Promise<string>) => Promise<void>;
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

let syncGeneration = 0;

export const useRemindersStore = create<RemindersState>((set, get) => ({
  folderPath: null,
  byFile: {},
  sources: {},
  revealRequest: null,
  popoverOpen: false,

  syncIndex: async (input, read = readTextFile) => {
    const generation = ++syncGeneration;
    const sameVault = get().folderPath === input.folderPath;
    const previousSources = sameVault ? get().sources : {};
    const previousByFile = sameVault ? get().byFile : {};

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

    let next = 0;

    const worker = async () => {
      while (next < toRead.length) {
        const filePath = toRead[next++];
        let found: NoteReminder[] = [];

        try {
          found = extractNoteReminders(await read(filePath));
        } catch {
          // Unreadable (deleted in the meantime, no permission): no reminders.
        }

        if (generation !== syncGeneration) {
          return;
        }

        if (found.length > 0) {
          byFile[filePath] = found;
        } else {
          delete byFile[filePath];
        }
      }
    };

    await Promise.all(Array.from({ length: Math.min(READ_CONCURRENCY, toRead.length) }, worker));

    if (generation === syncGeneration && toRead.length > 0) {
      set({ byFile: { ...byFile }, sources });
    } else if (generation === syncGeneration) {
      set({ sources });
    }
  },

  requestReveal: (revealRequest) => set({ revealRequest }),
  setPopoverOpen: (popoverOpen) => set({ popoverOpen })
}));

/** Every reminder of the vault, earliest first. */
export function listVaultReminders(byFile: Record<string, NoteReminder[]>): VaultReminder[] {
  return Object.entries(byFile)
    .flatMap(([filePath, reminders]) => reminders.map((reminder) => ({ ...reminder, filePath })))
    .sort(compareReminders);
}
