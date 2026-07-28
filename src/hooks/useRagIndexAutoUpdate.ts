import { useEffect } from "react";
import { listen } from "@tauri-apps/api/event";

import { FOLDER_FILES_CHANGED_EVENT } from "@/lib/fileSystem";
import { useAppStore } from "@/store/useAppStore";
import { useRagIndexStore } from "@/store/useRagIndexStore";
import { isSemanticSearchConfigured } from "@/store/useRagEmbeddingStore";
import { useRagSettingsStore } from "@/store/useRagSettingsStore";

/**
 * Keeps an already prepared knowledge base current as notes come, change and go.
 *
 * Long debounce on purpose: this reacts to saving a file, and re-embedding a
 * note the user is still typing in would send half-written text away over and
 * over. Waiting until the vault has been quiet for a while costs nothing —
 * until then, keyword search still covers the edited note (the meaning search
 * skips passages whose file changed since it was prepared).
 */
const QUIET_PERIOD_MS = 8_000;

/**
 * Files can also appear or vanish while the app is closed, where no watcher
 * event ever fires. Checking once shortly after a vault is opened catches that,
 * late enough that the folder scan has filled the file list.
 */
const AFTER_VAULT_OPEN_MS = 4_000;

async function updateIfNeeded(): Promise<void> {
  const { config } = useRagSettingsStore.getState();

  // Never starts anything on its own that the user has not started once
  // themselves: this only *keeps up* a knowledge base that already exists.
  // A first upload of the whole vault stays a button press.
  if (!config.enabled || !isSemanticSearchConfigured()) {
    return;
  }

  const store = useRagIndexStore.getState();

  if (store.isBuilding) {
    return;
  }

  await store.refreshStatus();

  const status = useRagIndexStore.getState().status;

  if (!status || status.provider === null || !status.matchesSettings) {
    return;
  }

  // Obsolete files matter as much as pending ones, and they are the case with
  // nothing to embed: a deleted note (or a folder the user just unticked) has
  // to have its vectors dropped, and a run with an empty to-do list does
  // exactly that and nothing else.
  if (status.pendingFiles.length > 0 || status.obsoleteFiles > 0) {
    await useRagIndexStore.getState().build();
  }
}

export function useRagIndexAutoUpdate(): void {
  const folderPath = useAppStore((state) => state.folderPath);

  useEffect(() => {
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

        debounceHandle = window.setTimeout(() => void updateIfNeeded(), QUIET_PERIOD_MS);
      });

      unlisten = cleanup;
    };

    void registerListener();

    return () => {
      if (debounceHandle !== undefined) {
        window.clearTimeout(debounceHandle);
      }

      unlisten?.();
    };
  }, []);

  useEffect(() => {
    if (!folderPath) {
      return;
    }

    const handle = window.setTimeout(() => void updateIfNeeded(), AFTER_VAULT_OPEN_MS);

    return () => window.clearTimeout(handle);
  }, [folderPath]);
}
