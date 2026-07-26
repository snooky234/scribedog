import { create } from "zustand";

import {
  clampMaxVersionsPerFile,
  MAX_VERSIONS_PER_FILE_DEFAULT,
  MAX_VERSIONS_PER_FILE_LEGACY_DEFAULT
} from "@/lib/fileVersions";
import { getLastOpenedFolderPath } from "@/lib/fileSystem";

export const VERSIONING_ENABLED_STORAGE_KEY = "scribedog-versioning-enabled";
export const VERSIONING_MAX_VERSIONS_STORAGE_KEY = "scribedog-versioning-max-versions";

function getStoredVersioningEnabled(): boolean {
  try {
    return window.localStorage.getItem(VERSIONING_ENABLED_STORAGE_KEY) === "true";
  } catch {
    return false;
  }
}

function persistVersioningEnabled(enabled: boolean): void {
  try {
    window.localStorage.setItem(VERSIONING_ENABLED_STORAGE_KEY, String(enabled));
  } catch {
    // localStorage may be unavailable in some environments.
  }
}

function getDefaultMaxVersions(): number {
  // No explicit value has ever been saved. `getLastOpenedFolderPath` is set
  // the first time any folder is opened, which every pre-existing install
  // has already done — so its presence tells a fresh install (new default)
  // apart from an existing one (keeps the historical default it was
  // implicitly using).
  return getLastOpenedFolderPath() !== null ? MAX_VERSIONS_PER_FILE_LEGACY_DEFAULT : MAX_VERSIONS_PER_FILE_DEFAULT;
}

function getStoredMaxVersions(): number {
  try {
    const raw = window.localStorage.getItem(VERSIONING_MAX_VERSIONS_STORAGE_KEY);

    if (raw === null) {
      return getDefaultMaxVersions();
    }

    const parsed = Number.parseInt(raw, 10);
    return Number.isFinite(parsed) ? clampMaxVersionsPerFile(parsed) : getDefaultMaxVersions();
  } catch {
    return MAX_VERSIONS_PER_FILE_DEFAULT;
  }
}

function persistMaxVersions(maxVersions: number): void {
  try {
    window.localStorage.setItem(VERSIONING_MAX_VERSIONS_STORAGE_KEY, String(maxVersions));
  } catch {
    // localStorage may be unavailable in some environments.
  }
}

type VersioningSettingsState = {
  /**
   * Off by default. Turning it off only stops new versions from being
   * created — existing history stays on disk and reappears when it is
   * switched back on.
   */
  versioningEnabled: boolean;
  setVersioningEnabled: (enabled: boolean) => void;
  maxVersionsPerFile: number;
  setMaxVersionsPerFile: (maxVersions: number) => void;
};

export const useVersioningSettingsStore = create<VersioningSettingsState>((set) => ({
  versioningEnabled: getStoredVersioningEnabled(),
  setVersioningEnabled: (enabled: boolean) => {
    persistVersioningEnabled(enabled);
    set({ versioningEnabled: enabled });
  },
  maxVersionsPerFile: getStoredMaxVersions(),
  setMaxVersionsPerFile: (maxVersions: number) => {
    const clamped = clampMaxVersionsPerFile(maxVersions);
    persistMaxVersions(clamped);
    set({ maxVersionsPerFile: clamped });
  }
}));
