import { describe, expect, it } from "vitest";

import { locateNodeLines, pageLineMarks } from "@/lib/editor/pageLineMapping";

describe("locateNodeLines", () => {
  it("finds every node's lines in the whole document, in order", () => {
    const whole = "# Title\n\nSame\n\nSame\n\n- a\n- b";

    expect(locateNodeLines(whole, ["# Title", "Same", "Same", "- a\n- b"])).toEqual([
      { startLine: 0, endLine: 1 },
      { startLine: 2, endLine: 3 },
      { startLine: 4, endLine: 5 },
      { startLine: 6, endLine: 8 }
    ]);
  });

  it("gives an empty node no lines", () => {
    expect(locateNodeLines("Text", ["", "Text"])).toEqual([null, { startLine: 0, endLine: 1 }]);
  });

  it("gives up on a node it cannot find without losing its place", () => {
    expect(locateNodeLines("A\n\nB", ["X", "B"])).toEqual([null, { startLine: 2, endLine: 3 }]);
  });
});

describe("pageLineMarks", () => {
  const nodes = [
    { pos: 0, end: 10, startLine: 0, endLine: 1 },
    { pos: 10, end: 50, startLine: 2, endLine: 12 },
    { pos: 50, end: 60, startLine: 13, endLine: 14 }
  ];

  it("puts a line in front of the node a page begins with", () => {
    expect(
      pageLineMarks([{ page: 2, blockIndex: 2, withinBlock: false, fraction: 0 }], [0, 2, 13], nodes)
    ).toEqual([{ kind: "between", page: 2, pos: 50 }]);
  });

  it("marks a page that begins inside a node, at about the right height", () => {
    const [mark] = pageLineMarks([{ page: 2, blockIndex: 1, withinBlock: true, fraction: 0.5 }], [0, 2, 13], nodes);

    expect(mark).toEqual({ kind: "within", page: 2, pos: 10, end: 50, fraction: 0.5 });
  });

  it("marks a block that starts inside a node as within it", () => {
    // Two export blocks in one editor node; the second one starts a page.
    const [mark] = pageLineMarks(
      [{ page: 2, blockIndex: 2, withinBlock: false, fraction: 0 }],
      [0, 2, 7, 13],
      nodes
    );

    expect(mark).toMatchObject({ kind: "within", pos: 10, fraction: 0.5 });
  });

  it("skips blocks it cannot place", () => {
    expect(pageLineMarks([{ page: 2, blockIndex: 5, withinBlock: false, fraction: 0 }], [0, 2, 13], nodes)).toEqual(
      []
    );
  });
});

describe("pageLineMarks with planned breaks", () => {
  const nodes = [
    { pos: 0, end: 10, startLine: 0, endLine: 1 },
    { pos: 10, end: 50, startLine: 2, endLine: 12 }
  ];

  it("places a planned break exactly, through the resolver", () => {
    const marks = pageLineMarks(
      [{ page: 2, blockIndex: 1, withinBlock: true, fraction: 0, at: { kind: "paragraph", offset: 30 } }],
      [0, 2],
      nodes,
      (_node, at) => (at.kind === "paragraph" ? { kind: "inline", pos: 11 + at.offset } : null)
    );

    expect(marks).toEqual([{ kind: "inline", page: 2, pos: 41 }]);
  });

  it("falls back to the rough marker where the exact place cannot be found", () => {
    const [mark] = pageLineMarks(
      [{ page: 2, blockIndex: 1, withinBlock: true, fraction: 0.5, at: { kind: "tableRow", row: 3 } }],
      [0, 2],
      nodes,
      () => null
    );

    expect(mark.kind).toBe("within");
  });
});
