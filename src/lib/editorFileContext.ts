import { createContext } from "react";

export type EditorFileContextValue = {
  folderPath: string | null;
  filePath: string | null;
  /**
   * Opens the drawing dialog for a drawing the editor shows, by the absolute
   * path the image view resolved. Null where drawings cannot be edited.
   */
  onEditDrawing: ((absolutePath: string) => void) | null;
  /**
   * Opens the drawing dialog on a raster image of the note: the image file's
   * absolute path and the image node's position. Null where that is not offered.
   */
  onDrawOnImage: ((absolutePath: string, imagePos: number) => void) | null;
};

export const EditorFileContext = createContext<EditorFileContextValue>({
  folderPath: null,
  filePath: null,
  onEditDrawing: null,
  onDrawOnImage: null
});
