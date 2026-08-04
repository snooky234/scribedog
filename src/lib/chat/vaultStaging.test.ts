import { describe, expect, it } from "vitest";

import {
  affectedPaths,
  assertVaultPath,
  findStagedChange,
  mergeStagedChange,
  normalizeVaultPath,
  removeStagedChange,
  resolveApplyOrder,
  stagedChangeKind,
  upsertStagedChange,
  VaultPathError,
  type StagedChange
} from "./vaultStaging";

function change(partial: Partial<StagedChange>): StagedChange {
  return {
    path: "",
    targetPath: "",
    baseContent: null,
    content: null,
    sessionId: "s1",
    messageIndex: 0,
    ...partial
  };
}

describe("assertVaultPath", () => {
  it("normalizes separators and leading ./", () => {
    expect(assertVaultPath("Projekte\\Kunde A.md")).toBe("Projekte/Kunde A.md");
    expect(assertVaultPath("./Idee.md")).toBe("Idee.md");
  });

  // The whole point of this function: every one of these paths could arrive
  // straight out of model output.
  it.each([
    ["../../etc/passwd.md", "parent traversal"],
    ["Notizen/../../secret.md", "traversal in the middle"],
    ["/etc/hosts.md", "absolute posix path"],
    ["C:\\Windows\\System32\\drivers\\etc\\hosts.md", "windows drive"],
    ["\\\\server\\share\\note.md", "UNC path"],
    [".scribedog/chat-sessions.json", "vault metadata"],
    [".scribedog/versions/abc.md", "version history"],
    ["images/photo.md", "image folder"],
    ["notes.txt", "not markdown"],
    ["", "empty"]
  ])("rejects %s (%s)", (path) => {
    expect(() => assertVaultPath(path)).toThrow(VaultPathError);
  });

  it("is case-insensitive about the forbidden folders", () => {
    expect(() => assertVaultPath(".SCRIBEDOG/index.md")).toThrow(VaultPathError);
    expect(() => assertVaultPath("Images/a.md")).toThrow(VaultPathError);
  });

  it("allows a folder path without the .md requirement", () => {
    expect(assertVaultPath("Projekte/2026", { requireMarkdown: false })).toBe("Projekte/2026");
  });

  it("rejects a non-string argument", () => {
    expect(() => assertVaultPath(undefined)).toThrow(VaultPathError);
    expect(() => assertVaultPath(42)).toThrow(VaultPathError);
  });
});

describe("stagedChangeKind", () => {
  it("derives every case from the four fields", () => {
    expect(stagedChangeKind(change({ targetPath: "Neu.md", content: "x" }))).toBe("create");
    expect(
      stagedChangeKind(change({ path: "A.md", targetPath: "A.md", baseContent: "a", content: "b" }))
    ).toBe("edit");
    expect(
      stagedChangeKind(change({ path: "A.md", targetPath: "B.md", baseContent: "a", content: "a" }))
    ).toBe("rename");
    expect(
      stagedChangeKind(change({ path: "A.md", targetPath: "B.md", baseContent: "a", content: "b" }))
    ).toBe("rename-edit");
    expect(stagedChangeKind(change({ path: "A.md", baseContent: "a" }))).toBe("delete");
    expect(
      stagedChangeKind(change({ path: "A.md", targetPath: "A.md", editorProposal: true }))
    ).toBe("editor");
  });
});

describe("findStagedChange", () => {
  const staged = [change({ path: "Alt.md", targetPath: "Neu.md", baseContent: "a", content: "a" })];

  // A model that renamed a file then refers to it by its new name must reach
  // the same entry — otherwise one file ends up with two contradicting entries.
  it("matches on either side of a rename", () => {
    expect(findStagedChange(staged, "Alt.md")).toBe(staged[0]);
    expect(findStagedChange(staged, "Neu.md")).toBe(staged[0]);
    expect(findStagedChange(staged, "neu.MD")).toBe(staged[0]);
    expect(findStagedChange(staged, "Anderes.md")).toBeUndefined();
  });
});

