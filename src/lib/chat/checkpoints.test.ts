import { describe, expect, it, vi } from "vitest";

// The module talks to the filesystem through Tauri, which has no implementation
// outside the app shell. Only the two pure functions below are under test —
// they are where the reasoning lives, and where a naive implementation is wrong.
vi.mock("@tauri-apps/api/path", () => ({ join: async (...parts: string[]) => parts.join("/") }));
vi.mock("@tauri-apps/plugin-fs", () => ({
  exists: async () => false,
  mkdir: async () => undefined,
  readTextFile: async () => "",
  remove: async () => undefined,
  writeTextFile: async () => undefined
}));

const { checkpointsToRevert, resolveRevertTargets } = await import("./checkpoints");

import type { Checkpoint } from "./checkpoints";

function checkpoint(id: string, createdAt: number, entries: [string, string | null][]): Checkpoint {
  return {
    id,
    sessionId: "s1",
    messageIndex: 0,
    createdAt,
    label: id,
    entries: entries.map(([path, blobId]) => ({ path, blobId }))
  };
}

// Oldest first, the way listCheckpoints hands them over.
const HISTORY: Checkpoint[] = [
  checkpoint("cp1", 1, [
    ["Notiz.md", "blob-notiz-v0"],
    ["Neu.md", null]
  ]),
  checkpoint("cp2", 2, [["Anders.md", "blob-anders-v0"]]),
  checkpoint("cp3", 3, [["Notiz.md", "blob-notiz-v1"]])
];

describe("checkpointsToRevert", () => {
  it("returns everything from the newest down to the target, newest first", () => {
    expect(checkpointsToRevert(HISTORY, "cp1").map((entry) => entry.id)).toEqual(["cp3", "cp2", "cp1"]);
    expect(checkpointsToRevert(HISTORY, "cp2").map((entry) => entry.id)).toEqual(["cp3", "cp2"]);
    expect(checkpointsToRevert(HISTORY, "cp3").map((entry) => entry.id)).toEqual(["cp3"]);
  });

  it("returns nothing for a checkpoint that is gone", () => {
    expect(checkpointsToRevert(HISTORY, "cp-missing")).toEqual([]);
  });
});

describe("resolveRevertTargets", () => {
  // The failure a naive implementation produces: applying only the target
  // checkpoint leaves every file a *later* batch touched sitting on its newest
  // state, because that file does not appear in the target checkpoint at all.
  it("takes the oldest saved state per path across all undone checkpoints", () => {
    const targets = resolveRevertTargets(checkpointsToRevert(HISTORY, "cp1"));

    expect(targets).toEqual(
      expect.arrayContaining([
        { path: "Notiz.md", blobId: "blob-notiz-v0" },
        { path: "Anders.md", blobId: "blob-anders-v0" },
        { path: "Neu.md", blobId: null }
      ])
    );
    expect(targets).toHaveLength(3);
  });

  it("keeps a file that only a later batch touched", () => {
    const targets = resolveRevertTargets(checkpointsToRevert(HISTORY, "cp2"));

    expect(targets).toEqual(
      expect.arrayContaining([
        { path: "Notiz.md", blobId: "blob-notiz-v1" },
        { path: "Anders.md", blobId: "blob-anders-v0" }
      ])
    );
    expect(targets).toHaveLength(2);
  });

  // A file that did not exist before the batch is restored by deleting it
  // again, which is what a null blobId stands for.
  it("preserves the null blob that means 'did not exist'", () => {
    const targets = resolveRevertTargets(checkpointsToRevert(HISTORY, "cp1"));

    expect(targets.find((entry) => entry.path === "Neu.md")?.blobId).toBeNull();
  });

  it("matches paths case-insensitively, the way Windows does", () => {
    const targets = resolveRevertTargets([
      checkpoint("cpB", 2, [["notiz.md", "neu"]]),
      checkpoint("cpA", 1, [["Notiz.md", "alt"]])
    ]);

    expect(targets).toEqual([{ path: "Notiz.md", blobId: "alt" }]);
  });
});
