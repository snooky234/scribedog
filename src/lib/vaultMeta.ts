import { join } from "@/platform/paths";
import { exists, mkdir, readTextFile, writeTextFile } from "@/platform/vaultFs";

import {
  DEFAULT_HEADING_NUMBERING,
  normalizeHeadingNumberingSettings,
  type HeadingNumberingSettings
} from "@/lib/editor/headingNumbers";
import { VAULT_META_DIR_NAME } from "@/lib/fileSystem";
import { userMetaDirPath } from "@/lib/userMeta";
import { normalizeVaultIcons, type VaultIconMap } from "@/lib/vaultIcons";
import { normalizeStoredWorkingSet, type StoredWorkingSet } from "@/store/appStore/workingSet";

export type SortMode = "name" | "modified" | "manual";

/** Folder relativePath ("" = vault root) -> ordered child basenames (files and folders mixed). */
export type ManualOrderMap = Record<string, string[]>;

const SORT_MODE_FILE_NAME = "sort-mode.json";
const ORDER_FILE_NAME = "order.json";
const MANUSCRIPT_FILE_NAME = "manuscript.json";
const HEADING_NUMBERING_FILE_NAME = "heading-numbering.json";
const FOLDER_NOTES_FILE_NAME = "folder-notes.json";
const ICONS_FILE_NAME = "icons.json";
const WORKING_SET_FILE_NAME = "open-files.json";
const SORT_MODES: SortMode[] = ["name", "modified", "manual"];

/**
 * What a vault without a sort-mode sidecar gets: Manual, so drag & drop works
 * right away instead of after a trip to the sort menu. Costs nothing visually
 * — with no stored order yet, Manual renders in the same folders-first
 * alphabetical order as Name (see sortChildrenRecursively in lib/fileTree).
 */
export const DEFAULT_SORT_MODE: SortMode = "manual";

/**
 * Shared by everyone who opens the vault: order, icons, manuscript, heading
 * numbering, folder notes. The sort mode and the "In progress" list are one
 * person's view of it and live in userMetaDirPath instead (see userMeta.ts).
 */
async function vaultMetaDirPath(folderPath: string): Promise<string> {
  return join(folderPath, VAULT_META_DIR_NAME);
}

function isSortMode(value: unknown): value is SortMode {
  return typeof value === "string" && (SORT_MODES as string[]).includes(value);
}

function isManualOrderMap(value: unknown): value is ManualOrderMap {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }

  return Object.values(value).every(
    (entry) => Array.isArray(entry) && entry.every((item) => typeof item === "string")
  );
}

export async function readSortMode(folderPath: string): Promise<SortMode> {
  try {
    const filePath = await join(await userMetaDirPath(folderPath), SORT_MODE_FILE_NAME);

    if (!(await exists(filePath))) {
      return DEFAULT_SORT_MODE;
    }

    const parsed: unknown = JSON.parse(await readTextFile(filePath));

    if (
      typeof parsed === "object" &&
      parsed !== null &&
      isSortMode((parsed as { mode?: unknown }).mode)
    ) {
      return (parsed as { mode: SortMode }).mode;
    }

    return DEFAULT_SORT_MODE;
  } catch {
    return DEFAULT_SORT_MODE;
  }
}

export async function writeSortMode(folderPath: string, mode: SortMode): Promise<void> {
  const dirPath = await userMetaDirPath(folderPath);
  await mkdir(dirPath, { recursive: true });
  await writeTextFile(await join(dirPath, SORT_MODE_FILE_NAME), JSON.stringify({ mode }, null, 2));
}

