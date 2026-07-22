import { useCallback, useEffect, useRef, useState } from "react";

import { join } from "@tauri-apps/api/path";

import { getRelativeDisplayPath } from "@/lib/fileSystem";
import type { FileTreeNode } from "@/lib/fileTree";

import { getNodeKey, getTopLevelSelection } from "./treeNavigation";
import type { BatchEntry } from "./types";

type UseTreeSelectionOptions = {
  folderPath: string;
  selectedFilePath: string | null;
  treeNodes: FileTreeNode[];
  flatNodes: FileTreeNode[];
  focusRequestId?: number;
  onSelectionChange?: (entries: BatchEntry[]) => void;
};

function collectAllKeys(nodes: FileTreeNode[]): string[] {
  const keys: string[] = [];

  for (const node of nodes) {
    keys.push(getNodeKey(node));

    if (node.kind === "folder") {
      keys.push(...collectAllKeys(node.children));
    }
  }

  return keys;
}

/**
 * Selection state of the tree: the active row (roving tabindex), the
 * multi-selection, and the moving edge of a Shift range. Also owns the DOM
 * refs of the rows, since focusing is part of moving the selection.
 */
export function useTreeSelection({
  folderPath,
  selectedFilePath,
  treeNodes,
  flatNodes,
  focusRequestId,
  onSelectionChange
}: UseTreeSelectionOptions) {
  const [activeKey, setActiveKey] = useState<string | null>(null);
  // Range anchor for Shift-click/Shift-Arrow is activeKey itself; rangeFocusKey
  // tracks the moving edge across consecutive Shift+Arrow presses so the
  // anchor stays fixed until a non-Shift interaction resets it.
  const [rangeFocusKey, setRangeFocusKey] = useState<string | null>(null);
  const [selectedKeys, setSelectedKeys] = useState<Set<string>>(() => new Set());
  const itemRefs = useRef<Map<string, HTMLButtonElement>>(new Map());
  // Last handled request value instead of a bool guard: StrictMode-safe, same
  // pattern as in Editor.tsx (duplicate mount effects would otherwise focus
  // unintentionally on the second run).
  const lastHandledFocusRequestRef = useRef(focusRequestId);

  const registerItemRef = useCallback((key: string, element: HTMLButtonElement | null) => {
    if (element) {
      itemRefs.current.set(key, element);
    } else {
      itemRefs.current.delete(key);
    }
  }, []);

  const focusItem = useCallback((key: string) => {
    itemRefs.current.get(key)?.focus();
  }, []);

  // Same reduction used by the multi-select context menu's export/delete
  // actions, so the toolbar delete button and the Delete key act on exactly
  // the same set of entries a right-click batch action would.
  const selectionAsBatchEntries = useCallback(
    (keys: Iterable<string>): BatchEntry[] =>
      getTopLevelSelection(keys, flatNodes).map((node) => ({
        kind: node.kind,
        path: node.kind === "file" ? node.filePath : node.relativePath
      })),
    [flatNodes]
  );

  /** Batch entries with folder paths resolved to absolute paths. */
  const resolveBatchEntries = useCallback(
    async (keys: Iterable<string>) =>
      Promise.all(
        selectionAsBatchEntries(keys).map(async (entry) => ({
          kind: entry.kind,
          path: entry.kind === "folder" ? await join(folderPath, entry.path) : entry.path
        }))
      ),
    [folderPath, selectionAsBatchEntries]
  );

  useEffect(() => {
    if (!onSelectionChange) {
      return;
    }

    if (selectedKeys.size > 1) {
      onSelectionChange(selectionAsBatchEntries(selectedKeys));
      return;
    }

    if (activeKey) {
      onSelectionChange(selectionAsBatchEntries([activeKey]));
      return;
    }

    onSelectionChange([]);
  }, [selectedKeys, activeKey, selectionAsBatchEntries, onSelectionChange]);

  // Moves the active entry (roving tabindex) to the file that was just
  // opened, so tabbing back from the editor later lands on the file being
  // edited instead of a previously selected row.
  useEffect(() => {
    if (!selectedFilePath) {
      return;
    }

    setActiveKey(`file:${getRelativeDisplayPath(folderPath, selectedFilePath)}`);
  }, [folderPath, selectedFilePath]);

  // Falls back to the first visible entry if the active one drops out of the
  // visible list (e.g. because its parent folder was collapsed).
  useEffect(() => {
    setActiveKey((currentKey) => {
      if (currentKey && flatNodes.some((node) => getNodeKey(node) === currentKey)) {
        return currentKey;
      }

      return flatNodes.length > 0 ? getNodeKey(flatNodes[0]) : null;
    });
  }, [flatNodes]);

  // Drops selected keys whose node no longer exists in the tree at all (e.g.
  // after a batch delete/move) — merely collapsing a folder does not clear
  // selections inside it, only nodes that actually vanished from the data.
  useEffect(() => {
    const allKeys = new Set(collectAllKeys(treeNodes));

    setSelectedKeys((currentKeys) => {
      const nextKeys = new Set([...currentKeys].filter((key) => allKeys.has(key)));
      return nextKeys.size === currentKeys.size ? currentKeys : nextKeys;
    });
  }, [treeNodes]);

  // Focus request from outside (editor: Shift+Tab) returns focus to the
  // sidebar, onto the active tree entry.
  useEffect(() => {
    if (lastHandledFocusRequestRef.current === focusRequestId) {
      return;
    }

    lastHandledFocusRequestRef.current = focusRequestId;

    const targetKey = activeKey ?? (flatNodes.length > 0 ? getNodeKey(flatNodes[0]) : null);

    if (targetKey) {
      itemRefs.current.get(targetKey)?.focus();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusRequestId]);

  return {
    activeKey,
    setActiveKey,
    rangeFocusKey,
    setRangeFocusKey,
    selectedKeys,
    setSelectedKeys,
    registerItemRef,
    focusItem,
    selectionAsBatchEntries,
    resolveBatchEntries
  };
}
