import type { MarkdownFileRecord } from "@/lib/fileSystem";
import type { ManualOrderMap, SortMode } from "@/lib/vaultMeta";

const TREE_EXPANSION_STORAGE_KEY_PREFIX = "scribedog:treeExpansion:";

export type FileTreeFileNode = {
  kind: "file";
  name: string;
  filePath: string;
  relativePath: string;
  mtimeMs: number;
};

export type FileTreeFolderNode = {
  kind: "folder";
  name: string;
  relativePath: string;
  children: FileTreeNode[];
  /** Most recent mtime among all (recursively) contained files, used both as the "modified" sort key and for display. */
  effectiveMtimeMs: number;
};

export type FileTreeNode = FileTreeFileNode | FileTreeFolderNode;

export type BuildFileTreeOptions = {
  sortMode?: SortMode;
  manualOrder?: ManualOrderMap;
  /** Own mtime of folders, used as a fallback sort key in "modified" mode for folders with no file descendants. */
  emptyFolderOwnMtimeMs?: Record<string, number>;
};

type SortContext = {
  mode: SortMode;
  manualOrder: ManualOrderMap;
};

function compareNames(left: string, right: string): number {
  return left.localeCompare(right, undefined, {
    numeric: true,
    sensitivity: "base"
  });
}

/** Returns the mtime to sort/display by: a file's own mtime, or a folder's precomputed effective mtime. */
export function getNodeMtimeMs(node: FileTreeNode): number {
  return node.kind === "file" ? node.mtimeMs : node.effectiveMtimeMs;
}

function computeEffectiveMtimes(
  folder: FileTreeFolderNode,
  ownMtimeByRelativePath: Record<string, number>
): number {
  let maxMtime = -Infinity;

  for (const child of folder.children) {
    maxMtime = Math.max(
      maxMtime,
      child.kind === "file" ? child.mtimeMs : computeEffectiveMtimes(child, ownMtimeByRelativePath)
    );
  }

  const result =
    maxMtime === -Infinity ? (ownMtimeByRelativePath[folder.relativePath] ?? 0) : maxMtime;

  folder.effectiveMtimeMs = result;

  return result;
}

function sortChildrenRecursively(folder: FileTreeFolderNode, context: SortContext): void {
  if (context.mode === "manual") {
    const order = context.manualOrder[folder.relativePath];
    const indexByName = new Map<string, number>();
    order?.forEach((basename, index) => indexByName.set(basename, index));

    folder.children.sort((left, right) => {
      const leftIndex = indexByName.get(left.name);
      const rightIndex = indexByName.get(right.name);

      if (leftIndex !== undefined && rightIndex !== undefined) {
        return leftIndex - rightIndex;
      }

      if (leftIndex !== undefined) {
        return -1;
      }

      if (rightIndex !== undefined) {
        return 1;
      }

      return compareNames(left.name, right.name);
    });
  } else if (context.mode === "modified") {
    folder.children.sort((left, right) => {
      const leftKey = getNodeMtimeMs(left);
      const rightKey = getNodeMtimeMs(right);

      if (leftKey !== rightKey) {
        return rightKey - leftKey;
      }

      return compareNames(left.name, right.name);
    });
  } else {
    folder.children.sort((left, right) => {
      if (left.kind !== right.kind) {
        return left.kind === "folder" ? -1 : 1;
      }

      return compareNames(left.name, right.name);
    });
  }

  for (const child of folder.children) {
    if (child.kind === "folder") {
      sortChildrenRecursively(child, context);
    }
  }
}

function ensureFolderNode(
  root: FileTreeFolderNode,
  folders: Map<string, FileTreeFolderNode>,
  relativePath: string
): FileTreeFolderNode {
  const segments = relativePath.split("/");
  let parent = root;

  for (let index = 0; index < segments.length; index += 1) {
    const currentRelativePath = segments.slice(0, index + 1).join("/");
    let folder = folders.get(currentRelativePath);

    if (!folder) {
      folder = {
        kind: "folder",
        name: segments[index],
        relativePath: currentRelativePath,
        children: [],
        effectiveMtimeMs: 0
      };
      folders.set(currentRelativePath, folder);
      parent.children.push(folder);
    }

    parent = folder;
  }

  return parent;
}

