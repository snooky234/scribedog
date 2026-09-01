import { join } from "@tauri-apps/api/path";
import { exists, mkdir, readTextFile, writeTextFile } from "@tauri-apps/plugin-fs";

import { getPortableStatus } from "@/lib/portable";
import { hasPrimaryModifier, isShortcutBinding, type ShortcutBinding } from "@/lib/shortcuts/binding";
import { isShortcutActionId, type ShortcutActionId } from "@/lib/shortcuts/definitions";

/**
 * Only the combos the user actually changed are stored — everything else keeps
 * following the app defaults, so a later default change still reaches users who
 * never touched that entry.
 */
export type ShortcutOverrides = Partial<Record<ShortcutActionId, ShortcutBinding>>;

const FILE_NAME = "shortcuts.json";
const FILE_VERSION = 1;

// Used when the Tauri shell isn't there (plain `npm run dev`), so the dialog
// stays usable for UI work. The packaged app never touches this.
const FALLBACK_STORAGE_KEY = "scribedog.shortcuts";

function hasTauriShell(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

// Not appConfigDir() directly: in portable mode this file belongs next to the
// executable, and the Rust side is the one that knows which of the two applies.
async function shortcutsDirPath(): Promise<string> {
  return (await getPortableStatus()).configDir;
}

async function shortcutsFilePath(): Promise<string> {
  return join(await shortcutsDirPath(), FILE_NAME);
}

function parseOverrides(raw: string): ShortcutOverrides {
  const parsed: unknown = JSON.parse(raw);

  if (typeof parsed !== "object" || parsed === null) {
    return {};
  }

  const bindings = (parsed as { bindings?: unknown }).bindings;

  if (typeof bindings !== "object" || bindings === null) {
    return {};
  }

  const overrides: ShortcutOverrides = {};

  // Unknown ids and malformed combos are dropped rather than rejecting the
  // whole file: a hand-edited shortcuts.json should cost at most one entry.
  // A combo without Ctrl/Alt would swallow ordinary typing, so it is dropped
  // here too — the dialog rejects those, a hand-edited file must not slip past.
  for (const [id, binding] of Object.entries(bindings)) {
    if (isShortcutActionId(id) && isShortcutBinding(binding) && hasPrimaryModifier(binding)) {
      overrides[id] = binding;
    }
  }

  return overrides;
}

function serializeOverrides(overrides: ShortcutOverrides): string {
  return JSON.stringify({ version: FILE_VERSION, bindings: overrides }, null, 2);
}

export async function readShortcutOverrides(): Promise<ShortcutOverrides> {
  if (!hasTauriShell()) {
    try {
      const raw = window.localStorage.getItem(FALLBACK_STORAGE_KEY);

      return raw ? parseOverrides(raw) : {};
    } catch {
      return {};
    }
  }

  try {
    const filePath = await shortcutsFilePath();

    if (!(await exists(filePath))) {
      return {};
    }

    return parseOverrides(await readTextFile(filePath));
  } catch {
    // A broken or unreadable file must not keep the app from starting; the
    // defaults are always a valid fallback.
    return {};
  }
}

export async function writeShortcutOverrides(overrides: ShortcutOverrides): Promise<void> {
  const serialized = serializeOverrides(overrides);

  if (!hasTauriShell()) {
    window.localStorage.setItem(FALLBACK_STORAGE_KEY, serialized);
    return;
  }

  const dirPath = await shortcutsDirPath();
  await mkdir(dirPath, { recursive: true });
  await writeTextFile(await join(dirPath, FILE_NAME), serialized);
}
