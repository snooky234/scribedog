// Runtime side of the knowledge base: turns the folder selection into the
// concrete file list the Rust search commands work on, and wraps those
// commands.
//
// The in-scope file list is computed here, on every call, from the store's
// current file list and the current selection — never cached. A stale scope
// would mean reading a folder the user has just excluded, which is the one
// mistake this feature cannot afford to make.

import { invoke } from "@tauri-apps/api/core";

import { getRelativeDisplayPath } from "@/lib/fileSystem";
import { isFileIncluded, type RagFolderSelection } from "@/lib/ragConfig";
import { useAppStore } from "@/store/useAppStore";
import { useRagSettingsStore } from "@/store/useRagSettingsStore";

export type VaultSearchHit = {
  path: string;
  headingPath: string;
  snippet: string;
  // The snippet is a shortened preview of a longer passage. False means it is
  // the passage in full — which is the common case for short notes, and which
  // the tool result has to state, because a model told "this may be cut off"
  // will report a complete note as unfinished.
  truncated: boolean;
  score: number;
};

type RustSearchHit = {
  path: string;
  heading_path: string;
  snippet: string;
  truncated: boolean;
  score: number;
};

/** Vault root and the files the current selection covers, or null if unusable. */
function currentScope(): { root: string; files: string[] } | null {
  const { folderPath, filePaths } = useAppStore.getState();
  const { config } = useRagSettingsStore.getState();

  if (!folderPath || !config.enabled) {
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

export async function searchVault(query: string, limit = 6): Promise<VaultSearchHit[]> {
  const scope = currentScope();

  if (!scope || !query.trim()) {
    return [];
  }

  const hits = await invoke<RustSearchHit[]>("rag_search_text", {
    request: { root: scope.root, files: scope.files, query, limit }
  });

  return hits.map((hit) => ({
    path: hit.path,
    headingPath: hit.heading_path,
    snippet: hit.snippet,
    truncated: hit.truncated,
    score: hit.score
  }));
}

/**
 * Reads one note, or one passage of it. Rejects anything the current selection
 * does not cover — the path comes from model output, so the scope list is an
 * allowlist rather than a hint (the Rust side enforces it a second time).
 */
export async function readNote(path: string, section = ""): Promise<string | null> {
  const scope = currentScope();

  if (!scope) {
    return null;
  }

  try {
    return await invoke<string>("rag_read_note", {
      request: { root: scope.root, files: scope.files, path, section }
    });
  } catch {
    return null;
  }
}

/**
 * Drops the Rust-side parsed-file cache. Called when the selection changes or
 * the vault is closed, so a file that just left the scope does not linger in
 * memory.
 */
export async function clearVaultSearchCache(): Promise<void> {
  try {
    await invoke("rag_clear_cache");
  } catch {
    // The cache is an optimization; failing to clear it is not worth surfacing.
  }
}
