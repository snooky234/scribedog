import { create } from "zustand";

import { createFileSlice } from "./appStore/fileSlice";
import { createFolderSlice } from "./appStore/folderSlice";
import { createTreeSlice } from "./appStore/treeSlice";
import { createWorkingSetSlice } from "./appStore/workingSetSlice";
import { initialAppData } from "./appStore/initialState";
import type { AppState } from "./appStore/types";
import { flushPendingFileVersion } from "./appStore/versioning";

export type {
  AppState,
  FileDocumentState,
  MoveTreeEntryInput
} from "./appStore/types";
export type { WorkingSetEntry } from "./appStore/workingSet";

/**
 * One store, composed from three slices (see appStore/types.ts for why each
 * slice is typed against the whole AppState). Consumers keep using
 * `useAppStore((state) => state.x)` exactly as before — the split is internal.
 */
export const useAppStore = create<AppState>()((...args) => ({
  ...initialAppData,
  ...createFolderSlice(...args),
  ...createFileSlice(...args),
  ...createTreeSlice(...args),
  ...createWorkingSetSlice(...args)
}));

// Leaving a note is what turns the auto-saved state into a version
// (appStore/versioning.ts). Watched here rather than in each action, since a
// note is left by picking another one, creating one, navigating back, the
// folder note, a deletion elsewhere; a rename keeps the pending version on the
// new path before the selection moves, so it is not taken for a departure.
useAppStore.subscribe((state, previousState) => {
  const leftFilePath = previousState.selectedFilePath;

  if (leftFilePath && leftFilePath !== state.selectedFilePath) {
    void flushPendingFileVersion(leftFilePath);
  }
});
