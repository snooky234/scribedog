// Which folder of the file tree an external drag is currently hovering.
//
// Its own store rather than props because the highlight is needed at both ends
// of the tree: the panel marks itself as a drop target, and the row under the
// pointer marks itself as the folder the import would land in — and the rows
// sit several components below the handler that tracks the drag.
//
// Only drags from outside the app write here. Reordering inside the tree has
// its own indicator (see fileTree/useTreeDragDrop.ts), and mixing the two would
// make a move look like an import.

import { create } from "zustand";

type ImportDropState = {
  /**
   * Vault-relative directory the drop would import into ("" is the vault root),
   * or null while no external drag is over the tree.
   */
  targetDirectory: string | null;
  setTargetDirectory: (directory: string | null) => void;
};

export const useImportDropStore = create<ImportDropState>((set) => ({
  targetDirectory: null,
  setTargetDirectory: (directory) =>
    // dragover fires continuously; re-rendering the whole tree for every pixel
    // of pointer movement is what this guard is here to prevent.
    set((state) => (state.targetDirectory === directory ? state : { targetDirectory: directory }))
}));

/** Marks a file-tree row with the directory a drop on it imports into. */
export const DROP_DIRECTORY_ATTRIBUTE = "data-drop-directory";
