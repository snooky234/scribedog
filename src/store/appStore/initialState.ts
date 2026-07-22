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
  sortMode: "name",
  manualOrder: {},
  fileMtimeMs: {},
  emptyFolderMtimeMs: {}
};
