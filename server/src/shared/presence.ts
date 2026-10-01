import { randomBytes } from "node:crypto";
import { mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";

import { assertVaultPath } from "../vault/paths.js";
import { isValidUserName } from "./model.js";
import { SHARED_META_DIR_NAME } from "./registryStore.js";
import { replaceFile } from "./replaceFile.js";

/**
 * Who else has a note of a shared vault open: "bob has this note open too".
 * A hint, never a lock.
 *
 * The people's sockets live in different containers, so presence goes
 * through the shared folder: every instance writes the notes its person has
 * open into `.scribedog/presence/<user>.json` (rewritten on every change and
 * refreshed as a heartbeat), and reads the other people's files on a short
 * poll. An entry whose heartbeat is older than PRESENCE_TTL_MS is dropped,
 * which is what clears a container that was stopped without saying so.
 */

export type PresenceEditor = { user: string; path: string };

/** One person's file: which notes they have open, per vault. */
export type PresenceFile = { at: number; vaults: Record<string, string[]> };

export const PRESENCE_TTL_MS = 60_000;
const HEARTBEAT_MS = 20_000;
const MAX_PATH_LENGTH = 1024;

/** A path a client reported, if it is a plain vault-relative one; null otherwise. */
export function normalizePresencePath(raw: unknown): string | null {
  if (typeof raw !== "string" || raw.length > MAX_PATH_LENGTH) {
    return null;
  }

  try {
    return assertVaultPath(raw);
  } catch {
    return null;
  }
}

/** This person's open notes, from all their sockets, as one file. */
export function ownPresence(sessions: Iterable<{ vaultId: string; path: string | null }>, at: number): PresenceFile {
  const vaults: Record<string, string[]> = {};

  for (const { vaultId, path: notePath } of sessions) {
    if (notePath === null) {
      continue;
    }

    const paths = (vaults[vaultId] ??= []);

    if (!paths.includes(notePath)) {
      paths.push(notePath);
    }
  }

  return { at, vaults };
}

/** Who else has which note of `vaultId` open, from everybody's files; stale ones and oneself left out. */
export function editorsFor(
  files: Record<string, PresenceFile>,
  vaultId: string,
  me: string,
  now: number
): PresenceEditor[] {
  const editors: PresenceEditor[] = [];

  for (const [user, file] of Object.entries(files)) {
    if (user === me || now - file.at > PRESENCE_TTL_MS) {
      continue;
    }

    for (const notePath of file.vaults[vaultId] ?? []) {
      editors.push({ user, path: notePath });
    }
  }

  return editors.sort((left, right) => left.user.localeCompare(right.user) || left.path.localeCompare(right.path));
}

function parsePresenceFile(raw: unknown): PresenceFile | null {
  if (typeof raw !== "object" || raw === null) {
    return null;
  }

  const { at, vaults } = raw as { at?: unknown; vaults?: unknown };

  if (typeof at !== "number" || typeof vaults !== "object" || vaults === null) {
    return null;
  }

  const clean: Record<string, string[]> = {};

  for (const [vaultId, paths] of Object.entries(vaults)) {
    if (Array.isArray(paths)) {
      clean[vaultId] = paths.map(normalizePresencePath).filter((entry): entry is string => entry !== null);
    }
  }

  return { at, vaults: clean };
}

export type PresenceSession = {
  /** The note this socket has open, vault-relative; null for none. */
  setPath(rawPath: unknown): void;
  leave(): void;
};

export type Presence = {
  join(vaultId: string, push: (editors: PresenceEditor[]) => void): PresenceSession;
  close(): void;
};

export function createPresence(options: {
  root: string;
  user: string;
  pollMs: number;
  now: () => number;
  log: { warn(message: string): void };
}): Presence {
  const { user, pollMs, now, log } = options;
  const dir = path.join(options.root, SHARED_META_DIR_NAME, "presence");
  const ownFile = path.join(dir, `${user}.json`);
  const sessions = new Set<{ vaultId: string; path: string | null; push: (editors: PresenceEditor[]) => void; sent: string }>();
  let timer: NodeJS.Timeout | null = null;
  let lastWrite = 0;
  let writeScheduled = false;

  async function writeOwn(): Promise<void> {
    const at = now();
    lastWrite = at;

    try {
      await mkdir(dir, { recursive: true });

      if (sessions.size === 0) {
        await rm(ownFile, { force: true });
        return;
      }

      const tempPath = path.join(dir, `.${user}.${randomBytes(6).toString("hex")}.tmp`);
      await writeFile(tempPath, JSON.stringify(ownPresence(sessions, at)), "utf8");
      await replaceFile(tempPath, ownFile);
    } catch (error) {
      log.warn(`Could not write presence: ${(error as Error).message}`);
    }
  }

  /** Several path changes in a row (switching notes quickly) become one write. */
  function scheduleWrite(): void {
    if (writeScheduled) {
      return;
    }

    writeScheduled = true;
    setTimeout(() => {
      writeScheduled = false;
      void writeOwn().then(tick);
    }, 100).unref();
  }

  async function readOthers(): Promise<Record<string, PresenceFile>> {
    const files: Record<string, PresenceFile> = {};
    let names: string[];

    try {
      names = await readdir(dir);
    } catch {
      return files;
    }

    await Promise.all(
      names.map(async (name) => {
        const other = name.endsWith(".json") ? name.slice(0, -5) : null;

        if (!other || other === user || !isValidUserName(other)) {
          return;
        }

        try {
          const parsed = parsePresenceFile(JSON.parse(await readFile(path.join(dir, name), "utf8")));

          if (parsed) {
            files[other] = parsed;
          }
        } catch {
          // Being replaced right now, or not ours to read: next tick.
        }
      })
    );

    return files;
  }

  async function tick(): Promise<void> {
    if (sessions.size === 0) {
      return;
    }

    if (now() - lastWrite >= HEARTBEAT_MS) {
      await writeOwn();
    }

    const files = await readOthers();
    const time = now();

    for (const session of sessions) {
      const editors = editorsFor(files, session.vaultId, user, time);
      const key = JSON.stringify(editors);

      if (key !== session.sent) {
        session.sent = key;
        session.push(editors);
      }
    }
  }

  function ensureTimer(): void {
    if (!timer) {
      timer = setInterval(() => void tick(), pollMs);
      timer.unref();
    }
  }

  return {
    join(vaultId, push) {
      // "[]" counts as sent: nobody else being there needs no message.
      const session = { vaultId, path: null as string | null, push, sent: "[]" };
      sessions.add(session);
      ensureTimer();
      // Whoever is already there shows up at once, not on the next poll.
      void tick();

      return {
        setPath(rawPath) {
          const next = normalizePresencePath(rawPath);

          if (next !== session.path) {
            session.path = next;
            scheduleWrite();
          }
        },
        leave() {
          if (!sessions.delete(session)) {
            return;
          }

          scheduleWrite();

          if (sessions.size === 0 && timer) {
            clearInterval(timer);
            timer = null;
          }
        }
      };
    },

    close() {
      if (timer) {
        clearInterval(timer);
        timer = null;
      }

      sessions.clear();
      void rm(ownFile, { force: true }).catch(() => undefined);
    }
  };
}
