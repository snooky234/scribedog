import { beforeEach, describe, expect, it, vi } from "vitest";

const { readReminderNotes, backgroundRemoteVaultStorage, allowFolderAccess } = vi.hoisted(() => ({
  readReminderNotes: vi.fn(),
  backgroundRemoteVaultStorage: vi.fn(),
  allowFolderAccess: vi.fn()
}));

vi.mock("@/platform", () => ({
  platform: {
    features: { localFolders: true },
    sharedVaults: { storageFor: async () => null },
    vault: { readReminderNotes: (...args: unknown[]) => readReminderNotes(...args), allowFolderAccess },
    vaultStorage: { name: "platform" }
  }
}));

vi.mock("@/lib/remoteVaults", () => ({
  isRemoteVaultPath: (path: string) => path.startsWith("/@remote/"),
  backgroundRemoteVaultStorage: (root: string) => backgroundRemoteVaultStorage(root)
}));

import { reminderVaultReader } from "./reminderVaultReader";

beforeEach(() => {
  readReminderNotes.mockReset();
  backgroundRemoteVaultStorage.mockReset();
  allowFolderAccess.mockReset();
});

describe("reminderVaultReader", () => {
  it("reads a local vault through the shell's command, never by widening the fs scope", async () => {
    readReminderNotes.mockResolvedValue([
      { filePath: "/v/a.md", relativePath: "a.md", mtimeMs: 2, content: "Do it <!-- reminder: 2026-10-25 09:00 -->" },
      { filePath: "/v/b.md", relativePath: "b.md", mtimeMs: 1, content: null }
    ]);

    const reader = await reminderVaultReader("/v");
    const records = await reader!.listMarkdownFiles("/v", { "/v/b.md": 1 });

    expect(readReminderNotes).toHaveBeenCalledWith("/v", { "/v/b.md": 1 });
    expect(allowFolderAccess).not.toHaveBeenCalled();
    expect(records).toEqual([
      { filePath: "/v/a.md", relativePath: "a.md", mtimeMs: 2 },
      { filePath: "/v/b.md", relativePath: "b.md", mtimeMs: 1 }
    ]);
    expect(await reader!.readTextFile("/v/a.md")).toContain("reminder");
    expect(await reader!.readTextFile("/v/b.md")).toBe("");
  });

  it("reads a server vault through its background storage", async () => {
    const storage = { listMarkdownFiles: vi.fn(), readTextFile: vi.fn() };
    backgroundRemoteVaultStorage.mockResolvedValue(storage);

    expect(await reminderVaultReader("/@remote/srv")).toBe(storage);
    expect(readReminderNotes).not.toHaveBeenCalled();
  });
});
