// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";

// The recent list is a thin layer over localStorage, but fileSystem.ts pulls
// in the platform, the remote vaults and i18n; none of that is needed here.
vi.mock("@/i18n", () => ({ default: { t: (key: string) => key } }));
vi.mock("@/platform", () => ({
  platform: { features: { remoteVaults: true }, vault: {}, paths: {} },
  getVaultStorage: () => ({})
}));
vi.mock("@/lib/remoteVaults", () => ({
  activateVaultStorage: vi.fn(),
  isRemoteVaultPath: (path: string) => path.startsWith("/@remote/"),
  remoteVaultFor: () => null,
  watchRemoteVault: vi.fn()
}));
vi.mock("@/store/useSharedVaultsStore", () => ({ sharedVaultNameFor: () => null }));

const {
  addRecentFolderPath,
  getRecentFolderPaths,
  getRecentFolderPathsSnapshot,
  removeRecentFolderPath,
  subscribeToRecentFolderPaths
} = await import("./fileSystem");

const NOTES = "C:\\Notes";
const NOTES_OTHER_CASE = "c:\\notes";
const WORK = "D:\\Work";

describe("the recent folder list and its subscribers", () => {
  beforeEach(() => {
    window.localStorage.clear();
    // Drop whatever a previous test left in the cached snapshot.
    addRecentFolderPath("C:\\seed");
    removeRecentFolderPath("C:\\seed");
  });

  it("keeps the newest first and drops a duplicate that differs only in case", () => {
    addRecentFolderPath(NOTES);
    addRecentFolderPath(WORK);
    addRecentFolderPath(NOTES_OTHER_CASE);

    expect(getRecentFolderPaths()).toEqual([NOTES_OTHER_CASE, WORK]);
  });

  // Closing a folder in the manage dialog has to reach the vault menu at
  // once: both render from this list, and localStorage is not observable.
  it("tells its subscribers when the list changes", () => {
    addRecentFolderPath(NOTES);

    let notified = 0;
    const unsubscribe = subscribeToRecentFolderPaths(() => {
      notified += 1;
    });

    removeRecentFolderPath(NOTES);

    expect(notified).toBe(1);
    expect(getRecentFolderPaths()).toEqual([]);

    unsubscribe();
    addRecentFolderPath(WORK);
    expect(notified).toBe(1);
  });

  it("hands out the same array until something changes", () => {
    addRecentFolderPath(NOTES);

    const before = getRecentFolderPathsSnapshot();

    // A fresh array on every read would loop useSyncExternalStore forever.
    expect(getRecentFolderPathsSnapshot()).toBe(before);

    addRecentFolderPath(WORK);

    const after = getRecentFolderPathsSnapshot();
    expect(after).not.toBe(before);
    expect(after).toEqual([WORK, NOTES]);
  });
});
