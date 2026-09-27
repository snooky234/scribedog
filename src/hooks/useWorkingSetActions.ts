import { useCallback, useState } from "react";

import { isDocumentDirty } from "@/store/appStore/documents";
import { hasWorkingSetEntry } from "@/store/appStore/workingSet";
import { useAppStore } from "@/store/useAppStore";

/**
 * What the dialog for closing a dirty entry is about: the note, and the
 * entries still waiting behind it ("close others", "close all" work through
 * the list one note at a time, and stop at the first Cancel).
 */
export type WorkingSetCloseRequest = {
  filePath: string;
  remaining: string[];
};

/**
 * The actions behind the "In progress" section that the store cannot do on
 * its own because they may have to ask: closing a dirty note goes through
 * Save / Discard / Cancel first. Clean notes close at once. Everything else
 * (pin, unpin, discard from the tree) is a straight store call, gathered
 * here so the sidebar gets one object.
 */
export function useWorkingSetActions() {
  const [closeRequest, setCloseRequest] = useState<WorkingSetCloseRequest | null>(null);

  const isDirty = (filePath: string): boolean => {
    const document = useAppStore.getState().fileDocuments[filePath];
    return document ? isDocumentDirty(document) : false;
  };

  // Closes what it can without asking and stops at the first dirty note,
  // which becomes the dialog's subject; the rest waits in `remaining`.
  const closeEntries = useCallback((filePaths: string[]) => {
    const queue = [...filePaths];

    while (queue.length > 0) {
      const filePath = queue.shift() as string;

      if (isDirty(filePath)) {
        setCloseRequest({ filePath, remaining: queue });
        return;
      }

      useAppStore.getState().closeWorkingSetEntry(filePath);
    }

    setCloseRequest(null);
  }, []);

  const closeEntry = useCallback((filePath: string) => closeEntries([filePath]), [closeEntries]);

  const closeOthers = useCallback(
    (keptFilePath: string) => {
      closeEntries(
        useAppStore
          .getState()
          .workingSet.map((entry) => entry.filePath)
          .filter((filePath) => filePath !== keptFilePath)
      );
    },
    [closeEntries]
  );

  const closeAll = useCallback(() => {
    closeEntries(useAppStore.getState().workingSet.map((entry) => entry.filePath));
  }, [closeEntries]);

  /** Ctrl+W: the open note's entry, if it has one; otherwise nothing. */
  const closeSelectedEntry = useCallback(() => {
    const { selectedFilePath, workingSet } = useAppStore.getState();

    if (selectedFilePath && hasWorkingSetEntry(workingSet, selectedFilePath)) {
      closeEntries([selectedFilePath]);
    }
  }, [closeEntries]);

  // Save: the entry closes only if the save went through. A save that met
  // an external change opens its own dialog and resolves false; the entry
  // then stays, dirty, and the rest of the queue is dropped, since the user
  // has a different question to answer now.
  const saveAndClose = useCallback(async () => {
    if (!closeRequest) {
      return;
    }

    const saved = await useAppStore.getState().saveFilePath(closeRequest.filePath);

    if (!saved) {
      setCloseRequest(null);
      return;
    }

    useAppStore.getState().closeWorkingSetEntry(closeRequest.filePath);
    closeEntries(closeRequest.remaining);
  }, [closeRequest, closeEntries]);

  const discardAndClose = useCallback(() => {
    if (!closeRequest) {
      return;
    }

    const store = useAppStore.getState();
    store.discardFileChanges(closeRequest.filePath);
    store.closeWorkingSetEntry(closeRequest.filePath);
    closeEntries(closeRequest.remaining);
  }, [closeRequest, closeEntries]);

  const cancelClose = useCallback(() => setCloseRequest(null), []);

  return {
    closeRequest,
    closeEntry,
    closeEntries,
    closeOthers,
    closeAll,
    closeSelectedEntry,
    saveAndClose,
    discardAndClose,
    cancelClose
  };
}
