import { useEffect, useRef, useState } from "react";

type UseTitleRenameOptions = {
  selectedFilePath: string | null;
  selectedFileBaseName: string;
  renameSelectedFile: (newBaseName: string) => Promise<boolean>;
};

export function useTitleRename({
  selectedFilePath,
  selectedFileBaseName,
  renameSelectedFile
}: UseTitleRenameOptions) {
  const [isRenamingTitle, setIsRenamingTitle] = useState(false);
  const [titleDraft, setTitleDraft] = useState("");
  const [renameSessionId, setRenameSessionId] = useState(0);
  const skipRenameCommitRef = useRef(false);
  const renameTargetPathRef = useRef<string | null>(null);
  const titleInputRef = useRef<HTMLInputElement | null>(null);

  const startTitleRename = (initialDraft: string, targetFilePath: string | null) => {
    skipRenameCommitRef.current = false;
    renameTargetPathRef.current = targetFilePath;
    setTitleDraft(initialDraft);
    setIsRenamingTitle(true);
    setRenameSessionId((id) => id + 1);
  };

  const commitTitleRename = async () => {
    if (skipRenameCommitRef.current) {
      return;
    }

    skipRenameCommitRef.current = true;

    if (titleDraft.trim() === selectedFileBaseName || titleDraft.trim() === "") {
      setIsRenamingTitle(false);
      return;
    }

    const didRename = await renameSelectedFile(titleDraft);

    if (didRename) {
      setIsRenamingTitle(false);
    } else {
      skipRenameCommitRef.current = false;
      titleInputRef.current?.focus();
    }
  };

  const cancelTitleRename = () => {
    skipRenameCommitRef.current = true;
    setIsRenamingTitle(false);
  };

  useEffect(() => {
    if (selectedFilePath !== renameTargetPathRef.current) {
      setIsRenamingTitle(false);
      skipRenameCommitRef.current = false;
    }
  }, [selectedFilePath]);

  useEffect(() => {
    if (isRenamingTitle) {
      titleInputRef.current?.focus();
      titleInputRef.current?.select();
    }
    // renameSessionId ensures focus/selection are reset even when a new
    // rename starts while isRenamingTitle was already true from the previous
    // session (e.g. quickly creating another file before the old blur committed).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isRenamingTitle, renameSessionId]);

  return {
    isRenamingTitle,
    titleDraft,
    setTitleDraft,
    titleInputRef,
    startTitleRename,
    commitTitleRename,
    cancelTitleRename
  };
}
