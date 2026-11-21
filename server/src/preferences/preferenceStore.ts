import { randomBytes } from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";

import { SERVER_META_DIR } from "../auth/authStore.js";
import { replaceFile } from "../shared/replaceFile.js";

/**
 * Settings that belong to the instance rather than to one browser: the AI
 * connection (provider, address, model, the agent's switches). The desktop
 * app keeps these in its own storage; in the browser that storage is per
 * origin and per device, so a new browser, another address for the same
 * server or cleared site data started over with the defaults.
 *
 * Only names on the list below are accepted. Each one is a JSON object the
 * frontend normalizes when it reads it back, so the server checks shape and
 * size, not every field: a setting added later must not need a server
 * release to be kept.
 *
 * API keys never come through here. They stay in the encrypted secret store,
 * and an `apiKey` field is dropped before anything is written, so a frontend
 * bug cannot put a key into this plain JSON file.
 */

const PREFERENCES_FILE_NAME = "preferences.json";

export const PREFERENCE_NAMES = ["ai-settings"] as const;
export type PreferenceName = (typeof PREFERENCE_NAMES)[number];

/** Generous for a settings object, small enough that the file stays a settings file. */
export const MAX_PREFERENCE_BYTES = 16 * 1024;

const SECRET_FIELDS = new Set(["apiKey"]);

export class PreferenceStoreError extends Error {}

type PreferencesFile = {
  version: 1;
  entries: Partial<Record<PreferenceName, Record<string, unknown>>>;
};

export type PreferenceStore = {
  get(name: PreferenceName): Promise<Record<string, unknown> | null>;
  set(name: PreferenceName, value: unknown): Promise<void>;
};

export function isPreferenceName(name: string): name is PreferenceName {
  return (PREFERENCE_NAMES as readonly string[]).includes(name);
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function sanitize(value: unknown): Record<string, unknown> {
  if (!isPlainObject(value)) {
    throw new PreferenceStoreError("A preference must be a JSON object.");
  }

  const cleaned = Object.fromEntries(Object.entries(value).filter(([key]) => !SECRET_FIELDS.has(key)));

  if (Buffer.byteLength(JSON.stringify(cleaned), "utf8") > MAX_PREFERENCE_BYTES) {
    throw new PreferenceStoreError("The preference is too large.");
  }

  return cleaned;
}

export function openPreferenceStore(vaultPath: string): PreferenceStore {
  const metaDir = path.join(vaultPath, SERVER_META_DIR);
  const filePath = path.join(metaDir, PREFERENCES_FILE_NAME);
  // One process per vault, so serializing the read-modify-write here is
  // enough to keep two quick saves from dropping each other's entry.
  let queue: Promise<unknown> = Promise.resolve();

  async function read(): Promise<PreferencesFile> {
    let raw: string;

    try {
      raw = await readFile(filePath, "utf8");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        return { version: 1, entries: {} };
      }

      throw error;
    }

    try {
      const parsed = JSON.parse(raw) as unknown;
      const entries = isPlainObject(parsed) && isPlainObject(parsed.entries) ? parsed.entries : {};
      const kept: PreferencesFile["entries"] = {};

      for (const name of PREFERENCE_NAMES) {
        if (isPlainObject(entries[name])) {
          kept[name] = entries[name];
        }
      }

      return { version: 1, entries: kept };
    } catch {
      // A damaged file costs the settings, not the server: they are back to
      // the defaults, which is what a fresh browser sees anyway.
      return { version: 1, entries: {} };
    }
  }

  async function write(file: PreferencesFile): Promise<void> {
    await mkdir(metaDir, { recursive: true, mode: 0o700 });
    const tempPath = path.join(metaDir, `.${PREFERENCES_FILE_NAME}.${randomBytes(6).toString("hex")}.tmp`);

    try {
      await writeFile(tempPath, `${JSON.stringify(file, null, 2)}\n`, "utf8");
      await replaceFile(tempPath, filePath);
    } catch (error) {
      await rm(tempPath, { force: true }).catch(() => undefined);
      throw error;
    }
  }

  return {
    async get(name) {
      await queue.catch(() => undefined);
      return (await read()).entries[name] ?? null;
    },
    async set(name, value) {
      const cleaned = sanitize(value);
      const run = queue
        .catch(() => undefined)
        .then(async () => {
          const file = await read();
          file.entries[name] = cleaned;
          await write(file);
        });

      queue = run;
      return run;
    }
  };
}
