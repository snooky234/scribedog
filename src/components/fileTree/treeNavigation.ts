import { isDescendantRelativePath, type FileTreeNode } from "@/lib/fileTree";

export const INDENT_BASE_REM = 0.5;
export const INDENT_STEP_REM = 0.9;

export type NodeContext = {
  parentRelativePath: string;
  indexInSiblings: number;
};

export function getNodeKey(node: FileTreeNode): string {
  return `${node.kind}:${node.relativePath}`;
}

// In "modified" sort mode, shown next to the name: just the time for changes
// from today (local timezone), otherwise just the date. Sorting itself
// always uses the exact timestamp (see fileTree.ts), this is display-only.
export function formatModifiedLabel(mtimeMs: number, locale: string): string {
  if (!mtimeMs) {
    return "";
  }

  const date = new Date(mtimeMs);
  const now = new Date();
  const isSameDay =
    date.getFullYear() === now.getFullYear() &&
    date.getMonth() === now.getMonth() &&
    date.getDate() === now.getDate();

  return isSameDay
    ? new Intl.DateTimeFormat(locale, { hour: "2-digit", minute: "2-digit" }).format(date)
    : new Intl.DateTimeFormat(locale, { day: "2-digit", month: "2-digit", year: "numeric" }).format(date);
}

// For arrow-key navigation, the visible tree (collapsed folders are skipped)
// is flattened into the same order as the rendering, so up/down follows
// exactly the rows currently visible.
export function flattenVisibleNodes(
  nodes: FileTreeNode[],
  expandedFolderPaths: Set<string>
): FileTreeNode[] {
  const result: FileTreeNode[] = [];

  const visit = (list: FileTreeNode[]) => {
    for (const node of list) {
      result.push(node);

      if (node.kind === "folder" && expandedFolderPaths.has(node.relativePath)) {
        visit(node.children);
      }
    }
  };

  visit(nodes);

  return result;
}

// Shift-click/Shift-Arrow range: every key between the anchor and the target
// (inclusive), in flatNodes order — mirrors standard file-explorer behavior.
export function computeRangeKeys(
  flatNodes: FileTreeNode[],
  anchorKey: string | null,
  targetKey: string
): Set<string> {
  const targetIndex = flatNodes.findIndex((node) => getNodeKey(node) === targetKey);

  if (targetIndex === -1) {
    return new Set([targetKey]);
  }

  const anchorIndex = anchorKey ? flatNodes.findIndex((node) => getNodeKey(node) === anchorKey) : -1;
  const startIndex = anchorIndex === -1 ? 0 : Math.min(anchorIndex, targetIndex);
  const endIndex = anchorIndex === -1 ? targetIndex : Math.max(anchorIndex, targetIndex);

  const result = new Set<string>();

  for (let index = startIndex; index <= endIndex; index += 1) {
    result.add(getNodeKey(flatNodes[index]));
  }

  return result;
}

// Reduces a selection to independent top-level entries: any path whose
// ancestor folder is also selected is dropped, since batch delete/move/export
// already recurse into selected folders' full contents.
export function getTopLevelSelection(
  keys: Iterable<string>,
  flatNodes: FileTreeNode[]
): FileTreeNode[] {
  const nodeByKey = new Map(flatNodes.map((node) => [getNodeKey(node), node]));
  const keyList = [...keys];
  const selectedFolderRelativePaths = keyList
    .map((key) => nodeByKey.get(key))
    .filter((node): node is FileTreeNode & { kind: "folder" } => node?.kind === "folder")
    .map((node) => node.relativePath);

  return keyList
    .map((key) => nodeByKey.get(key))
    .filter((node): node is FileTreeNode => node !== undefined)
    .filter(
      (node) =>
        !selectedFolderRelativePaths.some(
          (folderRelativePath) =>
            folderRelativePath !== node.relativePath &&
            isDescendantRelativePath(folderRelativePath, node.relativePath)
        )
    );
}

// Search hits per folder, summed over its whole subtree, so a collapsed folder
// can announce matches that are currently invisible. Folders without hits are
// left out of the map. Computed once per (tree, counts) pair in FileTree — a
// folder row walking its own subtree on every render would be quadratic and
// would tie every row to the full counts object instead of a single number.
export function buildFolderMatchCounts(
  nodes: FileTreeNode[],
  fileMatchCounts: Record<string, number>
): Record<string, number> {
  const result: Record<string, number> = {};

  const visit = (list: FileTreeNode[]): number => {
    let total = 0;

    for (const node of list) {
      if (node.kind === "file") {
        total += fileMatchCounts[node.filePath] ?? 0;
        continue;
      }

      const subtotal = visit(node.children);

      if (subtotal > 0) {
        result[node.relativePath] = subtotal;
      }

      total += subtotal;
    }

    return total;
  };

  visit(nodes);

  return result;
}

// Every folder in this subtree (the node itself included) that carries search
// hits. Expanding exactly these reveals all matches below the node while
// leaving match-free branches folded.
export function collectMatchingFolderPaths(
  node: FileTreeNode,
  folderMatchCounts: Record<string, number>
): string[] {
  const result: string[] = [];

  const visit = (candidate: FileTreeNode) => {
    if (candidate.kind !== "folder" || (folderMatchCounts[candidate.relativePath] ?? 0) === 0) {
      return;
    }

    result.push(candidate.relativePath);
    candidate.children.forEach(visit);
  };

  visit(node);

  return result;
}

// Maps every node's key to its parent folder's relativePath and its index
// among the currently displayed siblings, so a drag & drop can compute the
// insertion point relative to the target row.
export function buildNodeContextMap(nodes: FileTreeNode[]): Map<string, NodeContext> {
  const map = new Map<string, NodeContext>();

  const visit = (parentRelativePath: string, children: FileTreeNode[]) => {
    children.forEach((child, index) => {
      map.set(getNodeKey(child), { parentRelativePath, indexInSiblings: index });

      if (child.kind === "folder") {
        visit(child.relativePath, child.children);
      }
    });
  };

  visit("", nodes);

  return map;
}
