import { create } from "zustand";

import {
  clampMaxVersionsPerFile,
  MAX_VERSIONS_PER_FILE_DEFAULT
} from "@/lib/fileVersions";

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

function getStoredMaxVersions(): number {
  try {
    const raw = window.localStorage.getItem(VERSIONING_MAX_VERSIONS_STORAGE_KEY);
    const parsed = raw === null ? Number.NaN : Number.parseInt(raw, 10);
    return Number.isFinite(parsed) ? clampMaxVersionsPerFile(parsed) : MAX_VERSIONS_PER_FILE_DEFAULT;
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
