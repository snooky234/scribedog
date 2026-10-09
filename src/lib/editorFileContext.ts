import { createContext } from "react";

export type EditorFileContextValue = {
  folderPath: string | null;
  filePath: string | null;
  /**
   * Opens the drawing dialog for a drawing the editor shows, by the absolute
   * path the image view resolved. Null where drawings cannot be edited.
   */
  onEditDrawing: ((absolutePath: string) => void) | null;
};

export const EditorFileContext = createContext<EditorFileContextValue>({
  folderPath: null,
  filePath: null,
  onEditDrawing: null
});
