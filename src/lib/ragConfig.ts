// Which folders of the opened vault the knowledge base ("Wissensbasis") is
// allowed to read, persisted per vault in .scribedog/rag.json alongside the
// other vault-scoped UI state (see src/lib/vaultMeta.ts).
//
// The selection is stored as explicit overrides plus inheritance rather than as
// a flat list of included folders. Two reasons, and both are user-visible:
// a renamed parent doesn't orphan its children's state, and a folder created
// *later* inside an included one is included automatically — which is what the
// user means by ticking a parent. That second point is also why the settings
// tab's warning has to say so out loud.

import { join } from "@tauri-apps/api/path";
import { exists, mkdir, readTextFile, writeTextFile } from "@tauri-apps/plugin-fs";

import { VAULT_META_DIR_NAME } from "@/lib/fileSystem";

const RAG_CONFIG_FILE_NAME = "rag.json";

/**
 * Folder paths are vault-relative and slash-separated, exactly as they appear
 * in MarkdownFileRecord.relativePath. "" is the vault root and never occurs as
 * an override key — the root's state is rootIncluded.
 */
export type RagFolderSelection = {
  rootIncluded: boolean;
  /** Folder path -> included. Only entries that differ from what they inherit. */
  overrides: Record<string, boolean>;
};

export type RagConfig = RagFolderSelection & {
  enabled: boolean;
};

export const DEFAULT_RAG_CONFIG: RagConfig = {
  // Off until the user turns it on in the settings tab: switching it on is what
  // consents to the whole vault being read and sent somewhere.
  enabled: false,
  // Once on, the whole vault is in and folders are excluded from there. The
  // opposite default would make the first run find nothing at all.
  rootIncluded: true,
  overrides: {}
};

export type FolderCheckState = "checked" | "unchecked" | "mixed";

function normalizeFolderPath(path: string): string {
  return path.replace(/\\/g, "/").replace(/^\/+/, "").replace(/\/+$/, "");
}

/** "a/b/c" -> ["a/b/c", "a/b", "a"], nearest ancestor first. */
function selfAndAncestors(folderPath: string): string[] {
  const normalized = normalizeFolderPath(folderPath);

  if (!normalized) {
    return [];
  }

  const segments = normalized.split("/");

  return segments.map((_, index) => segments.slice(0, segments.length - index).join("/"));
}

function isDescendantPath(candidate: string, ancestor: string): boolean {
  return ancestor === "" ? candidate !== "" : candidate.startsWith(`${ancestor}/`);
}

/**
 * The effective state of a folder: the nearest ancestor (or the folder itself)
 * carrying an explicit override wins, otherwise the vault root's state.
 */
export function isFolderIncluded(selection: RagFolderSelection, folderPath: string): boolean {
  for (const path of selfAndAncestors(folderPath)) {
    const override = selection.overrides[path];

    if (typeof override === "boolean") {
      return override;
    }
  }

  return selection.rootIncluded;
}

/** Whether a file is covered, decided by the folder it sits in. */
export function isFileIncluded(selection: RagFolderSelection, fileRelativePath: string): boolean {
  const normalized = normalizeFolderPath(fileRelativePath);
  const lastSlash = normalized.lastIndexOf("/");

  return isFolderIncluded(selection, lastSlash === -1 ? "" : normalized.slice(0, lastSlash));
}

/**
 * Ticks or unticks one folder.
 *
 * Two clean-ups keep the stored shape canonical, and the tri-state derivation
 * below depends on both: an override equal to what it would inherit anyway is
 * dropped, and every override *below* the changed folder is dropped too —
 * unticking a parent is meant to clear everything under it, which is what
 * every file-picker with checkboxes does.
 */
export function setFolderIncluded(
  selection: RagFolderSelection,
  folderPath: string,
  included: boolean
): RagFolderSelection {
  const normalized = normalizeFolderPath(folderPath);

  if (!normalized) {
    // The root has no ancestor to inherit from, so its state lives in its own
    // field — and with everything below it reset, no override can survive.
    return { rootIncluded: included, overrides: {} };
  }

  const overrides: Record<string, boolean> = {};

  for (const [path, value] of Object.entries(selection.overrides)) {
    if (path !== normalized && !isDescendantPath(path, normalized)) {
      overrides[path] = value;
    }
  }

  // Whatever this folder would inherit now that its own override is gone.
  const inherited = isFolderIncluded({ rootIncluded: selection.rootIncluded, overrides }, normalized);

  if (inherited !== included) {
    overrides[normalized] = included;
  }

  return { rootIncluded: selection.rootIncluded, overrides };
}

/**
 * The checkbox state for one folder row.
 *
 * "mixed" needs no scan of the subtree: setFolderIncluded never stores an
 * override that agrees with its inheritance, so any surviving override below a
 * folder is by construction a disagreement.
 */
export function folderCheckState(
  selection: RagFolderSelection,
  folderPath: string
): FolderCheckState {
  const normalized = normalizeFolderPath(folderPath);

  const hasDivergentDescendant = Object.keys(selection.overrides).some((path) =>
    isDescendantPath(path, normalized)
  );

  if (hasDivergentDescendant) {
    return "mixed";
  }

  return isFolderIncluded(selection, normalized) ? "checked" : "unchecked";
}

