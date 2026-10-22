import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/platform/vaultFs", () => ({ readTextFile: vi.fn() }));

import { listVaultReminders, useRemindersStore } from "./useRemindersStore";

const A = "<!-- reminder: 2026-10-25 09:00 -->";

beforeEach(() => {
  useRemindersStore.setState({ folderPath: null, byFile: {}, sources: {}, revealRequest: null, popoverOpen: false });
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
    expect(listVaultReminders(useRemindersStore.getState().byFile).map((item) => [item.filePath, item.text])).toEqual([
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
