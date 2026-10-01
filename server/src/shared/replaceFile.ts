import { rename } from "node:fs/promises";

const RETRYABLE_CODES = new Set(["EPERM", "EACCES", "EBUSY"]);
const ATTEMPTS = 5;

/**
 * Moves a freshly written temp file over its target. On Linux, where the
 * server runs in production, a rename replaces the target atomically however
 * many readers have it open. On Windows (development) a reader holding the
 * target open makes the rename fail for a moment, and the files written this
 * way (the registry, presence) are read without a lock by every instance; a
 * short retry rides that out.
 */
export async function replaceFile(tempPath: string, targetPath: string): Promise<void> {
  for (let attempt = 1; ; attempt += 1) {
    try {
      await rename(tempPath, targetPath);
      return;
    } catch (error) {
      if (attempt >= ATTEMPTS || !RETRYABLE_CODES.has((error as NodeJS.ErrnoException).code ?? "")) {
        throw error;
      }

      await new Promise((resolve) => setTimeout(resolve, 20 * attempt));
    }
  }
}