describe("mergeStagedChange / upsertStagedChange", () => {
  it("keeps the original before-state and takes the new after-state", () => {
    const first = change({ path: "A.md", targetPath: "A.md", baseContent: "one", content: "two" });
    const second = change({ path: "A.md", targetPath: "A.md", baseContent: "two", content: "three" });

    expect(mergeStagedChange(first, second)).toMatchObject({
      path: "A.md",
      targetPath: "A.md",
      baseContent: "one",
      content: "three"
    });
  });

  it("folds a rename after an edit into one entry that does both", () => {
    const edited = change({ path: "A.md", targetPath: "A.md", baseContent: "one", content: "two" });
    const renamed = change({ path: "A.md", targetPath: "B.md", baseContent: "one", content: "two" });
    const merged = upsertStagedChange([edited], renamed);

    expect(merged).toHaveLength(1);
    expect(stagedChangeKind(merged[0])).toBe("rename-edit");
    expect(merged[0]).toMatchObject({ path: "A.md", targetPath: "B.md", baseContent: "one", content: "two" });
  });

  it("never produces two entries for one file", () => {
    let changes: StagedChange[] = [];

    changes = upsertStagedChange(changes, change({ targetPath: "Neu.md", content: "a" }));
    changes = upsertStagedChange(changes, change({ targetPath: "Neu.md", content: "b" }));

    expect(changes).toHaveLength(1);
    expect(changes[0].content).toBe("b");
  });

  // A file the agent created and then deleted again in the same turn leaves
  // nothing behind to propose.
  it("drops an entry that creates and then deletes the same file", () => {
    const created = upsertStagedChange([], change({ targetPath: "Neu.md", content: "a" }));
    const deleted = upsertStagedChange(created, change({ path: "", targetPath: "", content: null }));

    expect(deleted).toHaveLength(0);
  });

  it("removes by either side of a rename", () => {
    const staged = [change({ path: "Alt.md", targetPath: "Neu.md", baseContent: "a", content: "a" })];

    expect(removeStagedChange(staged, "Neu.md")).toHaveLength(0);
    expect(removeStagedChange(staged, "Unbekannt.md")).toHaveLength(1);
  });
});

describe("resolveApplyOrder", () => {
  it("writes contents, then renames, then deletes", () => {
    const ops = resolveApplyOrder([
      change({ path: "Weg.md", targetPath: "", baseContent: "x", content: null }),
      change({ path: "Alt.md", targetPath: "Neu.md", baseContent: "a", content: "a" }),
      change({ path: "A.md", targetPath: "A.md", baseContent: "a", content: "b" }),
      change({ targetPath: "Frisch.md", content: "hello" })
    ]);

    expect(ops.map((op) => op.kind)).toEqual(["write", "create", "rename", "delete"]);
  });

  // The write has to land on the OLD path so moveFileVersionHistory carries the
  // history along with the file it belongs to.
  it("writes an edited-and-renamed file under its old path before moving it", () => {
    const ops = resolveApplyOrder([
      change({ path: "Alt.md", targetPath: "Neu.md", baseContent: "a", content: "b" })
    ]);

    expect(ops).toEqual([
      { kind: "write", path: "Alt.md", content: "b" },
      { kind: "rename", path: "Alt.md", targetPath: "Neu.md" }
    ]);
  });

  it("skips a rename-only entry's write", () => {
    const ops = resolveApplyOrder([
      change({ path: "Alt.md", targetPath: "Neu.md", baseContent: "a", content: "a" })
    ]);

    expect(ops).toEqual([{ kind: "rename", path: "Alt.md", targetPath: "Neu.md" }]);
  });

  it("ignores the editor marker — those proposals are settled by the editor", () => {
    expect(
      resolveApplyOrder([change({ path: "Offen.md", targetPath: "Offen.md", editorProposal: true })])
    ).toEqual([]);
  });
});

describe("affectedPaths", () => {
  // A checkpoint has to cover both sides of a rename: the file exists under one
  // name before and the other after, and undoing needs both.
  it("covers both sides of a rename, without duplicates", () => {
    expect(
      affectedPaths([
        change({ path: "Alt.md", targetPath: "Neu.md", baseContent: "a", content: "a" }),
        change({ path: "A.md", targetPath: "A.md", baseContent: "a", content: "b" })
      ])
    ).toEqual(["Alt.md", "Neu.md", "A.md"]);
  });
});

describe("normalizeVaultPath", () => {
  it("strips leading and trailing slashes and normalizes separators", () => {
    expect(normalizeVaultPath("\\Ordner\\Datei.md")).toBe("Ordner/Datei.md");
    expect(normalizeVaultPath("Ordner/")).toBe("Ordner");
  });
});
