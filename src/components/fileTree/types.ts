/** Types shared between FileTree, its rows and its consumers. */

export type PendingFolderRename = {
  folderPath: string;
  requestId: number;
};

export type DropPosition = "above" | "below" | "into";

export type DropIndicator = {
  key: string;
  position: DropPosition;
};

export type BatchEntry = { kind: "file" | "folder"; path: string };

export type FileContextMenuState =
  | { kind: "file"; filePath: string; x: number; y: number }
  | { kind: "folder"; relativePath: string; x: number; y: number }
  | { kind: "multiple"; keys: string[]; x: number; y: number };

export type RenamingTarget =
  | { kind: "file"; relativePath: string }
  | { kind: "folder"; relativePath: string };
