import { getVersion } from "@tauri-apps/api/app";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { dirname, join, normalize } from "@tauri-apps/api/path";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { open as openDialog, save as saveDialog } from "@tauri-apps/plugin-dialog";
import { fetch as tauriFetch } from "@tauri-apps/plugin-http";
import { openUrl } from "@tauri-apps/plugin-opener";
import { relaunch } from "@tauri-apps/plugin-process";
import { check as checkForUpdate } from "@tauri-apps/plugin-updater";

import { guessImageMimeType } from "@/lib/imageMimeTypes";
import { normalizeDisplayPath } from "@/lib/vaultPaths";
import { joinPosixPath, normalizePosixPath, posixDirname } from "@/platform/remote/paths";
import { isRemoteVaultPath } from "@/platform/remote/vaultRoot";
import type {
  Platform,
  PortableStatus,
  SpellcheckDictionaryStatus,
  VoiceModelDownloadProgress,
  VoiceModelStatus
} from "@/platform/types";

import { localFs, localVaultStorage } from "./fs";
import { desktopRemoteVaults } from "./remoteVaults";

/** Fired by the Rust file watcher (`watch_folder`) with the watched folder path. */
export const FOLDER_FILES_CHANGED_EVENT = "scribedog-folder-files-changed";

const NOT_PORTABLE: PortableStatus = { mode: "off", configDir: "" };

