import { join } from "@tauri-apps/api/path";
import { exists, mkdir, readTextFile, writeTextFile } from "@tauri-apps/plugin-fs";

import { VAULT_META_DIR_NAME } from "@/lib/fileSystem";

export type SortMode = "name" | "modified" | "manual";

/** Folder relativePath ("" = vault root) -> ordered child basenames (files and folders mixed). */
export type ManualOrderMap = Record<string, string[]>;

const SORT_MODE_FILE_NAME = "sort-mode.json";
const ORDER_FILE_NAME = "order.json";
const SORT_MODES: SortMode[] = ["name", "modified", "manual"];

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
    const filePath = await join(await vaultMetaDirPath(folderPath), SORT_MODE_FILE_NAME);

    if (!(await exists(filePath))) {
      return "name";
    }

    const parsed: unknown = JSON.parse(await readTextFile(filePath));

    if (
      typeof parsed === "object" &&
      parsed !== null &&
      isSortMode((parsed as { mode?: unknown }).mode)
    ) {
      return (parsed as { mode: SortMode }).mode;
    }

    return "name";
  } catch {
    return "name";
  }
}

export async function writeSortMode(folderPath: string, mode: SortMode): Promise<void> {
  const dirPath = await vaultMetaDirPath(folderPath);
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
