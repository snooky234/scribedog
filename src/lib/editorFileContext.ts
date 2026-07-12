import { createContext } from "react";

export type EditorFileContextValue = {
  folderPath: string | null;
  filePath: string | null;
};

export const EditorFileContext = createContext<EditorFileContextValue>({
  folderPath: null,
  filePath: null
});