function hasTauriShell(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

let portableStatus: Promise<PortableStatus> | null = null;

/**
 * The Tauri desktop app: everything native goes to the Rust side through
 * `invoke`, the filesystem through the fs plugin. This is the platform the
 * frontend was written against, so most members are the original calls, just
 * behind the interface.
 */
export const platform: Platform = {
  kind: "desktop",
  features: {
    localFolders: true,
    importFiles: true,
    exportFiles: true,
    downloads: true,
    updater: true,
    voiceInput: true,
    portableMode: true,
    knowledgeIndex: true,
    spellcheckDictionary: true,
    session: false,
    browserLocalModels: false,
    remoteVaults: true
  },

  vaultStorage: localVaultStorage,
  localFs,
  // Delegating lazily (rather than handing the imports over directly) keeps
  // the tests' partial mocks of the Tauri modules working: nothing is touched
  // until it is called.
  //
  // A path under a server vault's virtual root is POSIX and stays POSIX:
  // Tauri's join would turn it into a backslash path on Windows, and the
  // store would then hold two spellings of the same note (the listing's and
  // the one it built itself). Everything else is a real path on this machine.
  paths: {
    join: (...parts) => (isRemoteVaultPath(parts[0] ?? "") ? Promise.resolve(joinPosixPath(...parts)) : join(...parts)),
    dirname: (path) => (isRemoteVaultPath(path) ? Promise.resolve(posixDirname(path)) : dirname(path)),
    normalize: (path) => (isRemoteVaultPath(path) ? Promise.resolve(normalizePosixPath(path)) : normalize(path))
  },

  vault: {
    allowFolderAccess: (folderPath) => invoke("allow_folder_scope", { folderPath }),
    // The dialog plugin usually widens the fs scope for user-picked files by
    // itself; this explicit grant is the robust fallback for import sources
    // living outside the opened vault.
    allowFileAccess: (filePath) => invoke("allow_file_scope", { filePath }),
    watchFolder: (folderPath) => invoke("watch_folder", { folderPath }),
    folderExists: (folderPath) => invoke<boolean>("folder_exists", { folderPath }),
    getStartupFolderPath: () => invoke<string | null>("get_startup_folder_path"),
    onFolderFilesChanged: (handler) =>
      listen<string>(FOLDER_FILES_CHANGED_EVENT, (event) => handler(event.payload)),
    displayName: (folderPath) => normalizeDisplayPath(folderPath)
  },

  app: {
    getVersion: () => getVersion().catch(() => null)
  },
  shell: {
    openUrl,
    openFolderInFileManager: (folderPath) => invoke("open_folder_in_file_manager", { folderPath })
  },
  http: { fetch: (url, init) => tauriFetch(url, init) },
  window: {
    // Native webview zoom behaves like browser zoom: the layout reflows and
    // viewport units adapt, unlike CSS zoom on the body (which leaves 100vh
    // at its unscaled size and produces empty space when zooming out).
    setZoom: (factor) => getCurrentWebview().setZoom(factor),
    reveal: async () => {
      const appWindow = getCurrentWindow();
      await appWindow.show();
      await appWindow.setFocus();
    },
    isFullscreen: () => getCurrentWindow().isFullscreen(),
    setFullscreen: (fullscreen) => getCurrentWindow().setFullscreen(fullscreen),
    onCloseRequested: async (handler) => {
      const appWindow = getCurrentWindow();
      // The close button can be hit twice while the handler runs; the
      // second request must not start a second handler or a second destroy.
      let closing = false;

      return appWindow.onCloseRequested(async (event) => {
        event.preventDefault();

        if (closing) {
          return;
        }

        closing = true;

        try {
          await handler();
        } finally {
          // destroy(), not close(): close() would raise this event again.
          await appWindow.destroy();
        }
      });
    }
  },
  credentials: {
    storeApiKey: (id, apiKey) => invoke("store_api_key", { provider: id, apiKey }),
    getApiKey: (id) => invoke<string>("get_api_key", { provider: id }),
    // The OS credential store is unlocked whenever the user's desktop session
    // is; there is no state to report.
    getStatus: async () => ({ state: "ready", discardedAt: null })
  },
  portable: {
    // Resolved once per session: the Rust side detects the mode once at
    // startup, and the call also widens the fs scope to the returned
    // directory, so repeating it would only repeat that.
    getStatus: () => {
      if (!hasTauriShell()) {
        return Promise.resolve(NOT_PORTABLE);
      }

      portableStatus ??= invoke<PortableStatus>("get_portable_status").catch(() => NOT_PORTABLE);

      return portableStatus;
    }
  },
  spellcheck: {
    checkDictionary: (language) => invoke<SpellcheckDictionaryStatus>("check_spellcheck_dictionary", { language })
  },

  dialogs: {
    chooseFolder: async ({ title, defaultPath }) => {
      const selected = await openDialog({ directory: true, recursive: true, title, defaultPath });

      return typeof selected === "string" ? selected : null;
    },
    chooseFiles: async ({ title, filters, defaultPath }) => {
      const selected = await openDialog({ multiple: true, directory: false, title, filters, defaultPath });

      return typeof selected === "string" ? [selected] : Array.isArray(selected) ? selected : [];
    }
  },
  imagePicker: {
    pickImages: async ({ defaultPath, title, filterName, extensions }) => {
      const selected = await openDialog({
        multiple: true,
        directory: false,
        title,
        defaultPath,
        filters: [{ name: filterName, extensions }]
      });
      const paths = typeof selected === "string" ? [selected] : Array.isArray(selected) ? selected : [];

      return paths.map((path) => ({
        fileName: path.replace(/\\/g, "/").split("/").pop() ?? "image",
        read: async () => {
          // The dialog does not widen the fs scope by itself; a picked file
          // outside the vault is unreadable until the shell allows it.
          await invoke("allow_file_scope", { filePath: path });

          return { mimeType: guessImageMimeType(path), data: await localFs.readFile(path) };
        }
      }));
    }
  },
  downloads: {
    // "Download" on the desktop is a save dialog: the user picks the file,
    // the dialog plugin widens the fs scope to it, and the bytes are written
    // through the same local filesystem the export uses.
    saveFile: async ({ fileName, data }) => {
      const extension = fileName.split(".").pop() ?? "";
      const target = await saveDialog({
        defaultPath: fileName,
        filters: extension ? [{ name: extension.toUpperCase(), extensions: [extension] }] : []
      });

      if (!target) {
        return false;
      }

      await invoke("allow_file_scope", { filePath: target });

      if (typeof data === "string") {
        await localFs.writeTextFile(target, data);
      } else {
        await localFs.writeFile(target, data);
      }

      return true;
    }
  },
  voice: {
    getModelStatus: () => invoke<VoiceModelStatus>("voice_model_status"),
    downloadModel: () => invoke("download_voice_model"),
    startRecording: () => invoke("start_voice_recording"),
    stopRecording: (language) => invoke<string>("stop_voice_recording", { language }),
    cancelRecording: () => invoke("cancel_voice_recording"),
    onModelDownloadProgress: (handler) =>
      listen<VoiceModelDownloadProgress>("scribedog-voice-model-download-progress", (event) =>
        handler(event.payload)
      ),
    // Fires ~every 80 ms while a recording runs; payload is the RMS loudness
    // of the latest microphone chunk (0 = silence, speech typically 0.02-0.2).
    onLevel: (handler) => listen<number>("scribedog-voice-level", (event) => handler(event.payload))
  },
  updater: {
    check: async () => {
      const update = await checkForUpdate();

      return update ? { version: update.version, downloadAndInstall: () => update.downloadAndInstall() } : null;
    },
    relaunch
  },
  knowledgeIndex: {
    call: (command, args) => invoke(command, args)
  },
  session: null,
  localModels: null,
  remoteVaults: desktopRemoteVaults
};
