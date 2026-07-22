import { describe, expect, it } from "vitest";

import type { MarkdownFileRecord } from "@/lib/fileSystem";
import {
  buildFileTree,
  getAncestorFolderPaths,
  getChildBasenamesByParent,
  getNodeMtimeMs,
  isDescendantRelativePath,
  type FileTreeFolderNode,
  type FileTreeNode
} from "@/lib/fileTree";

function record(relativePath: string, mtimeMs = 0): MarkdownFileRecord {
  return { filePath: `/vault/${relativePath}`, relativePath, mtimeMs };
}

function names(nodes: FileTreeNode[]): string[] {
  return nodes.map((node) => node.name);
}

function folder(nodes: FileTreeNode[], name: string): FileTreeFolderNode {
  const found = nodes.find((node) => node.kind === "folder" && node.name === name);

  if (!found || found.kind !== "folder") {
    throw new Error(`folder ${name} not found`);
  }

  return found;
}

describe("buildFileTree", () => {
  it("nests files into folders derived from their relative path", () => {
    const tree = buildFileTree([record("sub/deep/a.md"), record("root.md")]);

    expect(names(tree)).toEqual(["sub", "root.md"]);
    expect(names(folder(folder(tree, "sub").children, "deep").children)).toEqual(["a.md"]);
  });

  it("sorts folders before files, then by name (numeric, case-insensitive)", () => {
    const tree = buildFileTree([record("note10.md"), record("Note2.md"), record("z/inner.md")]);

    expect(names(tree)).toEqual(["z", "Note2.md", "note10.md"]);
  });

  it("includes empty folders", () => {
    const tree = buildFileTree([record("a.md")], ["empty", "empty/nested"]);

    expect(names(tree)).toEqual(["empty", "a.md"]);
    expect(names(folder(tree, "empty").children)).toEqual(["nested"]);
  });

  it("sorts by mtime descending in \"modified\" mode, mixing files and folders", () => {
    const tree = buildFileTree(
      [record("old.md", 100), record("new.md", 300), record("sub/mid.md", 200)],
      [],
      { sortMode: "modified" }
    );

    expect(names(tree)).toEqual(["new.md", "sub", "old.md"]);
  });

  it("gives a folder the newest mtime of its descendants", () => {
    const tree = buildFileTree([record("sub/a.md", 100), record("sub/deep/b.md", 900)], [], {
      sortMode: "modified"
    });

    expect(getNodeMtimeMs(folder(tree, "sub"))).toBe(900);
  });

  it("falls back to a folder's own mtime when it holds no files", () => {
    const tree = buildFileTree([], ["empty"], {
      sortMode: "modified",
      emptyFolderOwnMtimeMs: { empty: 555 }
    });

    expect(getNodeMtimeMs(folder(tree, "empty"))).toBe(555);
  });

  it("follows the manual order and appends unknown entries by name", () => {
    const tree = buildFileTree([record("a.md"), record("b.md"), record("c.md")], [], {
      sortMode: "manual",
      manualOrder: { "": ["c.md", "a.md"] }
    });

    expect(names(tree)).toEqual(["c.md", "a.md", "b.md"]);
  });
});

describe("getChildBasenamesByParent", () => {
  it("maps every folder (root as \"\") to its direct children", () => {
    const map = getChildBasenamesByParent([record("a.md"), record("sub/b.md")], ["empty"]);

    expect(map.get("")).toEqual(["empty", "sub", "a.md"]);
    expect(map.get("sub")).toEqual(["b.md"]);
    expect(map.get("empty")).toEqual([]);
  });
});

describe("isDescendantRelativePath", () => {
  it("treats the vault root as an ancestor of everything", () => {
    expect(isDescendantRelativePath("", "anything/deep")).toBe(true);
  });

  it("treats a folder as its own descendant", () => {
    expect(isDescendantRelativePath("sub", "sub")).toBe(true);
  });

  it("accepts nested paths but rejects shared name prefixes", () => {
    expect(isDescendantRelativePath("sub", "sub/deep")).toBe(true);
    expect(isDescendantRelativePath("sub", "sub-backup")).toBe(false);
  });
});

describe("getAncestorFolderPaths", () => {
  it("lists every ancestor folder, excluding the entry itself", () => {
    expect(getAncestorFolderPaths("a/b/c.md")).toEqual(["a", "a/b"]);
  });

  it("returns nothing for a root-level entry", () => {
    expect(getAncestorFolderPaths("c.md")).toEqual([]);
  });
});
