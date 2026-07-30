import { DEFAULT_SORT_MODE } from "@/lib/vaultMeta";

import type { AppData } from "./types";

export const initialAppData: AppData = {
  folderPath: null,
  filePaths: [],
  emptyFolderPaths: [],
  selectedFilePath: null,
  selectedFileContent: null,
  selectedFileBaseContent: null,
  fileDocuments: {},
  isLoading: false,
  isFileLoading: false,
  isSaving: false,
  isRefreshing: false,
  isDirty: false,
  folderError: null,
  fileError: null,
  saveError: null,
  sortMode: DEFAULT_SORT_MODE,
  manualOrder: {},
  fileMtimeMs: {},
  emptyFolderMtimeMs: {}
};
