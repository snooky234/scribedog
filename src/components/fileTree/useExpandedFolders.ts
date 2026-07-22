import { useCallback, useState } from "react";

import {
  getAncestorFolderPaths,
  getStoredExpandedFolderPaths,
  setStoredExpandedFolderPaths
} from "@/lib/fileTree";

/**
 * Which folders are expanded, persisted per vault. Every change writes through
 * to localStorage, so the tree looks the same after a restart.
 */
export function useExpandedFolders(folderPath: string) {
  const [expandedFolderPaths, setExpandedFolderPaths] = useState<Set<string>>(() =>
    getStoredExpandedFolderPaths(folderPath)
  );

  const toggleFolder = useCallback(
    (relativePath: string) => {
      setExpandedFolderPaths((currentPaths) => {
        const nextPaths = new Set(currentPaths);

        if (nextPaths.has(relativePath)) {
          nextPaths.delete(relativePath);
        } else {
          nextPaths.add(relativePath);
        }

        setStoredExpandedFolderPaths(folderPath, nextPaths);

        return nextPaths;
      });
    },
    [folderPath]
  );

  /** Expands every folder on the way to `relativePath`, so the entry is visible. */
  const expandAncestorsOf = useCallback(
    (relativePath: string) => {
      const ancestors = getAncestorFolderPaths(relativePath);

      setExpandedFolderPaths((currentPaths) => {
        if (ancestors.every((ancestor) => currentPaths.has(ancestor))) {
          return currentPaths;
        }

        const nextPaths = new Set(currentPaths);

        for (const ancestor of ancestors) {
          nextPaths.add(ancestor);
        }

        setStoredExpandedFolderPaths(folderPath, nextPaths);

        return nextPaths;
      });
    },
    [folderPath]
  );

  return { expandedFolderPaths, toggleFolder, expandAncestorsOf };
}
