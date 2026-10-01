import {
  deleteDraft,
  deleteFolderDrafts,
  loadDrafts,
  moveDraft,
  moveFolderDrafts,
  writeDraft
} from "@/lib/drafts";
import { getFolderNotePath, isFolderNotePath } from "@/lib/folderNotes";
import { getRelativeDisplayPath } from "@/lib/vaultPaths";
import { join } from "@/platform/paths";
import type { MarkdownFileRecord } from "@/platform/types";

import { normalizePathKey } from "./pathUtils";
import type { FileDocumentState } from "./types";

/**
 * Bridges the store slices to the draft storage (lib/drafts.ts): what keeps
 * unsaved edits across a restart.
 *
 * Drafts are written debounced, not per keystroke: vaults often live in
 * Dropbox, Syncthing or Git, where a write per second is constant churn. The
 * pause is long enough that a save (auto or manual) usually lands first and
 * simply deletes the pending draft. What the pause costs in coverage the
 * flush points win back: every place the app leaves a document, a vault or
 * the foreground calls flushDrafts(), and the pending writes go out at once.
 *
 * Every write is fire-and-forget from the slices' point of view; a draft
 * must never slow down or fail typing. The one exception is the flush before
 * a vault switch, which the folder slice awaits so nothing is left in the
 * timer when the document map is thrown away.
 */

export const DRAFT_WRITE_DELAY_MS = 5_000;

type PendingDraft = {
  folderPath: string;
  filePath: string;
  content: string;
  baseMtimeMs: number | null;
};

/** Keyed by absolute file path; one timer and one pending payload per note. */
const pendingByPath = new Map<string, { draft: PendingDraft; timer: ReturnType<typeof setTimeout> }>();

function relativeKey(folderPath: string, filePath: string): string {
  return getRelativeDisplayPath(folderPath, filePath);
}

function cancelPending(filePath: string): PendingDraft | null {
  const pending = pendingByPath.get(filePath);

  if (!pending) {
    return null;
  }

  clearTimeout(pending.timer);
  pendingByPath.delete(filePath);

  return pending.draft;
}

function commit(draft: PendingDraft): Promise<void> {
  return writeDraft(
    draft.folderPath,
    relativeKey(draft.folderPath, draft.filePath),
    draft.content,
    draft.baseMtimeMs
  ).catch(() => undefined);
}

/** A dirty document changed; its draft is (re)written after the pause. */
export function scheduleDraft(
  folderPath: string | null,
  filePath: string,
  content: string,
  baseMtimeMs: number | null
): void {
  if (!folderPath) {
    return;
  }

  cancelPending(filePath);

  const draft: PendingDraft = { folderPath, filePath, content, baseMtimeMs };
  const timer = setTimeout(() => {
    pendingByPath.delete(filePath);
    void commit(draft);
  }, DRAFT_WRITE_DELAY_MS);

  pendingByPath.set(filePath, { draft, timer });
}

/**
 * The document is clean again (saved, discarded, reverted by typing): no
 * draft, pending or on disk.
 */
export function discardDraft(folderPath: string | null, filePath: string): void {
  cancelPending(filePath);

  if (!folderPath) {
    return;
  }

  void deleteDraft(folderPath, relativeKey(folderPath, filePath)).catch(() => undefined);
}

/**
 * Writes every pending draft now. Called on file switch, vault switch, the
 * window losing focus or going hidden, and on close. Resolves once the
 * writes are done, so a caller that is about to drop the document map (or
 * the whole window) can wait for it.
 */
export function flushDrafts(): Promise<void> {
  const drafts: PendingDraft[] = [];

  for (const filePath of [...pendingByPath.keys()]) {
    const draft = cancelPending(filePath);

    if (draft) {
      drafts.push(draft);
    }
  }

  return Promise.all(drafts.map(commit)).then(() => undefined);
}

/** True while a draft write is waiting on the timer; for tests and the close guard. */
export function hasPendingDrafts(): boolean {
  return pendingByPath.size > 0;
}

/**
 * The note was renamed or moved. A pending write for the old path is
 * committed first so the move finds it; the storage serializes both.
 */
export function moveDraftFor(folderPath: string | null, oldFilePath: string, newFilePath: string): void {
  if (!folderPath) {
    return;
  }

  const pending = cancelPending(oldFilePath);

  if (pending) {
    void commit(pending);
  }

  void moveDraft(
    folderPath,
    relativeKey(folderPath, oldFilePath),
    relativeKey(folderPath, newFilePath)
  ).catch(() => undefined);
}

