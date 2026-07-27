import { writeManualOrder, type ManualOrderMap } from "@/lib/vaultMeta";
import { getChildBasenamesByParent } from "@/lib/fileTree";
import { getRelativeDisplayPath, type MarkdownFileRecord } from "@/lib/fileSystem";

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
  return insertManualOrderEntry(manualOrder, parentRelativePath, basename);
}

/** The basenames currently shown under parentRelativePath, in default (name) order. */
export function currentChildBasenames(
  folderPath: string,
  filePaths: string[],
  emptyFolderPaths: string[],
  parentRelativePath: string
): string[] {
  const childrenByParent = getChildBasenamesByParent(
    filePaths.map((filePath) => ({
      filePath,
      relativePath: getRelativeDisplayPath(folderPath, filePath),
      mtimeMs: 0
    })),
    emptyFolderPaths.map((path) => getRelativeDisplayPath(folderPath, path))
  );

  return childrenByParent.get(parentRelativePath) ?? [];
}

/**
 * A folder only has a tracked order once something has explicitly reordered
 * it (drag & drop, or an insert like this one) — until then
 * insertManualOrderEntry would silently no-op. Seeds it from the current
 * on-screen (alphabetical) order first so the very first insert into an
 * untouched folder still lands at the requested position instead of being
 * dropped, without reshuffling siblings that were already there.
 */
export function ensureManualOrderEntry(
  manualOrder: ManualOrderMap,
  parentRelativePath: string,
  currentChildren: string[]
): ManualOrderMap {
  if (manualOrder[parentRelativePath]) {
    return manualOrder;
  }

  return {
    ...manualOrder,
    [parentRelativePath]: [...currentChildren].sort((left, right) =>
      left.localeCompare(right, undefined, { numeric: true, sensitivity: "base" })
    )
  };
}

/** Inserts at insertIndex (clamped), or appends at the end when omitted. */
export function insertManualOrderEntry(
  manualOrder: ManualOrderMap,
  parentRelativePath: string,
  basename: string,
  insertIndex?: number
): ManualOrderMap {
  const entry = manualOrder[parentRelativePath];

  if (!entry) {
    return manualOrder;
  }

  const clampedIndex =
    insertIndex === undefined ? entry.length : Math.max(0, Math.min(insertIndex, entry.length));

  return {
    ...manualOrder,
    [parentRelativePath]: [...entry.slice(0, clampedIndex), basename, ...entry.slice(clampedIndex)]
  };
}

/**
 * Turns the "insert relative to the selected tree entry" intent into a
 * concrete index: undefined appends at the end (no anchor / not in manual
 * mode yet), null means "as the first child" (a folder was selected), and a
 * basename means "directly after that entry" (a file was selected) — falling
 * back to append when the anchor itself isn't tracked in this parent's order.
 */
export function resolveManualOrderInsertIndex(
  manualOrder: ManualOrderMap,
  parentRelativePath: string,
  insertAfterBasename: string | null | undefined
): number | undefined {
  if (insertAfterBasename === undefined) {
    return undefined;
  }

  if (insertAfterBasename === null) {
    return 0;
  }

  const anchorIndex = manualOrder[parentRelativePath]?.indexOf(insertAfterBasename) ?? -1;

  return anchorIndex === -1 ? undefined : anchorIndex + 1;
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
