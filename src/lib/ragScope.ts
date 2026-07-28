// Which files the knowledge base may touch, right now.
//
// Computed on every call from the store's current file list and the current
// folder selection — never cached. A stale scope would mean reading, embedding
// or sending a folder the user has just excluded, which is the one mistake this
// feature cannot afford to make. Both the search path (ragSearch.ts) and the
// preparation path (ragIndex.ts) go through here, so there is exactly one
// answer to "what is included".

import { getRelativeDisplayPath } from "@/lib/fileSystem";
import { isFileIncluded, type RagFolderSelection } from "@/lib/ragConfig";
import { useAppStore } from "@/store/useAppStore";
import { useRagSettingsStore } from "@/store/useRagSettingsStore";

export type RagScope = {
  /** Absolute path of the opened vault. */
  root: string;
  /** Vault-relative paths of every file the selection covers. */
  files: string[];
};

/**
 * The current scope, or null when there is nothing to search.
 *
 * requireEnabled is on by default: anything that reads notes for the AI needs
 * the vault's consent switch. Only the settings tab passes false, so it can
 * still report and delete what was stored while the feature is switched off.
 */
export function currentScope({ requireEnabled = true }: { requireEnabled?: boolean } = {}): RagScope | null {
  const { folderPath, filePaths } = useAppStore.getState();
  const { config } = useRagSettingsStore.getState();

  if (!folderPath || (requireEnabled && !config.enabled)) {
    return null;
  }

  const selection: RagFolderSelection = {
    rootIncluded: config.rootIncluded,
    overrides: config.overrides
  };

  const files = filePaths
    .map((filePath) => getRelativeDisplayPath(folderPath, filePath))
    .filter((relativePath) => isFileIncluded(selection, relativePath));

  return files.length > 0 ? { root: folderPath, files } : null;
}

/**
 * Whether the agent should be offered the knowledge base tools at all. False
 * when the feature is off, no folder is open, or the selection covers nothing —
 * in each case the tools could only ever answer "nothing found", and a model
 * that has them tends to reach for them anyway.
 */
export function isKnowledgeBaseReady(): boolean {
  return currentScope() !== null;
}

/** Number of markdown files the current selection covers. */
export function includedFileCount(): number {
  return currentScope()?.files.length ?? 0;
}
