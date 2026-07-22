import { describe, expect, it } from "vitest";

import {
  appendManualOrderEntry,
  rekeyManualOrderFolderPrefix,
  removeManualOrderEntry,
  removeManualOrderFolderPrefix,
  renameManualOrderEntry
} from "./manualOrder";
import { buildFileMtimeMap } from "./folderState";
import {
  getBasename,
  insertFilePathSorted,
  isPathInsideFolder,
  normalizePathKey
} from "./pathUtils";

describe("normalizePathKey", () => {
  it("normalizes separators and casing", () => {
    expect(normalizePathKey("C:\\Vault\\Sub\\Note.md")).toBe("c:/vault/sub/note.md");
  });
});

describe("insertFilePathSorted", () => {
  it("inserts numerically and case-insensitively", () => {
    expect(insertFilePathSorted(["/v/a.md", "/v/c.md"], "/v/B.md")).toEqual([
      "/v/a.md",
      "/v/B.md",
      "/v/c.md"
    ]);
  });

  it("sorts note2 before note10", () => {
    expect(insertFilePathSorted(["/v/note2.md", "/v/note10.md"], "/v/note1.md")).toEqual([
      "/v/note1.md",
      "/v/note2.md",
      "/v/note10.md"
    ]);
  });

  it("does not mutate the input array", () => {
    const paths = ["/v/a.md"];
    insertFilePathSorted(paths, "/v/b.md");
    expect(paths).toEqual(["/v/a.md"]);
  });
});

describe("isPathInsideFolder", () => {
  it("accepts descendants regardless of separator or casing", () => {
    expect(isPathInsideFolder("C:\\Vault\\sub\\note.md", "c:/vault")).toBe(true);
  });

  it("rejects the folder itself", () => {
    expect(isPathInsideFolder("/vault", "/vault")).toBe(false);
  });

  it("rejects a sibling with a shared name prefix", () => {
    expect(isPathInsideFolder("/vault-backup/note.md", "/vault")).toBe(false);
  });
});

describe("getBasename", () => {
  it("handles both separators", () => {
    expect(getBasename("C:\\Vault\\note.md")).toBe("note.md");
    expect(getBasename("/vault/note.md")).toBe("note.md");
  });

  it("returns the input when there is no separator", () => {
    expect(getBasename("note.md")).toBe("note.md");
  });
});

describe("buildFileMtimeMap", () => {
  it("maps file paths to their mtime", () => {
    expect(
      buildFileMtimeMap([
        { filePath: "/v/a.md", relativePath: "a.md", mtimeMs: 10 },
        { filePath: "/v/b.md", relativePath: "b.md", mtimeMs: 20 }
      ])
    ).toEqual({ "/v/a.md": 10, "/v/b.md": 20 });
  });
});

describe("manual order entry helpers", () => {
  const manualOrder = { "": ["a.md", "b.md"], sub: ["c.md"] };

  it("appends to an existing parent", () => {
    expect(appendManualOrderEntry(manualOrder, "", "z.md")[""]).toEqual(["a.md", "b.md", "z.md"]);
  });

  it("returns the same map for an untracked parent", () => {
    expect(appendManualOrderEntry(manualOrder, "other", "z.md")).toBe(manualOrder);
    expect(removeManualOrderEntry(manualOrder, "other", "z.md")).toBe(manualOrder);
    expect(renameManualOrderEntry(manualOrder, "other", "a.md", "z.md")).toBe(manualOrder);
  });

  it("removes an entry", () => {
    expect(removeManualOrderEntry(manualOrder, "", "a.md")[""]).toEqual(["b.md"]);
  });

  it("renames an entry in place", () => {
    expect(renameManualOrderEntry(manualOrder, "", "a.md", "z.md")[""]).toEqual(["z.md", "b.md"]);
  });

  it("does not mutate the input map", () => {
    appendManualOrderEntry(manualOrder, "", "z.md");
    removeManualOrderEntry(manualOrder, "", "a.md");
    expect(manualOrder[""]).toEqual(["a.md", "b.md"]);
  });
});

describe("rekeyManualOrderFolderPrefix", () => {
  it("rekeys the folder and all its descendants", () => {
    expect(
      rekeyManualOrderFolderPrefix(
        { "": ["x"], old: ["a"], "old/deep": ["b"], other: ["c"] },
        "old",
        "new"
      )
    ).toEqual({ "": ["x"], new: ["a"], "new/deep": ["b"], other: ["c"] });
  });

  it("returns the same map when nothing matches", () => {
    const input = { "": ["x"] };
    expect(rekeyManualOrderFolderPrefix(input, "old", "new")).toBe(input);
  });

  it("does not rekey a sibling with a shared name prefix", () => {
    expect(rekeyManualOrderFolderPrefix({ "old-backup": ["a"] }, "old", "new")).toEqual({
      "old-backup": ["a"]
    });
  });
});

describe("removeManualOrderFolderPrefix", () => {
  it("drops the folder and its descendants but keeps siblings", () => {
    expect(
      removeManualOrderFolderPrefix(
        { "": ["x"], old: ["a"], "old/deep": ["b"], "old-backup": ["c"] },
        "old"
      )
    ).toEqual({ "": ["x"], "old-backup": ["c"] });
  });
});