export function buildFileTree(
  records: MarkdownFileRecord[],
  emptyFolderRelativePaths: string[] = [],
  options?: BuildFileTreeOptions
): FileTreeNode[] {
  const root: FileTreeFolderNode = {
    kind: "folder",
    name: "",
    relativePath: "",
    children: [],
    effectiveMtimeMs: 0
  };
  const folders = new Map<string, FileTreeFolderNode>([["", root]]);

  for (const record of records) {
    const segments = record.relativePath.split("/");
    const parentRelativePath = segments.slice(0, -1).join("/");
    const parent = parentRelativePath
      ? ensureFolderNode(root, folders, parentRelativePath)
      : root;

    parent.children.push({
      kind: "file",
      name: segments[segments.length - 1],
      filePath: record.filePath,
      relativePath: record.relativePath,
      mtimeMs: record.mtimeMs
    });
  }

  for (const emptyFolderRelativePath of emptyFolderRelativePaths) {
    if (emptyFolderRelativePath) {
      ensureFolderNode(root, folders, emptyFolderRelativePath);
    }
  }

  computeEffectiveMtimes(root, options?.emptyFolderOwnMtimeMs ?? {});

  const context: SortContext = {
    mode: options?.sortMode ?? "name",
    manualOrder: options?.manualOrder ?? {}
  };

  sortChildrenRecursively(root, context);

  return root.children;
}

/**
 * Maps every folder's relativePath ("" for the vault root) to the basenames
 * of its direct children (files and folders mixed). Used to reconcile the
 * manual order sidecar against what actually exists on disk.
 */
export function getChildBasenamesByParent(
  records: MarkdownFileRecord[],
  emptyFolderRelativePaths: string[] = []
): Map<string, string[]> {
  const nodes = buildFileTree(records, emptyFolderRelativePaths);
  const result = new Map<string, string[]>();

  const visit = (parentRelativePath: string, children: FileTreeNode[]) => {
    result.set(
      parentRelativePath,
      children.map((child) => child.name)
    );

    for (const child of children) {
      if (child.kind === "folder") {
        visit(child.relativePath, child.children);
      }
    }
  };

  visit("", nodes);

  return result;
}

/**
 * Whether `candidateRelativePath` is `ancestorRelativePath` itself or nested
 * inside it. Used to block dropping a folder into one of its own descendants.
 * The vault root ("") is trivially an ancestor of everything.
 */
export function isDescendantRelativePath(
  ancestorRelativePath: string,
  candidateRelativePath: string
): boolean {
  if (ancestorRelativePath === "") {
    return true;
  }

  return (
    candidateRelativePath === ancestorRelativePath ||
    candidateRelativePath.startsWith(`${ancestorRelativePath}/`)
  );
}

export function getAncestorFolderPaths(relativePath: string): string[] {
  const segments = relativePath.split("/");
  const ancestors: string[] = [];

  for (let index = 0; index < segments.length - 1; index += 1) {
    ancestors.push(segments.slice(0, index + 1).join("/"));
  }

  return ancestors;
}

export function getStoredExpandedFolderPaths(folderPath: string): Set<string> {
  try {
    const rawValue = window.localStorage.getItem(
      `${TREE_EXPANSION_STORAGE_KEY_PREFIX}${folderPath}`
    );

    if (!rawValue) {
      return new Set();
    }

    const parsedValue: unknown = JSON.parse(rawValue);

    if (!Array.isArray(parsedValue)) {
      return new Set();
    }

    return new Set(parsedValue.filter((entry): entry is string => typeof entry === "string"));
  } catch {
    return new Set();
  }
}

export function setStoredExpandedFolderPaths(
  folderPath: string,
  expandedFolderPaths: Set<string>
): void {
  try {
    window.localStorage.setItem(
      `${TREE_EXPANSION_STORAGE_KEY_PREFIX}${folderPath}`,
      JSON.stringify([...expandedFolderPaths])
    );
  } catch {
    // localStorage may be unavailable in some environments.
  }
}
