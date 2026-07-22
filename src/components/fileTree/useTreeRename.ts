import { useCallback, useEffect, useRef, useState } from "react";

import { join } from "@tauri-apps/api/path";

import type { RenamingTarget } from "./types";

type UseTreeRenameOptions = {
  folderPath: string;
  onRenameFolder: (folderPath: string, newBaseName: string) => Promise<boolean>;
  onRenameFile: (filePath: string, newBaseName: string) => Promise<boolean>;
};

/** Inline rename of a tree row, for both files and folders. */
export function useTreeRename({ folderPath, onRenameFolder, onRenameFile }: UseTreeRenameOptions) {
  const [renamingTarget, setRenamingTarget] = useState<RenamingTarget | null>(null);
  const [renameDraft, setRenameDraft] = useState("");
  const renameInputRef = useRef<HTMLInputElement>(null);
  const skipRenameCommitRef = useRef(false);

  useEffect(() => {
    if (renamingTarget) {
      renameInputRef.current?.focus();
      renameInputRef.current?.select();
    }
  }, [renamingTarget]);

  const startFolderRename = useCallback((relativePath: string) => {
    skipRenameCommitRef.current = false;
    setRenamingTarget({ kind: "folder", relativePath });
    setRenameDraft(relativePath.split("/").pop() ?? relativePath);
  }, []);

  const startFileRename = useCallback((relativePath: string) => {
    skipRenameCommitRef.current = false;
    setRenamingTarget({ kind: "file", relativePath });
    const baseName = relativePath.split("/").pop() ?? relativePath;
    setRenameDraft(baseName.replace(/\.md$/i, ""));
  }, []);

  const cancelRename = useCallback(() => {
    skipRenameCommitRef.current = true;
    setRenamingTarget(null);
  }, []);

  // Guard following the pattern of commitTitleRename in App.tsx: Enter
  // usually also triggers onBlur; without the lock, the second call would
  // try to rename the (already renamed) old path a second time.
  const commitRename = useCallback(async () => {
    if (skipRenameCommitRef.current || !renamingTarget) {
      return;
    }

    skipRenameCommitRef.current = true;

    const trimmedDraft = renameDraft.trim();
    const currentBaseName = renamingTarget.relativePath.split("/").pop() ?? renamingTarget.relativePath;
    const currentName =
      renamingTarget.kind === "file" ? currentBaseName.replace(/\.md$/i, "") : currentBaseName;

    if (!trimmedDraft || trimmedDraft === currentName) {
      setRenamingTarget(null);
      return;
    }

    const fullPath = await join(folderPath, renamingTarget.relativePath);
    const didRename =
      renamingTarget.kind === "folder"
        ? await onRenameFolder(fullPath, trimmedDraft)
        : await onRenameFile(fullPath, trimmedDraft);

    if (didRename) {
      setRenamingTarget(null);
    } else {
      skipRenameCommitRef.current = false;
      renameInputRef.current?.focus();
    }
  }, [folderPath, onRenameFolder, onRenameFile, renameDraft, renamingTarget]);

  return {
    renamingTarget,
    renameDraft,
    setRenameDraft,
    renameInputRef,
    startFileRename,
    startFolderRename,
    commitRename,
    cancelRename
  };
}
