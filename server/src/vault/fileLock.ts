import { createHash } from "node:crypto";
import { mkdir, open, rm, stat } from "node:fs/promises";
import path from "node:path";

/** The lock stayed taken for longer than a write can reasonably need. */
export class FileLockTimeoutError extends Error {}

export type FileLockOptions = {
  /** How long to keep retrying before giving up with FileLockTimeoutError. */
  timeoutMs?: number;
  /**
   * A lock file older than this is left over from a process that died while
   * holding it (a container killed mid-write) and is broken. Far above the
   * time one read-compare-write takes, so a live holder is never robbed.
   */
  staleMs?: number;
};

export type FileLocks = {
  /** Runs `task` while holding the lock for `key`, across processes. */
  withLock<T>(key: string, task: () => Promise<T>): Promise<T>;
};

const DEFAULT_TIMEOUT_MS = 2_000;
const DEFAULT_STALE_MS = 30_000;

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Per-key locks for a read-compare-write that has to be one step.
 *
 * Two layers, because one is not enough for either case: several containers
 * of a multi-instance setup write to the same disk, so an in-process mutex
 * cannot see the others; and polling a lock file is a poor way for two
 * requests of the same process to wait for each other. Within the process
 * the requests queue on a promise chain; across processes the holder owns a
 * lock file created with O_EXCL, which only one of them can create.
 *
 * The lock files live in `lockDirectory` (the server's own part of the
 * metadata directory), named by a hash of the key so no path ever has to be
 * escaped and the watcher and the file tree never see them.
 */
export function createFileLocks(lockDirectory: string, options: FileLockOptions = {}): FileLocks {
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const staleMs = options.staleMs ?? DEFAULT_STALE_MS;
  const queues = new Map<string, Promise<unknown>>();

  function lockPathFor(key: string): string {
    return path.join(lockDirectory, `${createHash("sha256").update(key, "utf8").digest("hex")}.lock`);
  }

  async function acquire(lockPath: string): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    let wait = 10;

    await mkdir(lockDirectory, { recursive: true });

    for (;;) {
      try {
        const handle = await open(lockPath, "wx");
        await handle.close();
        return;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "EEXIST") {
          throw error;
        }
      }

      const age = await stat(lockPath)
        .then((info) => Date.now() - info.mtimeMs)
        .catch(() => null);

      if (age !== null && age > staleMs) {
        // Several processes may break the same stale lock at once; only one
        // of them wins the following O_EXCL create, so that is harmless.
        await rm(lockPath, { force: true });
        continue;
      }

      if (Date.now() >= deadline) {
        throw new FileLockTimeoutError("The file is being written by someone else. Try again in a moment.");
      }

      await delay(wait);
      wait = Math.min(wait * 2, 100);
    }
  }

  return {
    async withLock(key, task) {
      const previous = queues.get(key) ?? Promise.resolve();
      const run = previous
        .catch(() => undefined)
        .then(async () => {
          const lockPath = lockPathFor(key);
          await acquire(lockPath);

          try {
            return await task();
          } finally {
            await rm(lockPath, { force: true }).catch(() => undefined);
          }
        });

      queues.set(key, run);

      try {
        return await run;
      } finally {
        if (queues.get(key) === run) {
          queues.delete(key);
        }
      }
    }
  };
}