export async function readManualOrder(folderPath: string): Promise<ManualOrderMap> {
  try {
    const filePath = await join(await vaultMetaDirPath(folderPath), ORDER_FILE_NAME);

    if (!(await exists(filePath))) {
      return {};
    }

    const parsed: unknown = JSON.parse(await readTextFile(filePath));

    return isManualOrderMap(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

export async function writeManualOrder(folderPath: string, order: ManualOrderMap): Promise<void> {
  const dirPath = await vaultMetaDirPath(folderPath);
  await mkdir(dirPath, { recursive: true });
  await writeTextFile(await join(dirPath, ORDER_FILE_NAME), JSON.stringify(order, null, 2));
}

/**
 * The "In progress" list (store/appStore/workingSet.ts), per vault like the
 * manual order: which notes the user had in hand, so the next open of the
 * folder can put them back. Relative paths, so the file travels with the
 * vault.
 */
export async function readWorkingSet(folderPath: string): Promise<StoredWorkingSet> {
  try {
    const filePath = await join(await userMetaDirPath(folderPath), WORKING_SET_FILE_NAME);

    if (!(await exists(filePath))) {
      return { version: 1, entries: [] };
    }

    return normalizeStoredWorkingSet(JSON.parse(await readTextFile(filePath)));
  } catch {
    return { version: 1, entries: [] };
  }
}

export async function writeWorkingSet(folderPath: string, workingSet: StoredWorkingSet): Promise<void> {
  const dirPath = await userMetaDirPath(folderPath);
  await mkdir(dirPath, { recursive: true });
  await writeTextFile(await join(dirPath, WORKING_SET_FILE_NAME), JSON.stringify(workingSet, null, 2));
}

/**
 * Cover data and compile options for the manuscript export. Kept per vault
 * rather than app-wide: title and author belong to one book, and a user who
 * opens a second vault is working on a different one.
 *
 * Stored as a loose record and validated on read, so a settings file written
 * by a newer version never breaks the dialog.
 */
export type StoredManuscriptSettings = Record<string, unknown>;

export async function readManuscriptSettings(
  folderPath: string
): Promise<StoredManuscriptSettings> {
  try {
    const filePath = await join(await vaultMetaDirPath(folderPath), MANUSCRIPT_FILE_NAME);

    if (!(await exists(filePath))) {
      return {};
    }

    const parsed: unknown = JSON.parse(await readTextFile(filePath));

    return typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)
      ? (parsed as StoredManuscriptSettings)
      : {};
  } catch {
    return {};
  }
}

export async function writeManuscriptSettings(
  folderPath: string,
  settings: StoredManuscriptSettings
): Promise<void> {
  const dirPath = await vaultMetaDirPath(folderPath);
  await mkdir(dirPath, { recursive: true });
  await writeTextFile(
    await join(dirPath, MANUSCRIPT_FILE_NAME),
    JSON.stringify(settings, null, 2)
  );
}

/**
 * Automatic heading numbering, per vault like the manuscript settings: whether
 * headings carry numbers is a property of the documents in a folder (a report
 * vault wants them, a notes vault does not), and it travels with the folder
 * to every machine that opens it, unlike a localStorage preference.
 */
export async function readHeadingNumbering(folderPath: string): Promise<HeadingNumberingSettings> {
  try {
    const filePath = await join(await vaultMetaDirPath(folderPath), HEADING_NUMBERING_FILE_NAME);

    if (!(await exists(filePath))) {
      return DEFAULT_HEADING_NUMBERING;
    }

    return normalizeHeadingNumberingSettings(JSON.parse(await readTextFile(filePath)));
  } catch {
    return DEFAULT_HEADING_NUMBERING;
  }
}

export async function writeHeadingNumbering(
  folderPath: string,
  settings: HeadingNumberingSettings
): Promise<void> {
  const dirPath = await vaultMetaDirPath(folderPath);
  await mkdir(dirPath, { recursive: true });
  await writeTextFile(
    await join(dirPath, HEADING_NUMBERING_FILE_NAME),
    JSON.stringify(settings, null, 2)
  );
}

/**
 * Folder notes (lib/folderNotes.ts), per vault for the same reason: the notes
 * themselves are files in the folder, so the switch that makes them reachable
 * belongs next to them — a vault that is synced or carried to another machine
 * brings its way of working along, and one vault's outliner habit never leaks
 * into a documentation vault where a click on a folder should just unfold it.
 */
export async function readFolderNotesEnabled(folderPath: string): Promise<boolean> {
  try {
    const filePath = await join(await vaultMetaDirPath(folderPath), FOLDER_NOTES_FILE_NAME);

    if (!(await exists(filePath))) {
      return false;
    }

    const parsed: unknown = JSON.parse(await readTextFile(filePath));

    return typeof parsed === "object" && parsed !== null && (parsed as { enabled?: unknown }).enabled === true;
  } catch {
    return false;
  }
}

export async function writeFolderNotesEnabled(folderPath: string, enabled: boolean): Promise<void> {
  const dirPath = await vaultMetaDirPath(folderPath);
  await mkdir(dirPath, { recursive: true });
  await writeTextFile(
    await join(dirPath, FOLDER_NOTES_FILE_NAME),
    JSON.stringify({ enabled }, null, 2)
  );
}

/**
 * Per-entry icons (lib/vaultIcons.ts), per vault like the manual order and
 * for the same reason: they are how *this* folder is meant to look, they
 * reference its entries by relative path, and they travel with it when the
 * folder is copied to another machine. Invalid entries are dropped on read,
 * so a hand-edited or newer file can never break the tree.
 */
export async function readVaultIcons(folderPath: string): Promise<VaultIconMap> {
  try {
    const filePath = await join(await vaultMetaDirPath(folderPath), ICONS_FILE_NAME);

    if (!(await exists(filePath))) {
      return {};
    }

    return normalizeVaultIcons(JSON.parse(await readTextFile(filePath)));
  } catch {
    return {};
  }
}

export async function writeVaultIcons(folderPath: string, icons: VaultIconMap): Promise<void> {
  const dirPath = await vaultMetaDirPath(folderPath);
  await mkdir(dirPath, { recursive: true });
  await writeTextFile(await join(dirPath, ICONS_FILE_NAME), JSON.stringify(icons, null, 2));
}
