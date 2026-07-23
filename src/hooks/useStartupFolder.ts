import { useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";

import { clearLastOpenedFolderPath, getLastOpenedFolderPath } from "@/lib/fileSystem";

export function useStartupFolder(
  openFolderAtPath: (folderPath: string) => Promise<boolean>
): void {
  useEffect(() => {
    let isActive = true;

    const loadStartupFolder = async () => {
      const startupFolderPath = await invoke<string | null>("get_startup_folder_path");
      const targetFolderPath = startupFolderPath ?? getLastOpenedFolderPath();

      if (!isActive || !targetFolderPath) {
        return;
      }

      const didOpenFolder = await openFolderAtPath(targetFolderPath);

      if (!didOpenFolder && !startupFolderPath) {
        clearLastOpenedFolderPath();
      }
    };

    void loadStartupFolder();

    return () => {
      isActive = false;
    };
  }, [openFolderAtPath]);
}