export function moveFolderDraftsFor(
  folderPath: string | null,
  oldFolderPath: string,
  newFolderPath: string
): void {
  if (!folderPath) {
    return;
  }

  const oldKey = normalizePathKey(oldFolderPath);

  for (const filePath of [...pendingByPath.keys()]) {
    if (normalizePathKey(filePath).startsWith(`${oldKey}/`)) {
      const pending = cancelPending(filePath);

      if (pending) {
        void commit(pending);
      }
    }
  }

  void moveFolderDrafts(
    folderPath,
    relativeKey(folderPath, oldFolderPath),
    relativeKey(folderPath, newFolderPath)
  ).catch(() => undefined);
}

export function deleteFolderDraftsFor(folderPath: string | null, deletedFolderPath: string): void {
  const deletedKey = normalizePathKey(deletedFolderPath);

  for (const filePath of [...pendingByPath.keys()]) {
    if (normalizePathKey(filePath).startsWith(`${deletedKey}/`)) {
      cancelPending(filePath);
    }
  }

  if (!folderPath) {
    return;
  }

  void deleteFolderDrafts(folderPath, relativeKey(folderPath, deletedFolderPath)).catch(() => undefined);
}

/**
 * The absolute path an unwritten folder note's draft belongs to, or null when
 * the draft is not a folder note or its folder is gone (nothing under it on
 * disk). The vault root always exists, so its note always qualifies.
 */
async function unwrittenFolderNoteFor(
  folderPath: string,
  relativePath: string,
  markdownFiles: MarkdownFileRecord[]
): Promise<string | null> {
  if (!isFolderNotePath(relativePath)) {
    return null;
  }

  const slashIndex = relativePath.lastIndexOf("/");
  const folderRelativePath = slashIndex === -1 ? "" : relativePath.slice(0, slashIndex);
  const folderKey = normalizePathKey(folderRelativePath);
  const folderExists =
    folderRelativePath === "" ||
    markdownFiles.some((record) => normalizePathKey(record.relativePath).startsWith(`${folderKey}/`));

  if (!folderExists) {
    return null;
  }

  return getFolderNotePath(folderRelativePath ? await join(folderPath, folderRelativePath) : folderPath);
}

/**
 * The documents a freshly opened vault starts with: one per draft, with the
 * draft as content and the file on disk as baseline, so the note opens dirty
 * exactly as it was left. `readFile` is injected so the folder slice can
 * hand over its own reader (and a test a map).
 *
 * A draft whose file is gone was edited in a note someone deleted outside
 * the app; there is nothing to show it against, so it is dropped, the same
 * way the version history of a deleted file goes. A draft equal to what is
 * on disk (the file was saved with that content from elsewhere) is dropped
 * too: restoring it would flag a clean note as changed.
 */
export async function loadDraftDocuments(
  folderPath: string,
  markdownFiles: MarkdownFileRecord[],
  readFile: (filePath: string) => Promise<string>
): Promise<Record<string, FileDocumentState>> {
  const drafts = await loadDrafts(folderPath).catch(() => []);

  if (drafts.length === 0) {
    return {};
  }

  const fileByRelativeKey = new Map(
    markdownFiles.map((record) => [normalizePathKey(record.relativePath), record] as const)
  );
  const documents: Record<string, FileDocumentState> = {};

  await Promise.all(
    drafts.map(async (draft) => {
      const record = fileByRelativeKey.get(normalizePathKey(draft.relativePath));

      if (!record) {
        // A folder note that was typed into but never saved has no file yet;
        // as long as its folder is still there, the draft is the whole note.
        const unwrittenFolderNotePath = await unwrittenFolderNoteFor(folderPath, draft.relativePath, markdownFiles);

        if (unwrittenFolderNotePath) {
          documents[unwrittenFolderNotePath] = { content: draft.content, baseContent: "", baseMtimeMs: null, baseVersion: null };
          return;
        }

        void deleteDraft(folderPath, draft.relativePath).catch(() => undefined);
        return;
      }

      try {
        const baseContent = await readFile(record.filePath);

        if (baseContent === draft.content) {
          void deleteDraft(folderPath, draft.relativePath).catch(() => undefined);
          return;
        }

        documents[record.filePath] = { content: draft.content, baseContent, baseMtimeMs: record.mtimeMs };
      } catch {
        // Unreadable right now (permissions, a sync client holding it): the
        // draft stays for the next open rather than being thrown away.
      }
    })
  );

  return documents;
}
