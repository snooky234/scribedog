import type { MarkdownFileRecord } from "@/lib/fileSystem";

const TREE_EXPANSION_STORAGE_KEY_PREFIX = "scribedog:treeExpansion:";

export type FileTreeFileNode = {
  kind: "file";
  name: string;
  filePath: string;
  relativePath: string;
};

export type FileTreeFolderNode = {
  kind: "folder";
  name: string;
  relativePath: string;
  children: FileTreeNode[];
};

export type FileTreeNode = FileTreeFileNode | FileTreeFolderNode;

function compareNames(left: string, right: string): number {
  return left.localeCompare(right, undefined, {
    numeric: true,
    sensitivity: "base"
  });
}

function sortChildrenRecursively(folder: FileTreeFolderNode): void {
  folder.children.sort((left, right) => {
    if (left.kind !== right.kind) {
      return left.kind === "folder" ? -1 : 1;
    }

    return compareNames(left.name, right.name);
  });

  for (const child of folder.children) {
    if (child.kind === "folder") {
      sortChildrenRecursively(child);
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
        children: []
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
  emptyFolderRelativePaths: string[] = []
): FileTreeNode[] {
  const root: FileTreeFolderNode = {
    kind: "folder",
    name: "",
    relativePath: "",
    children: []
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
      relativePath: record.relativePath
    });
  }

  for (const emptyFolderRelativePath of emptyFolderRelativePaths) {
    if (emptyFolderRelativePath) {
      ensureFolderNode(root, folders, emptyFolderRelativePath);
    }
  }

  sortChildrenRecursively(root);

  return root.children;
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
