import { create } from "zustand";

import { createFileSlice } from "./appStore/fileSlice";
import { createFolderSlice } from "./appStore/folderSlice";
import { createTreeSlice } from "./appStore/treeSlice";
import { initialAppData } from "./appStore/initialState";
import type { AppState } from "./appStore/types";

export type {
  AppState,
  FileDocumentState,
  MoveTreeEntryInput
} from "./appStore/types";

/**
 * One store, composed from three slices (see appStore/types.ts for why each
 * slice is typed against the whole AppState). Consumers keep using
 * `useAppStore((state) => state.x)` exactly as before — the split is internal.
 */
export const useAppStore = create<AppState>()((...args) => ({
  ...initialAppData,
  ...createFolderSlice(...args),
  ...createFileSlice(...args),
  ...createTreeSlice(...args)
}));
