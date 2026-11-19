import { create } from "zustand";

import { getRelativeDisplayPath } from "@/lib/fileSystem";
import {
  placemarkPathKey,
  removePlacemarkPath,
  renamePlacemarkPath,
  setFilePlacemarks,
  type PlacemarkAnchor,
  type PlacemarkFileMap
} from "@/lib/placemarks";
import { readPlacemarks, writePlacemarks } from "@/lib/vaultMeta";

// The placemarks of the open vault (lib/placemarks.ts) and their sidecar.
// Deliberately does not import the app store: the app store's rename and
// delete actions call into this one, and a subscription back would make the
// two modules import each other. The editor asks for a vault's marks when it
// opens a note (ensureLoaded), and the app store reports path changes.

type PlacemarksState = {
  /** The vault `files` belongs to; null until one was loaded. */
  vaultPath: string | null;
  files: PlacemarkFileMap;
  ensureLoaded: (vaultPath: string) => Promise<void>;
  getFileAnchors: (vaultPath: string, relativePath: string) => PlacemarkAnchor[];
  setFileAnchors: (vaultPath: string, relativePath: string, anchors: PlacemarkAnchor[]) => void;
  /** A note or folder was renamed or moved; absolute paths, as the app store has them. */
  movePath: (vaultPath: string, fromPath: string, toPath: string) => void;
  /** A note or folder was deleted. */
  removePath: (vaultPath: string, removedPath: string) => void;
};

/** Typing in a marked block changes its quote; one write per pause is enough. */
const WRITE_DELAY_MS = 600;

let loading: { vaultPath: string; promise: Promise<void> } | null = null;
let pendingWrite: { vaultPath: string; files: PlacemarkFileMap } | null = null;
let writeTimer: ReturnType<typeof setTimeout> | undefined;

function flushPendingWrite(): void {
  clearTimeout(writeTimer);
  writeTimer = undefined;

  if (!pendingWrite) {
    return;
  }

  const { vaultPath, files } = pendingWrite;
  pendingWrite = null;
  // A mark that fails to persist is not worth an error dialog; the next
  // change writes the whole map again.
  void writePlacemarks(vaultPath, { version: 1, files }).catch(() => undefined);
}

function scheduleWrite(vaultPath: string, files: PlacemarkFileMap): void {
  if (pendingWrite && pendingWrite.vaultPath !== vaultPath) {
    flushPendingWrite();
  }

  pendingWrite = { vaultPath, files };
  clearTimeout(writeTimer);
  writeTimer = setTimeout(flushPendingWrite, WRITE_DELAY_MS);
}

if (typeof window !== "undefined") {
  window.addEventListener("pagehide", flushPendingWrite);
}

export const usePlacemarksStore = create<PlacemarksState>((set, get) => {
  /** Applies a change to a vault's map once that vault is the loaded one. */
  const update = (vaultPath: string, change: (files: PlacemarkFileMap) => PlacemarkFileMap) => {
    const apply = () => {
      const { vaultPath: loadedVault, files } = get();

      if (loadedVault !== vaultPath) {
        return;
      }

      const next = change(files);

      if (next !== files) {
        set({ files: next });
        scheduleWrite(vaultPath, next);
      }
    };

    if (get().vaultPath === vaultPath) {
      apply();
    } else {
      // A rename in a vault whose marks were never asked for yet: load them
      // first, or the change would be lost on the next load.
      void get().ensureLoaded(vaultPath).then(apply);
    }
  };

  return {
    vaultPath: null,
    files: {},

    ensureLoaded: (vaultPath) => {
      if (get().vaultPath === vaultPath) {
        return Promise.resolve();
      }

      if (loading?.vaultPath === vaultPath) {
        return loading.promise;
      }

      flushPendingWrite();

      const promise = readPlacemarks(vaultPath).then((stored) => {
        if (loading?.vaultPath === vaultPath) {
          loading = null;
          set({ vaultPath, files: stored.files });
        }
      });

      loading = { vaultPath, promise };
      return promise;
    },

    getFileAnchors: (vaultPath, relativePath) => {
      const { vaultPath: loadedVault, files } = get();
      return loadedVault === vaultPath ? files[placemarkPathKey(relativePath)] ?? [] : [];
    },

    setFileAnchors: (vaultPath, relativePath, anchors) => {
      if (get().vaultPath !== vaultPath) {
        return;
      }

      update(vaultPath, (files) => setFilePlacemarks(files, relativePath, anchors));
    },

    movePath: (vaultPath, fromPath, toPath) => {
      update(vaultPath, (files) =>
        renamePlacemarkPath(
          files,
          getRelativeDisplayPath(vaultPath, fromPath),
          getRelativeDisplayPath(vaultPath, toPath)
        )
      );
    },

    removePath: (vaultPath, removedPath) => {
      update(vaultPath, (files) => removePlacemarkPath(files, getRelativeDisplayPath(vaultPath, removedPath)));
    }
  };
});
