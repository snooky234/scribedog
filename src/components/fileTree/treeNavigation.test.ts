import { describe, expect, it } from "vitest";

import {
  buildNodeContextMap,
  computeRangeKeys,
  flattenVisibleNodes,
  formatModifiedLabel,
  getNodeKey,
  getTopLevelSelection
} from "@/components/fileTree/treeNavigation";
import type { FileTreeNode } from "@/lib/fileTree";

function file(relativePath: string): FileTreeNode {
  const name = relativePath.split("/").pop() ?? relativePath;
  return { kind: "file", name, filePath: `/vault/${relativePath}`, relativePath, mtimeMs: 0 };
}

function dir(relativePath: string, children: FileTreeNode[]): FileTreeNode {
  const name = relativePath.split("/").pop() ?? relativePath;
  return { kind: "folder", name, relativePath, children, effectiveMtimeMs: 0 };
}

// root.md
// sub/          (expandable)
//   inner.md
//   deep/       (expandable)
//     leaf.md
const tree: FileTreeNode[] = [
  dir("sub", [file("sub/inner.md"), dir("sub/deep", [file("sub/deep/leaf.md")])]),
  file("root.md")
];

describe("getNodeKey", () => {
  it("namespaces the key by kind so a file and a folder never collide", () => {
    expect(getNodeKey(file("a"))).toBe("file:a");
    expect(getNodeKey(dir("a", []))).toBe("folder:a");
  });
});

describe("flattenVisibleNodes", () => {
  it("skips the children of collapsed folders", () => {
    expect(flattenVisibleNodes(tree, new Set()).map(getNodeKey)).toEqual([
      "folder:sub",
      "file:root.md"
    ]);
  });

  it("descends into expanded folders in render order", () => {
    expect(flattenVisibleNodes(tree, new Set(["sub"])).map(getNodeKey)).toEqual([
      "folder:sub",
      "file:sub/inner.md",
      "folder:sub/deep",
      "file:root.md"
    ]);
  });

  it("descends recursively when a nested folder is expanded too", () => {
    expect(flattenVisibleNodes(tree, new Set(["sub", "sub/deep"])).map(getNodeKey)).toEqual([
      "folder:sub",
      "file:sub/inner.md",
      "folder:sub/deep",
      "file:sub/deep/leaf.md",
      "file:root.md"
    ]);
  });
});

describe("computeRangeKeys", () => {
  const flat = flattenVisibleNodes(tree, new Set(["sub"]));

  it("selects everything between anchor and target, in either direction", () => {
    const forward = computeRangeKeys(flat, "folder:sub", "folder:sub/deep");
    const backward = computeRangeKeys(flat, "folder:sub/deep", "folder:sub");

    expect([...forward].sort()).toEqual([...backward].sort());
    expect(forward).toEqual(new Set(["folder:sub", "file:sub/inner.md", "folder:sub/deep"]));
  });

  it("selects from the top when there is no anchor", () => {
    expect(computeRangeKeys(flat, null, "file:sub/inner.md")).toEqual(
      new Set(["folder:sub", "file:sub/inner.md"])
    );
  });

  it("falls back to the target alone when it is not visible", () => {
    expect(computeRangeKeys(flat, "folder:sub", "file:gone.md")).toEqual(new Set(["file:gone.md"]));
  });
});

describe("getTopLevelSelection", () => {
  const flat = flattenVisibleNodes(tree, new Set(["sub", "sub/deep"]));

  it("drops entries whose ancestor folder is selected too", () => {
    const result = getTopLevelSelection(
      ["folder:sub", "file:sub/inner.md", "folder:sub/deep", "file:root.md"],
      flat
    );

    expect(result.map(getNodeKey)).toEqual(["folder:sub", "file:root.md"]);
  });

  it("keeps independent entries", () => {
    expect(getTopLevelSelection(["file:sub/inner.md", "file:root.md"], flat).map(getNodeKey)).toEqual(
      ["file:sub/inner.md", "file:root.md"]
    );
  });

  it("ignores keys that no longer resolve to a node", () => {
    expect(getTopLevelSelection(["file:gone.md", "file:root.md"], flat).map(getNodeKey)).toEqual([
      "file:root.md"
    ]);
  });
});

describe("buildNodeContextMap", () => {
  it("records parent and sibling index for every node, regardless of expansion", () => {
    const map = buildNodeContextMap(tree);

    expect(map.get("folder:sub")).toEqual({ parentRelativePath: "", indexInSiblings: 0 });
    expect(map.get("file:root.md")).toEqual({ parentRelativePath: "", indexInSiblings: 1 });
    expect(map.get("file:sub/inner.md")).toEqual({ parentRelativePath: "sub", indexInSiblings: 0 });
    expect(map.get("file:sub/deep/leaf.md")).toEqual({
      parentRelativePath: "sub/deep",
      indexInSiblings: 0
    });
  });
});

describe("formatModifiedLabel", () => {
  it("returns an empty string for a missing timestamp", () => {
    expect(formatModifiedLabel(0, "de-DE")).toBe("");
  });

  it("shows only the time for today", () => {
    const today = new Date();
    today.setHours(14, 5, 0, 0);

    expect(formatModifiedLabel(today.getTime(), "de-DE")).toBe("14:05");
  });

  it("shows only the date for another day", () => {
    expect(formatModifiedLabel(new Date(2020, 0, 2, 14, 5).getTime(), "de-DE")).toBe("02.01.2020");
  });
});
