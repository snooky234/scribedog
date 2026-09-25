import { getRelativeDisplayPath } from "@/lib/fileSystem";
import { readWorkingSet, writeWorkingSet } from "@/lib/vaultMeta";

import { isDocumentDirty } from "./documents";
import { discardDraft } from "./drafts";
import type { AppSlice, FileDocumentState, WorkingSetSlice } from "./types";
import {
  addWorkingSetEntry,
  closableWorkingSetEntries,
  moveWorkingSetEntry,
  removeWorkingSetEntry,
  resolveStoredWorkingSet,
  setWorkingSetPinned,
  toStoredWorkingSet,
  type WorkingSetEntry
} from "./workingSet";

/**
 * Whether the stored list is put back on open. Registered by the editor
 * settings store rather than imported from it (same shape and reason as
 * stagedPaths.ts): that store touches `document` at load, which the store
 * tests running under Node must not pull in. Default is the setting's
 * default.
 */
let restoreWorkingSetProvider: (() => boolean) | null = null;

export function setRestoreWorkingSetProvider(next: (() => boolean) | null): void {
  restoreWorkingSetProvider = next;
}

function shouldRestoreWorkingSet(): boolean {
  try {
    return restoreWorkingSetProvider ? restoreWorkingSetProvider() : true;
  } catch {
    return true;
  }
}

/**
 * Whether editing a note admits it (the setting's default is off: pinning is
 * the only way in unless the user says otherwise). Same registration as above.
 */
let autoAdmitWorkingSetProvider: (() => boolean) | null = null;

export function setAutoAdmitWorkingSetProvider(next: (() => boolean) | null): void {
  autoAdmitWorkingSetProvider = next;
}

export function shouldAutoAdmitWorkingSet(): boolean {
  try {
    return autoAdmitWorkingSetProvider ? autoAdmitWorkingSetProvider() : false;
  } catch {
    return false;
  }
}

/**
 * Writes the list to `.scribedog/open-files.json`. Fire-and-forget and
 * undebounced: the list changes a few times an hour, not per keystroke.
 */
export function persistWorkingSet(folderPath: string | null, entries: readonly WorkingSetEntry[]): void {
  if (!folderPath) {
    return;
  }

  void writeWorkingSet(
    folderPath,
    toStoredWorkingSet(entries, (filePath) => getRelativeDisplayPath(folderPath, filePath))
  ).catch(() => undefined);
}

/**
 * The list a freshly opened vault starts with: the stored one, when the
 * setting says so, plus, where editing admits a note, every note that came
 * back dirty from its draft (the admission rule, applied to what hot exit
 * restored). With both settings off the list is empty and the dirty notes
 * are found by their dot in the tree.
 */
export async function loadInitialWorkingSet(
  folderPath: string,
  filePaths: readonly string[],
  fileDocuments: Record<string, FileDocumentState>
): Promise<WorkingSetEntry[]> {
  let entries: WorkingSetEntry[] = [];

  if (shouldRestoreWorkingSet()) {
    const stored = await readWorkingSet(folderPath);
    entries = resolveStoredWorkingSet(stored, filePaths, (filePath) => getRelativeDisplayPath(folderPath, filePath));
  }

  if (shouldAutoAdmitWorkingSet()) {
    for (const [filePath, document] of Object.entries(fileDocuments)) {
      if (isDocumentDirty(document)) {
        entries = addWorkingSetEntry(entries, filePath);
      }
    }
  }

  return entries;
}

export const createWorkingSetSlice: AppSlice<WorkingSetSlice> = (set, get) => ({
  pinWorkingSetEntry: (filePath: string) => {
    const { workingSet, folderPath } = get();
    const next = addWorkingSetEntry(workingSet, filePath, true);

    set({ workingSet: next });
    persistWorkingSet(folderPath, next);
  },
  unpinWorkingSetEntry: (filePath: string) => {
    const { workingSet, folderPath } = get();
    const next = setWorkingSetPinned(workingSet, filePath, false);

    set({ workingSet: next });
    persistWorkingSet(folderPath, next);
  },
  moveWorkingSetEntry: (filePath: string, beforeIndex: number) => {
    const { workingSet, folderPath } = get();
    const next = moveWorkingSetEntry(workingSet, filePath, beforeIndex);

    if (next.every((entry, index) => entry === workingSet[index])) {
      return;
    }

    set({ workingSet: next });
    persistWorkingSet(folderPath, next);
  },
  // Removing the entry is all the user sees. The note's document goes with
  // it when nothing needs it any more: clean and not the one on screen. The
  // open note keeps its document and stays open; it is only no longer listed.
  // A dirty note is never closed here: the UI asks first and calls
  // saveFilePath or discardFileChanges before this.
  closeWorkingSetEntry: (filePath: string) => {
    const { workingSet, folderPath, fileDocuments, selectedFilePath } = get();
    const next = removeWorkingSetEntry(workingSet, filePath);
    const document = fileDocuments[filePath];
    const nextDocuments = { ...fileDocuments };

    if (document && filePath !== selectedFilePath && !isDocumentDirty(document)) {
      delete nextDocuments[filePath];
    }

    set({ workingSet: next, fileDocuments: nextDocuments });
    persistWorkingSet(folderPath, next);
  },
  closeSavedWorkingSetEntries: () => {
    const { workingSet, fileDocuments } = get();
    const closable = closableWorkingSetEntries(workingSet, (filePath) => {
      const document = fileDocuments[filePath];
      return document ? isDocumentDirty(document) : false;
    });

    for (const entry of closable) {
      get().closeWorkingSetEntry(entry.filePath);
    }
  },
  // "Discard" for any note, open or not: back to the baseline, draft gone.
  // The open note mirrors into the selected-file fields like every other
  // mutation in the file slice does.
  discardFileChanges: (filePath: string) => {
    const { fileDocuments, selectedFilePath, folderPath } = get();
    const document = fileDocuments[filePath];

    if (!document) {
      return false;
    }

    discardDraft(folderPath, filePath);

    const isSelected = filePath === selectedFilePath;

    set({
      fileDocuments: {
        ...fileDocuments,
        [filePath]: { ...document, content: document.baseContent }
      },
      ...(isSelected
        ? {
            selectedFileContent: document.baseContent,
            selectedFileBaseContent: document.baseContent,
            isDirty: false,
            saveError: null,
            saveConflict: null
          }
        : {})
    });

    return true;
  }
});
