import { describe, expect, it } from "vitest";

import { buildPageMap, remapBlockIndices } from "./pageMap";

describe("buildPageMap", () => {
  it("records where each block starts and ends", () => {
    const map = buildPageMap([
      { blockIndex: 0, lines: [1, 1] },
      { blockIndex: 1, lines: [1, 1, 2, 2] },
      { blockIndex: 2, lines: [2] },
      { blockIndex: 3, lines: [3, 3] }
    ]);

    expect(map.pageCount).toBe(3);
    expect(map.blocks).toEqual([
      { blockIndex: 0, startPage: 1, endPage: 1 },
      { blockIndex: 1, startPage: 1, endPage: 2 },
      { blockIndex: 2, startPage: 2, endPage: 2 },
      { blockIndex: 3, startPage: 3, endPage: 3 }
    ]);
  });

  it("says how every page after the first begins", () => {
    const map = buildPageMap([
      { blockIndex: 0, lines: [1] },
      { blockIndex: 1, lines: [1, 1, 1, 2] },
      { blockIndex: 2, lines: [2, 3] },
      { blockIndex: 4, lines: [4] }
    ]);

    expect(map.pageStarts).toEqual([
      { page: 2, blockIndex: 1, withinBlock: true, fraction: 0.75 },
      { page: 3, blockIndex: 2, withinBlock: true, fraction: 0.5 },
      { page: 4, blockIndex: 4, withinBlock: false, fraction: 0 }
    ]);
  });

  it("orders blocks by index and skips those without lines", () => {
    const map = buildPageMap([
      { blockIndex: 2, lines: [2] },
      { blockIndex: 1, lines: [] },
      { blockIndex: 0, lines: [1] }
    ]);

    expect(map.blocks.map((block) => block.blockIndex)).toEqual([0, 2]);
    expect(map.pageStarts).toEqual([{ page: 2, blockIndex: 2, withinBlock: false, fraction: 0 }]);
  });

  it("is empty for an empty document", () => {
    expect(buildPageMap([])).toEqual({ pageCount: 0, blocks: [], pageStarts: [] });
  });
});

describe("remapBlockIndices", () => {
  it("translates block indices back to the document as written", () => {
    const map = buildPageMap([
      { blockIndex: 0, lines: [1] },
      { blockIndex: 1, lines: [2] }
    ]);

    expect(remapBlockIndices(map, [1, 3])).toEqual({
      pageCount: 2,
      blocks: [
        { blockIndex: 1, startPage: 1, endPage: 1 },
        { blockIndex: 3, startPage: 2, endPage: 2 }
      ],
      pageStarts: [{ page: 2, blockIndex: 3, withinBlock: false, fraction: 0 }]
    });
  });
});
