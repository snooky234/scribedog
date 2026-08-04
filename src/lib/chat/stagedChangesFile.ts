import { join } from "@tauri-apps/api/path";
import { exists, mkdir, readTextFile, remove, writeTextFile } from "@tauri-apps/plugin-fs";

import { VAULT_META_DIR_NAME } from "@/lib/fileSystem";

import { normalizeStagedChange, type StagedChange } from "./vaultStaging";

/**
 * Persistence for the staging layer, in the vault's own metadata folder next to
 * the chat sessions and the version history:
 *
 *   .scribedog/staged-changes.json  ->  [StagedChange, ...]
 *
 * Proposals outlive a restart on purpose: an agent turn that touched twelve
 * files and a user who closes the app before reviewing them is the normal case,
 * not an edge one. Only the editor markers stay out — their real proposals are
 * ProseMirror widgets that are gone with the editor.
 */

const STAGED_CHANGES_FILE_NAME = "staged-changes.json";

async function stagedChangesFilePath(folderPath: string): Promise<string> {
  return join(folderPath, VAULT_META_DIR_NAME, STAGED_CHANGES_FILE_NAME);
}

export async function readStagedChanges(folderPath: string): Promise<StagedChange[]> {
  try {
    const filePath = await stagedChangesFilePath(folderPath);

    if (!(await exists(filePath))) {
      return [];
    }

    const parsed: unknown = JSON.parse(await readTextFile(filePath));

    if (!Array.isArray(parsed)) {
      return [];
    }

    return parsed
      .map(normalizeStagedChange)
      .filter((change): change is StagedChange => change !== null && !change.editorProposal);
  } catch {
    // A vault that has never seen the agent has no file here, and a corrupt one
    // must not keep the vault from opening.
    return [];
  }
}

export async function writeStagedChanges(folderPath: string, changes: StagedChange[]): Promise<void> {
  const persistable = changes.filter((change) => !change.editorProposal);
  const dirPath = await join(folderPath, VAULT_META_DIR_NAME);
  const filePath = await join(dirPath, STAGED_CHANGES_FILE_NAME);

  if (persistable.length === 0) {
    // Nothing pending: drop the file rather than leaving an empty array behind,
    // so `.scribedog/` only carries what actually exists.
    await remove(filePath).catch(() => undefined);
    return;
  }

  await mkdir(dirPath, { recursive: true });
  await writeTextFile(filePath, JSON.stringify(persistable, null, 2));
}
