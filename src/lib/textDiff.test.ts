import { describe, expect, it } from "vitest";

import {
  buildDiffHunks,
  countDiffStats,
  diffLines,
  hasChanges,
  toSideBySideRows
} from "./textDiff";

function render(oldText: string, newText: string): string[] {
  return diffLines(oldText, newText).map((op) =>
    `${op.type === "add" ? "+" : op.type === "remove" ? "-" : " "}${op.text}`
  );
}

describe("diffLines", () => {
  it("reports no changes for identical text", () => {
    const ops = diffLines("a\nb\nc", "a\nb\nc");

    expect(hasChanges(ops)).toBe(false);
    expect(ops.map((op) => op.text)).toEqual(["a", "b", "c"]);
  });

  it("detects a changed line in the middle", () => {
    expect(render("a\nb\nc", "a\nB\nc")).toEqual([" a", "-b", "+B", " c"]);
  });

  it("detects a pure insertion", () => {
    expect(render("a\nc", "a\nb\nc")).toEqual([" a", "+b", " c"]);
  });

  it("detects a pure deletion", () => {
    expect(render("a\nb\nc", "a\nc")).toEqual([" a", "-b", " c"]);
  });

  it("handles an empty old document", () => {
    expect(render("", "a\nb")).toEqual(["+a", "+b"]);
  });

  it("handles an emptied document", () => {
    expect(render("a\nb", "")).toEqual(["-a", "-b"]);
  });

  it("keeps line numbers aligned across an insertion", () => {
    const ops = diffLines("a\nc", "a\nb\nc");

    expect(ops.map((op) => [op.type, op.oldIndex, op.newIndex])).toEqual([
      ["equal", 0, 0],
      ["add", null, 1],
      ["equal", 1, 2]
    ]);
  });

  it("normalizes CRLF so line endings alone are not a change", () => {
    expect(hasChanges(diffLines("a\r\nb", "a\nb"))).toBe(false);
  });

  it("counts additions and removals", () => {
    expect(countDiffStats(diffLines("a\nb\nc", "a\nB\nC\nd"))).toEqual({ added: 3, removed: 2 });
  });
});

describe("buildDiffHunks", () => {
  it("returns nothing when there is no change", () => {
    expect(buildDiffHunks(diffLines("a\nb", "a\nb"))).toEqual([]);
  });

  it("collapses unchanged lines far away from a change", () => {
    const oldText = Array.from({ length: 20 }, (_, index) => `line ${index}`).join("\n");
    const newText = oldText.replace("line 10", "changed");
    const hunks = buildDiffHunks(diffLines(oldText, newText), 2);

    expect(hunks).toHaveLength(1);
    // 2 lines of context on each side plus the removed and the added line.
    expect(hunks[0].ops).toHaveLength(6);
    expect(hunks[0].skippedLines).toBe(8);
  });

  it("splits distant changes into separate hunks", () => {
    const oldText = Array.from({ length: 30 }, (_, index) => `line ${index}`).join("\n");
    const newText = oldText.replace("line 2", "changed a").replace("line 25", "changed b");
    const hunks = buildDiffHunks(diffLines(oldText, newText), 2);

    expect(hunks).toHaveLength(2);
    expect(hunks[1].skippedLines).toBeGreaterThan(0);
  });
});

describe("toSideBySideRows", () => {
  it("pairs a removed line with the added line replacing it", () => {
    const rows = toSideBySideRows(diffLines("a\nb\nc", "a\nB\nc"));

    expect(rows.map((row) => row.type)).toEqual(["equal", "replace", "equal"]);
    expect(rows[1].left?.text).toBe("b");
    expect(rows[1].right?.text).toBe("B");
  });

  it("leaves the opposite side empty for a pure insertion", () => {
    const rows = toSideBySideRows(diffLines("a\nc", "a\nb\nc"));

    expect(rows[1].type).toBe("add");
    expect(rows[1].left).toBeNull();
    expect(rows[1].right?.text).toBe("b");
  });

  it("keeps surplus removals on their own row when fewer lines were added", () => {
    const rows = toSideBySideRows(diffLines("a\nb\nc\nd", "a\nX\nd"));

    expect(rows.map((row) => row.type)).toEqual(["equal", "replace", "remove", "equal"]);
    expect(rows[2].right).toBeNull();
  });
});
