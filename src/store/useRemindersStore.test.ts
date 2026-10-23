import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/platform/vaultFs", () => ({ readTextFile: vi.fn() }));

import { listAllReminders, listVaultReminders, useRemindersStore } from "./useRemindersStore";

const A = "<!-- reminder: 2026-10-25 09:00 -->";

beforeEach(() => {
  useRemindersStore.setState({
    folderPath: null,
    byFile: {},
    sources: {},
    otherVaults: {},
    revealRequest: null,
    popoverOpen: false
  });
});

describe("useRemindersStore.syncIndex", () => {
  it("reads notes from disk and open notes from memory", async () => {
    const read = vi.fn(async (filePath: string) => (filePath === "/v/a.md" ? `Disk ${A}\n` : "nothing\n"));

    await useRemindersStore.getState().syncIndex(
      {
        folderPath: "/v",
        filePaths: ["/v/a.md", "/v/b.md", "/v/c.md"],
        fileMtimeMs: { "/v/a.md": 1, "/v/b.md": 1, "/v/c.md": 1 },
        documents: { "/v/c.md": `Unsaved ${A}\n` }
      },
      read
    );

    expect(read).toHaveBeenCalledTimes(2);
    expect(listVaultReminders(useRemindersStore.getState().byFile, "/v").map((item) => [item.filePath, item.text])).toEqual([
      ["/v/a.md", "Disk"],
      ["/v/c.md", "Unsaved"]
    ]);
  });

  it("reads a file again only when its mtime changed", async () => {
    const read = vi.fn(async () => `Text ${A}\n`);
    const input = { folderPath: "/v", filePaths: ["/v/a.md"], fileMtimeMs: { "/v/a.md": 1 }, documents: {} };

    await useRemindersStore.getState().syncIndex(input, read);
    await useRemindersStore.getState().syncIndex(input, read);

    expect(read).toHaveBeenCalledTimes(1);

    read.mockResolvedValueOnce("gone\n");
    await useRemindersStore.getState().syncIndex({ ...input, fileMtimeMs: { "/v/a.md": 2 } }, read);

    expect(read).toHaveBeenCalledTimes(2);
    expect(useRemindersStore.getState().byFile).toEqual({});
  });

  it("drops notes that left the vault and starts over for another vault", async () => {
    const read = vi.fn(async () => `Text ${A}\n`);

    await useRemindersStore.getState().syncIndex(
      { folderPath: "/v", filePaths: ["/v/a.md", "/v/b.md"], fileMtimeMs: {}, documents: {} },
      read
    );
    await useRemindersStore.getState().syncIndex({ folderPath: "/v", filePaths: ["/v/a.md"], fileMtimeMs: {}, documents: {} }, read);

    expect(Object.keys(useRemindersStore.getState().byFile)).toEqual(["/v/a.md"]);

    await useRemindersStore.getState().syncIndex({ folderPath: "/w", filePaths: ["/w/a.md"], fileMtimeMs: {}, documents: {} }, read);

    expect(Object.keys(useRemindersStore.getState().byFile)).toEqual(["/w/a.md"]);
  });
});

describe("reminders across vaults", () => {
  const storageOf = (files: Record<string, { mtimeMs: number; content: string }>) => ({
    listMarkdownFiles: vi.fn(async (root: string) =>
      Object.entries(files).map(([filePath, { mtimeMs }]) => ({
        filePath,
        relativePath: filePath.slice(root.length + 1),
        mtimeMs
      }))
    ),
    readTextFile: vi.fn(async (filePath: string) => files[filePath].content)
  });

  it("lists the open vault and the scanned ones together, each with its root", async () => {
    await useRemindersStore.getState().syncIndex(
      { folderPath: "/v", filePaths: ["/v/a.md"], fileMtimeMs: {}, documents: { "/v/a.md": `Here ${A}\n` } },
      vi.fn()
    );
    await useRemindersStore.getState().scanVault("/w", storageOf({ "/w/b.md": { mtimeMs: 1, content: `There ${A}\n` } }));

    expect(listAllReminders(useRemindersStore.getState()).map((item) => [item.vaultRoot, item.filePath, item.text])).toEqual([
      ["/v", "/v/a.md", "Here"],
      ["/w", "/w/b.md", "There"]
    ]);
  });

  it("reads a scanned vault again only where an mtime changed", async () => {
    const files = {
      "/w/a.md": { mtimeMs: 1, content: `One ${A}\n` },
      "/w/b.md": { mtimeMs: 1, content: "nothing\n" }
    };
    const storage = storageOf(files);

    await useRemindersStore.getState().scanVault("/w", storage);
    await useRemindersStore.getState().scanVault("/w", storage);

    expect(storage.readTextFile).toHaveBeenCalledTimes(2);

    files["/w/b.md"] = { mtimeMs: 2, content: `Two ${A}\n` };
    await useRemindersStore.getState().scanVault("/w", storage);

    expect(storage.readTextFile).toHaveBeenCalledTimes(3);
    expect(Object.keys(useRemindersStore.getState().otherVaults["/w"].byFile).sort()).toEqual(["/w/a.md", "/w/b.md"]);
  });

  it("keeps what was known when a vault cannot be listed", async () => {
    await useRemindersStore.getState().scanVault("/w", storageOf({ "/w/a.md": { mtimeMs: 1, content: `One ${A}\n` } }));

    const away = { listMarkdownFiles: vi.fn(async () => Promise.reject(new Error("away"))), readTextFile: vi.fn() };
    await expect(useRemindersStore.getState().scanVault("/w", away)).rejects.toThrow("away");

    expect(Object.keys(useRemindersStore.getState().otherVaults["/w"].byFile)).toEqual(["/w/a.md"]);
  });

  it("keeps a closed vault in the list and does not read it again when it reopens", async () => {
    const read = vi.fn(async () => `Text ${A}\n`);

    await useRemindersStore.getState().syncIndex(
      { folderPath: "/v", filePaths: ["/v/a.md"], fileMtimeMs: { "/v/a.md": 1 }, documents: {} },
      read
    );
    await useRemindersStore.getState().syncIndex({ folderPath: "/w", filePaths: [], fileMtimeMs: {}, documents: {} }, read);

    expect(listAllReminders(useRemindersStore.getState()).map((item) => item.vaultRoot)).toEqual(["/v"]);

    await useRemindersStore.getState().syncIndex(
      { folderPath: "/v", filePaths: ["/v/a.md"], fileMtimeMs: { "/v/a.md": 1 }, documents: {} },
      read
    );

    expect(read).toHaveBeenCalledTimes(1);
    expect(useRemindersStore.getState().otherVaults["/v"]).toBeUndefined();
    expect(Object.keys(useRemindersStore.getState().byFile)).toEqual(["/v/a.md"]);
  });

  it("forgets the vaults that left the vault menu", async () => {
    await useRemindersStore.getState().scanVault("/w", storageOf({ "/w/a.md": { mtimeMs: 1, content: `One ${A}\n` } }));
    await useRemindersStore.getState().scanVault("/x", storageOf({ "/x/a.md": { mtimeMs: 1, content: `One ${A}\n` } }));

    useRemindersStore.getState().retainVaults(["/x"]);

    expect(Object.keys(useRemindersStore.getState().otherVaults)).toEqual(["/x"]);
  });
});
