import { writeManualOrder, type ManualOrderMap } from "@/lib/vaultMeta";
import { getChildBasenamesByParent } from "@/lib/fileTree";
import type { MarkdownFileRecord } from "@/lib/fileSystem";

/**
 * Diffs a manual-order sidecar against what actually exists on disk: appends
 * children that showed up externally (e.g. created outside the app) at the
 * end (alphabetically among themselves), and drops entries for basenames or
 * folders that no longer exist. No-ops (and never touches disk) when there
 * is no manual order yet, so vaults that never use Manual mode never get a
 * `.scribedog/` folder created for them.
 */
export async function reconcileManualOrder(
  vaultFolderPath: string,
  manualOrder: ManualOrderMap,
  markdownFiles: MarkdownFileRecord[],
  emptyFolderRelativePaths: string[]
): Promise<ManualOrderMap> {
  if (Object.keys(manualOrder).length === 0) {
    return manualOrder;
  }

  const actualChildrenByParent = getChildBasenamesByParent(markdownFiles, emptyFolderRelativePaths);
  const next: ManualOrderMap = {};
  let didChange = false;

  for (const [parentRelativePath, storedOrder] of Object.entries(manualOrder)) {
    const actualChildren = actualChildrenByParent.get(parentRelativePath);

    if (!actualChildren) {
      didChange = true;
      continue;
    }

    const actualSet = new Set(actualChildren);
    const filtered = storedOrder.filter((name) => actualSet.has(name));

    if (filtered.length !== storedOrder.length) {
      didChange = true;
    }

    const knownSet = new Set(filtered);
    const missing = actualChildren
      .filter((name) => !knownSet.has(name))
      .sort((left, right) => left.localeCompare(right, undefined, { numeric: true, sensitivity: "base" }));

    if (missing.length > 0) {
      didChange = true;
    }

    next[parentRelativePath] = [...filtered, ...missing];
  }

  if (!didChange) {
    return manualOrder;
  }

  void writeManualOrder(vaultFolderPath, next).catch(() => undefined);

  return next;
}

export function persistManualOrderIfChanged(
  vaultFolderPath: string,
  previous: ManualOrderMap,
  next: ManualOrderMap
): void {
  if (next !== previous) {
    void writeManualOrder(vaultFolderPath, next).catch(() => undefined);
  }
}

export function appendManualOrderEntry(
  manualOrder: ManualOrderMap,
  parentRelativePath: string,
  basename: string
): ManualOrderMap {
  const entry = manualOrder[parentRelativePath];

  if (!entry) {
    return manualOrder;
  }

  return { ...manualOrder, [parentRelativePath]: [...entry, basename] };
}

export function removeManualOrderEntry(
  manualOrder: ManualOrderMap,
  parentRelativePath: string,
  basename: string
): ManualOrderMap {
  const entry = manualOrder[parentRelativePath];

  if (!entry) {
    return manualOrder;
  }

  return { ...manualOrder, [parentRelativePath]: entry.filter((name) => name !== basename) };
}

export function renameManualOrderEntry(
  manualOrder: ManualOrderMap,
  parentRelativePath: string,
  oldBasename: string,
  newBasename: string
): ManualOrderMap {
  const entry = manualOrder[parentRelativePath];

  if (!entry) {
    return manualOrder;
  }

  return {
    ...manualOrder,
    [parentRelativePath]: entry.map((name) => (name === oldBasename ? newBasename : name))
  };
}

export function rekeyManualOrderFolderPrefix(
  manualOrder: ManualOrderMap,
  oldRelativePath: string,
  newRelativePath: string
): ManualOrderMap {
  const next: ManualOrderMap = {};
  let didChange = false;

  for (const [key, value] of Object.entries(manualOrder)) {
    if (key === oldRelativePath) {
      next[newRelativePath] = value;
      didChange = true;
    } else if (key.startsWith(`${oldRelativePath}/`)) {
      next[`${newRelativePath}${key.slice(oldRelativePath.length)}`] = value;
      didChange = true;
    } else {
      next[key] = value;
    }
  }

  return didChange ? next : manualOrder;
}

export function removeManualOrderFolderPrefix(
  manualOrder: ManualOrderMap,
  relativePath: string
): ManualOrderMap {
  const next: ManualOrderMap = {};

  for (const [key, value] of Object.entries(manualOrder)) {
    if (key !== relativePath && !key.startsWith(`${relativePath}/`)) {
      next[key] = value;
    }
  }

  return next;
}
