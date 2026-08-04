import { join } from "@tauri-apps/api/path";
import { exists, mkdir, readTextFile, remove, writeTextFile } from "@tauri-apps/plugin-fs";

import { VAULT_META_DIR_NAME } from "@/lib/fileSystem";

import { normalizeVaultPath, vaultPathKey } from "./vaultStaging";

/**
 * Undo for a completed agentic revision: one checkpoint per applied batch of
 * staged changes, holding every touched file's content from *before* the batch.
 *
 * Layout mirrors fileVersions.ts (full copies, no patch chain):
 *   .scribedog/checkpoints/index.json    -> { checkpoints: [...] }
 *   .scribedog/checkpoints/<blobId>.md   -> content BEFORE the change
 *
 * The reason it holds content rather than a diff: a deletion's only route back
 * is the text that was in the file. Anything cheaper than a full copy would
 * make "undo" a promise the delete case cannot keep.
 */

export type CheckpointEntry = {
  /** Vault-relative, the state BEFORE the change. */
  path: string;
  /** null = the file did not exist before, i.e. undoing means deleting it. */
  blobId: string | null;
};

export type Checkpoint = {
  id: string;
  sessionId: string;
  /** The assistant message the undo button hangs on. */
  messageIndex: number;
  createdAt: number;
  /** First line of the prompt that triggered it, for the confirmation dialog. */
  label: string;
  entries: CheckpointEntry[];
};

/** What createCheckpoint is handed: a path plus its content before the change. */
export type CheckpointSource = { path: string; content: string | null };

const CHECKPOINTS_DIR_NAME = "checkpoints";
const INDEX_FILE_NAME = "index.json";

/** Per session, oldest falls off. Full copies add up, and old undo is dead weight. */
export const MAX_CHECKPOINTS_PER_SESSION = 20;

async function checkpointsDirPath(folderPath: string): Promise<string> {
  return join(folderPath, VAULT_META_DIR_NAME, CHECKPOINTS_DIR_NAME);
}

async function indexFilePath(folderPath: string): Promise<string> {
  return join(await checkpointsDirPath(folderPath), INDEX_FILE_NAME);
}

async function blobPath(folderPath: string, blobId: string): Promise<string> {
  return join(await checkpointsDirPath(folderPath), `${blobId}.md`);
}

/**
 * index.json is read-modify-write, so two batches finishing at once would
 * otherwise interleave and drop one. Same single chain as fileVersions.ts.
 */
let indexWriteQueue: Promise<unknown> = Promise.resolve();

function enqueue<T>(task: () => Promise<T>): Promise<T> {
  const result = indexWriteQueue.then(task, task);
  indexWriteQueue = result.catch(() => undefined);
  return result;
}

