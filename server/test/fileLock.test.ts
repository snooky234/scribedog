import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readdir, rm, utimes, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createFileLocks, FileLockTimeoutError } from "../src/vault/fileLock.js";

describe("file locks", () => {
  let lockDirectory: string;

  beforeEach(async () => {
    lockDirectory = path.join(await mkdtemp(path.join(os.tmpdir(), "scribedog-locks-")), "locks");
  });

  afterEach(async () => {
    await rm(path.dirname(lockDirectory), { recursive: true, force: true });
  });

  async function runOverlapping(first: ReturnType<typeof createFileLocks>, second: ReturnType<typeof createFileLocks>) {
    const events: string[] = [];
    const task = (name: string) => async () => {
      events.push(`${name}:start`);
      await new Promise((resolve) => setTimeout(resolve, 30));
      events.push(`${name}:end`);
    };

    await Promise.all([first.withLock("Note.md", task("a")), second.withLock("Note.md", task("b"))]);

    return events;
  }

  it("serializes tasks on the same key within one process", async () => {
    const locks = createFileLocks(lockDirectory);

    expect(await runOverlapping(locks, locks)).toEqual(["a:start", "a:end", "b:start", "b:end"]);
  });

  it("serializes tasks across two independent lock sets, as two containers would", async () => {
    const events = await runOverlapping(createFileLocks(lockDirectory), createFileLocks(lockDirectory));

    expect(events.indexOf("a:end")).toBe(events.indexOf("a:start") + 1);
    expect(events.indexOf("b:end")).toBe(events.indexOf("b:start") + 1);
  });

  it("releases the lock when the task throws", async () => {
    const locks = createFileLocks(lockDirectory);

    await expect(locks.withLock("Note.md", async () => Promise.reject(new Error("boom")))).rejects.toThrow("boom");
    expect(await locks.withLock("Note.md", async () => "next")).toBe("next");
    expect(await readdir(lockDirectory)).toEqual([]);
  });

  // The lock file another process would hold, created by hand.
  async function plantForeignLock(ageMs: number) {
    await mkdir(lockDirectory, { recursive: true });
    const lockPath = path.join(lockDirectory, `${createHash("sha256").update("Note.md", "utf8").digest("hex")}.lock`);
    await writeFile(lockPath, "");
    const time = new Date(Date.now() - ageMs);
    await utimes(lockPath, time, time);
  }

  it("gives up with a timeout while another process holds the lock", async () => {
    await plantForeignLock(0);

    await expect(
      createFileLocks(lockDirectory, { timeoutMs: 50 }).withLock("Note.md", async () => "never")
    ).rejects.toBeInstanceOf(FileLockTimeoutError);
  });

  it("breaks a lock left behind by a process that died while holding it", async () => {
    await plantForeignLock(60_000);

    expect(await createFileLocks(lockDirectory, { timeoutMs: 50 }).withLock("Note.md", async () => "ok")).toBe("ok");
    expect(await readdir(lockDirectory)).toEqual([]);
  });
});
