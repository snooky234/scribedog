import { useEffect } from "react";
import { listen } from "@tauri-apps/api/event";

import { FOLDER_FILES_CHANGED_EVENT } from "@/lib/fileSystem";
import { useAppStore } from "@/store/useAppStore";

export function useFolderWatcher(refreshFolderFiles: () => Promise<boolean>): void {
  useEffect(() => {
    let isMounted = true;
    let debounceHandle: number | undefined;
    let unlisten: (() => void) | null = null;

    const registerListener = async () => {
      const cleanup = await listen<string>(FOLDER_FILES_CHANGED_EVENT, (event) => {
        const currentFolderPath = useAppStore.getState().folderPath;

        if (!currentFolderPath || event.payload !== currentFolderPath) {
          return;
        }

        if (debounceHandle !== undefined) {
          window.clearTimeout(debounceHandle);
        }

        debounceHandle = window.setTimeout(() => {
          if (isMounted) {
            void refreshFolderFiles();
          }
        }, 150);
      });

      unlisten = cleanup;
    };

    void registerListener();

    return () => {
      isMounted = false;

      if (debounceHandle !== undefined) {
        window.clearTimeout(debounceHandle);
      }

      unlisten?.();
    };
  }, [refreshFolderFiles]);
}