function createId(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function normalizeEntry(raw: unknown): CheckpointEntry | null {
  if (typeof raw !== "object" || raw === null) {
    return null;
  }

  const candidate = raw as { path?: unknown; blobId?: unknown };

  if (typeof candidate.path !== "string" || !candidate.path) {
    return null;
  }

  return {
    path: normalizeVaultPath(candidate.path),
    blobId: typeof candidate.blobId === "string" && candidate.blobId ? candidate.blobId : null
  };
}

function normalizeCheckpoint(raw: unknown): Checkpoint | null {
  if (typeof raw !== "object" || raw === null) {
    return null;
  }

  const candidate = raw as Partial<Checkpoint> & { entries?: unknown };

  if (typeof candidate.id !== "string" || !candidate.id) {
    return null;
  }

  const entries = Array.isArray(candidate.entries)
    ? candidate.entries.map(normalizeEntry).filter((entry): entry is CheckpointEntry => entry !== null)
    : [];

  return {
    id: candidate.id,
    sessionId: typeof candidate.sessionId === "string" ? candidate.sessionId : "",
    messageIndex: typeof candidate.messageIndex === "number" ? candidate.messageIndex : -1,
    createdAt: typeof candidate.createdAt === "number" ? candidate.createdAt : Date.now(),
    label: typeof candidate.label === "string" ? candidate.label : "",
    entries
  };
}

async function readIndex(folderPath: string): Promise<Checkpoint[]> {
  try {
    const filePath = await indexFilePath(folderPath);

    if (!(await exists(filePath))) {
      return [];
    }

    const parsed: unknown = JSON.parse(await readTextFile(filePath));
    const rawList = (parsed as { checkpoints?: unknown })?.checkpoints;

    if (!Array.isArray(rawList)) {
      return [];
    }

    return rawList
      .map(normalizeCheckpoint)
      .filter((checkpoint): checkpoint is Checkpoint => checkpoint !== null)
      .sort((left, right) => left.createdAt - right.createdAt);
  } catch {
    return [];
  }
}

async function writeIndex(folderPath: string, checkpoints: Checkpoint[]): Promise<void> {
  const dirPath = await checkpointsDirPath(folderPath);
  await mkdir(dirPath, { recursive: true });
  await writeTextFile(await join(dirPath, INDEX_FILE_NAME), JSON.stringify({ checkpoints }, null, 2));
}

async function removeBlobs(folderPath: string, checkpoints: Checkpoint[]): Promise<void> {
  await Promise.all(
    checkpoints.flatMap((checkpoint) =>
      checkpoint.entries
        .filter((entry) => entry.blobId)
        .map((entry) =>
          blobPath(folderPath, entry.blobId as string)
            .then((path) => remove(path))
            .catch(() => undefined)
        )
    )
  );
}

/** Oldest first, so the chat can find the one belonging to a message. */
export async function listCheckpoints(folderPath: string): Promise<Checkpoint[]> {
  return enqueue(() => readIndex(folderPath));
}

/**
 * Writes the "before" content of every touched file and records the checkpoint.
 *
 * Awaited by the caller *before* the first write of the batch: for a deletion
 * the saved content is the only way back, so a checkpoint started alongside the
 * apply run would be a race with the thing it protects against.
 */
export async function createCheckpoint(
  folderPath: string,
  input: { sessionId: string; messageIndex: number; label: string; sources: CheckpointSource[] }
): Promise<Checkpoint | null> {
  if (input.sources.length === 0) {
    return null;
  }

  return enqueue(async () => {
    const dirPath = await checkpointsDirPath(folderPath);
    await mkdir(dirPath, { recursive: true });

    const entries: CheckpointEntry[] = [];

    for (const source of input.sources) {
      if (source.content === null) {
        entries.push({ path: normalizeVaultPath(source.path), blobId: null });
        continue;
      }

      const blobId = createId("blob");
      await writeTextFile(await join(dirPath, `${blobId}.md`), source.content);
      entries.push({ path: normalizeVaultPath(source.path), blobId });
    }

    const checkpoint: Checkpoint = {
      id: createId("cp"),
      sessionId: input.sessionId,
      messageIndex: input.messageIndex,
      createdAt: Date.now(),
      label: input.label,
      entries
    };

    const checkpoints = await readIndex(folderPath);
    const sameSession = [...checkpoints.filter((entry) => entry.sessionId === input.sessionId), checkpoint];
    const dropped = sameSession.slice(0, Math.max(0, sameSession.length - MAX_CHECKPOINTS_PER_SESSION));
    const droppedIds = new Set(dropped.map((entry) => entry.id));

    const next = [...checkpoints.filter((entry) => !droppedIds.has(entry.id)), checkpoint];

    await writeIndex(folderPath, next);
    await removeBlobs(folderPath, dropped);

    return checkpoint;
  });
}

export async function readCheckpointBlob(folderPath: string, blobId: string): Promise<string> {
  return readTextFile(await blobPath(folderPath, blobId));
}

/**
 * The checkpoints a jump back to `targetId` has to undo, newest first.
 *
 * This is the part a naive implementation gets wrong: each checkpoint only
 * saves the files of *its own* batch, so a file that a later batch touched does
 * not appear in the target checkpoint at all and would simply stay on its
 * newest state. Everything from the newest down to the target has to be undone,
 * in that order.
 */
export function checkpointsToRevert(checkpoints: Checkpoint[], targetId: string): Checkpoint[] {
  const index = checkpoints.findIndex((checkpoint) => checkpoint.id === targetId);

  if (index === -1) {
    return [];
  }

  return checkpoints.slice(index).reverse();
}

/**
 * Collapses those checkpoints into one desired state per path. Applied newest
 * first, the *oldest* entry for a path is the one that wins — it is the state
 * before the first of the batches being undone.
 */
export function resolveRevertTargets(checkpointsNewestFirst: Checkpoint[]): CheckpointEntry[] {
  const byPath = new Map<string, CheckpointEntry>();

  for (const checkpoint of checkpointsNewestFirst) {
    for (const entry of checkpoint.entries) {
      // Later iterations are older checkpoints, so overwriting is correct.
      byPath.set(vaultPathKey(entry.path), entry);
    }
  }

  return [...byPath.values()];
}

export async function deleteCheckpoints(folderPath: string, ids: string[]): Promise<void> {
  if (ids.length === 0) {
    return;
  }

  return enqueue(async () => {
    const checkpoints = await readIndex(folderPath);
    const removeSet = new Set(ids);
    const removed = checkpoints.filter((checkpoint) => removeSet.has(checkpoint.id));

    if (removed.length === 0) {
      return;
    }

    await writeIndex(
      folderPath,
      checkpoints.filter((checkpoint) => !removeSet.has(checkpoint.id))
    );
    await removeBlobs(folderPath, removed);
  });
}

/** Checkpoints belong to their chat session: deleting or capping one takes them along. */
export async function deleteCheckpointsForSessions(
  folderPath: string,
  sessionIds: string[]
): Promise<void> {
  if (sessionIds.length === 0) {
    return;
  }

  return enqueue(async () => {
    const checkpoints = await readIndex(folderPath);
    const sessionSet = new Set(sessionIds);
    const removed = checkpoints.filter((checkpoint) => sessionSet.has(checkpoint.sessionId));

    if (removed.length === 0) {
      return;
    }

    await writeIndex(
      folderPath,
      checkpoints.filter((checkpoint) => !sessionSet.has(checkpoint.sessionId))
    );
    await removeBlobs(folderPath, removed);
  });
}

/** Drops checkpoints whose session no longer exists (FIFO cap in the chat store). */
export async function pruneCheckpointsToSessions(
  folderPath: string,
  liveSessionIds: string[]
): Promise<void> {
  return enqueue(async () => {
    const checkpoints = await readIndex(folderPath);
    const live = new Set(liveSessionIds);
    const removed = checkpoints.filter((checkpoint) => !live.has(checkpoint.sessionId));

    if (removed.length === 0) {
      return;
    }

    await writeIndex(
      folderPath,
      checkpoints.filter((checkpoint) => live.has(checkpoint.sessionId))
    );
    await removeBlobs(folderPath, removed);
  });
}