/**
 * Drops overrides for folders that no longer exist. Without this a folder the
 * user deleted long ago would keep its parent showing "mixed" forever, and the
 * stored file would grow with every reorganization of the vault.
 */
export function pruneSelection(
  selection: RagFolderSelection,
  existingFolderPaths: readonly string[]
): RagFolderSelection {
  const existing = new Set(existingFolderPaths.map(normalizeFolderPath));
  const overrides: Record<string, boolean> = {};

  for (const [path, value] of Object.entries(selection.overrides)) {
    if (existing.has(path)) {
      overrides[path] = value;
    }
  }

  return { rootIncluded: selection.rootIncluded, overrides };
}

function isRagConfig(value: unknown): value is RagConfig {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }

  const candidate = value as Partial<RagConfig>;

  if (typeof candidate.enabled !== "boolean" || typeof candidate.rootIncluded !== "boolean") {
    return false;
  }

  const overrides: unknown = candidate.overrides;

  if (typeof overrides !== "object" || overrides === null || Array.isArray(overrides)) {
    return false;
  }

  return Object.values(overrides).every((entry) => typeof entry === "boolean");
}

async function ragConfigFilePath(folderPath: string): Promise<string> {
  return join(folderPath, VAULT_META_DIR_NAME, RAG_CONFIG_FILE_NAME);
}

export async function readRagConfig(folderPath: string): Promise<RagConfig> {
  try {
    const filePath = await ragConfigFilePath(folderPath);

    if (!(await exists(filePath))) {
      return DEFAULT_RAG_CONFIG;
    }

    const parsed: unknown = JSON.parse(await readTextFile(filePath));

    if (!isRagConfig(parsed)) {
      return DEFAULT_RAG_CONFIG;
    }

    // Normalize keys written by an older version or edited by hand, so the
    // "no redundant override" invariant folderCheckState relies on holds even
    // for a file this build did not write.
    let selection: RagFolderSelection = { rootIncluded: parsed.rootIncluded, overrides: {} };

    for (const [path, value] of Object.entries(parsed.overrides)) {
      selection = setFolderIncluded(selection, path, value);
    }

    return { enabled: parsed.enabled, ...selection };
  } catch {
    return DEFAULT_RAG_CONFIG;
  }
}

export async function writeRagConfig(folderPath: string, config: RagConfig): Promise<void> {
  const dirPath = await join(folderPath, VAULT_META_DIR_NAME);
  await mkdir(dirPath, { recursive: true });
  await writeTextFile(
    await join(dirPath, RAG_CONFIG_FILE_NAME),
    JSON.stringify(config, null, 2)
  );
}

/**
 * A folder of the vault, derived from the markdown files found in it. Folders
 * without any markdown file never appear: the knowledge base has nothing to
 * read there, and offering them would only make the tree harder to scan.
 */
export type RagFolderNode = {
  /** Vault-relative, slash-separated. "" is the vault root. */
  path: string;
  /** Last path segment, or "" for the root (the UI labels that one itself). */
  name: string;
  /** Markdown files directly in this folder, excluding subfolders. */
  fileCount: number;
  children: RagFolderNode[];
};

/**
 * Builds the folder tree the settings dialog renders, from the same file list
 * the vault is loaded with. Deliberately independent of the sidebar's tree:
 * that one carries sort order, drag state and per-file rows, none of which this
 * picker wants.
 */
export function buildRagFolderTree(
  files: readonly { relativePath: string }[]
): RagFolderNode {
  const root: RagFolderNode = { path: "", name: "", fileCount: 0, children: [] };

  const folderFor = (folderPath: string): RagFolderNode => {
    if (!folderPath) {
      return root;
    }

    let current = root;

    for (const segment of folderPath.split("/")) {
      const childPath = current.path ? `${current.path}/${segment}` : segment;
      let child = current.children.find((node) => node.name === segment);

      if (!child) {
        child = { path: childPath, name: segment, fileCount: 0, children: [] };
        current.children.push(child);
      }

      current = child;
    }

    return current;
  };

  for (const file of files) {
    const normalized = normalizeFolderPath(file.relativePath);
    const lastSlash = normalized.lastIndexOf("/");
    folderFor(lastSlash === -1 ? "" : normalized.slice(0, lastSlash)).fileCount += 1;
  }

  const sortTree = (node: RagFolderNode): void => {
    node.children.sort((a, b) => a.name.localeCompare(b.name));
    node.children.forEach(sortTree);
  };

  sortTree(root);

  return root;
}

/** Every folder path in the tree, root excluded — what pruneSelection needs. */
export function collectFolderPaths(node: RagFolderNode): string[] {
  return node.children.flatMap((child) => [child.path, ...collectFolderPaths(child)]);
}

/** Markdown files the current selection covers, for the tab's live counter. */
export function countIncludedFiles(
  selection: RagFolderSelection,
  files: readonly { relativePath: string }[]
): number {
  return files.reduce(
    (count, file) => (isFileIncluded(selection, file.relativePath) ? count + 1 : count),
    0
  );
}

// Deleting what the knowledge base stored is not here: the stored vectors are
// written and cached by Rust (see rag_clear_index in src-tauri/src/rag.rs), and
// removing the file behind that cache's back would leave the vectors of a
// deleted index still answering searches until the vault is reopened.
// src/store/useRagIndexStore.ts owns that action.
