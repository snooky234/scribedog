// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from "vitest";

const { existingFolders, failingFolders } = vi.hoisted(() => ({
  existingFolders: new Set<string>(),
  failingFolders: new Set<string>()
}));

vi.mock("@/platform", () => ({
  getVaultStorage: () => null,
  platform: {
    vault: {
      folderExists: async (path: string) => {
        if (failingFolders.has(path)) {
          throw new Error("check failed");
        }

        return existingFolders.has(path);
      }
    }
  }
}));

vi.mock("@/lib/remoteVaults", () => ({
  activateVaultStorage: () => undefined,
  isRemoteVaultPath: (path: string) => path.startsWith("/@remote/"),
  remoteVaultFor: () => null,
  watchRemoteVault: async () => undefined
}));

const { getRecentFolderPaths, pruneMissingRecentFolderPaths } = await import("@/lib/fileSystem");

function setRecent(paths: string[]) {
  window.localStorage.setItem("scribedog:recentFolderPaths", JSON.stringify(paths));
}

describe("pruneMissingRecentFolderPaths", () => {
  beforeEach(() => {
    window.localStorage.clear();
    existingFolders.clear();
    failingFolders.clear();
  });

  it("drops a local vault whose folder is gone and keeps the order of the rest", async () => {
    setRecent(["C:/Vaults/A", "C:/Vaults/Gone", "C:/Vaults/B"]);
    existingFolders.add("C:/Vaults/A").add("C:/Vaults/B");

    expect(await pruneMissingRecentFolderPaths()).toEqual(["C:/Vaults/Gone"]);
    expect(getRecentFolderPaths()).toEqual(["C:/Vaults/A", "C:/Vaults/B"]);
  });

  it("leaves server vaults alone", async () => {
    setRecent(["/@remote/example.org/", "C:/Vaults/A"]);
    existingFolders.add("C:/Vaults/A");

    expect(await pruneMissingRecentFolderPaths()).toEqual([]);
    expect(getRecentFolderPaths()).toEqual(["/@remote/example.org/", "C:/Vaults/A"]);
  });

  it("keeps an entry whose check failed", async () => {
    setRecent(["C:/Vaults/A"]);
    failingFolders.add("C:/Vaults/A");

    expect(await pruneMissingRecentFolderPaths()).toEqual([]);
    expect(getRecentFolderPaths()).toEqual(["C:/Vaults/A"]);
  });
});
