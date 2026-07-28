// Turns what a drag from outside the app offered — a mix of files and folders —
// into the flat, filtered list the importer works on.
//
// The webview hands over File objects, never paths: the app runs with Tauri's
// native drag and drop switched off (`dragDropEnabled: false` in
// tauri.conf.json), because on Windows the native handler takes over the whole
// window and would kill every HTML5 drag inside the app — reordering the file
// tree, dragging a note into the editor, dragging one into the chat. So the
// conversion works off the bytes the browser already holds (see ConvertSource),
// and folders are walked through the webkitGetAsEntry API rather than readDir.

import { isConvertibleFileName, sourceFromFile } from "@/lib/import/convert";
import type { ImportSource } from "@/lib/import/importer";

/**
 * Ceiling on one drop. Dropping a home folder by accident should end in a
 * question, not in an hour of conversions — and with images in the batch every
 * file is a paid AI request.
 */
export const MAX_DROPPED_FILES = 100;

export type CollectedSources = {
  sources: ImportSource[];
  /** Files inside a dropped folder that no converter handles. */
  skipped: number;
  /** True when MAX_DROPPED_FILES cut the walk short. */
  limitReached: boolean;
};

/** Whether a drag carries files from outside the app rather than an in-app payload. */
export function carriesExternalFiles(dataTransfer: DataTransfer | null): boolean {
  return Array.from(dataTransfer?.types ?? []).includes("Files");
}

function readEntryFile(entry: FileSystemFileEntry): Promise<File | null> {
  return new Promise((resolve) => {
    entry.file(
      (file) => resolve(file),
      () => resolve(null)
    );
  });
}

/**
 * One directory's children. readEntries hands out at most 100 entries per call
 * and signals the end with an empty batch, so it has to be drained in a loop —
 * reading it once silently truncates every folder past the hundredth file.
 */
function readAllEntries(reader: FileSystemDirectoryReader): Promise<FileSystemEntry[]> {
  return new Promise((resolve) => {
    const all: FileSystemEntry[] = [];

    const readBatch = () => {
      reader.readEntries(
        (batch) => {
          if (batch.length === 0) {
            resolve(all);
            return;
          }

          all.push(...batch);
          readBatch();
        },
        () => resolve(all)
      );
    };

    readBatch();
  });
}

async function walkEntry(
  entry: FileSystemEntry,
  relativeDirectory: string,
  collected: CollectedSources
): Promise<void> {
  if (collected.sources.length >= MAX_DROPPED_FILES) {
    collected.limitReached = true;
    return;
  }

  // Dot folders are tool state (.git, .obsidian, ScribeDog's own .scribedog),
  // never content someone meant to import.
  if (entry.name.startsWith(".")) {
    return;
  }

  if (entry.isDirectory) {
    const children = await readAllEntries((entry as FileSystemDirectoryEntry).createReader());
    const childDirectory = relativeDirectory ? `${relativeDirectory}/${entry.name}` : entry.name;

    for (const child of children) {
      await walkEntry(child, childDirectory, collected);
    }

    return;
  }

  if (!isConvertibleFileName(entry.name)) {
    collected.skipped += 1;
    return;
  }

  const file = await readEntryFile(entry as FileSystemFileEntry);

  if (!file) {
    collected.skipped += 1;
    return;
  }

  collected.sources.push({ source: sourceFromFile(file), relativeDirectory });
}

/** What a drop offered, taken out of the DataTransfer while it is still valid. */
export type DropPayload = {
  entries: FileSystemEntry[];
  files: File[];
};

/**
 * Takes the dropped items out of the transfer. Must be called inside the drop
 * handler itself: the DataTransfer is emptied the moment that handler returns,
 * while the entries taken here stay valid for the async walk afterwards.
 *
 * Both shapes are kept — the entries carry folders, the file list is the
 * fallback where the entry API is unavailable.
 */
export function readDropPayload(dataTransfer: DataTransfer): DropPayload {
  const entries = Array.from(dataTransfer.items ?? [])
    .filter((item) => item.kind === "file")
    .map((item) => (item.webkitGetAsEntry ? item.webkitGetAsEntry() : null))
    .filter((entry): entry is FileSystemEntry => entry !== null);

  return { entries, files: Array.from(dataTransfer.files) };
}

/**
 * Expands a drop into importable files, recreating the folder structure per
 * file so the import can mirror it.
 */
export async function collectDroppedSources(payload: DropPayload): Promise<CollectedSources> {
  const collected: CollectedSources = { sources: [], skipped: 0, limitReached: false };

  if (payload.entries.length > 0) {
    for (const entry of payload.entries) {
      await walkEntry(entry, "", collected);
    }

    return collected;
  }

  // No entry API: folders cannot be recognised here, and a folder dropped in
  // this mode arrives as an unreadable zero-byte entry — which is why it ends
  // up counted as skipped rather than pretending to import it.
  for (const file of payload.files) {
    if (collected.sources.length >= MAX_DROPPED_FILES) {
      collected.limitReached = true;
      break;
    }

    if (!isConvertibleFileName(file.name)) {
      collected.skipped += 1;
      continue;
    }

    collected.sources.push({ source: sourceFromFile(file), relativeDirectory: "" });
  }

  return collected;
}
