import type { PagedOrigin } from "./pagePlan";

// Where the pages of the PDF export break, per block of the document's top
// level. Built from the page of every line pdfmake laid out (readPageMap in
// pdfExport.ts), so it is exact for the PDF; the editor's page lines are
// drawn from it.

export type LaidOutBlock = {
  blockIndex: number;
  /** The page of each laid-out line (an image or rule counts as one). */
  lines: number[];
};

export type PageMapBlock = {
  blockIndex: number;
  startPage: number;
  endPage: number;
};

/** How page `page` begins. */
export type PageStart = {
  page: number;
  /** The first block with anything on this page. */
  blockIndex: number;
  /** True when that block began on an earlier page and runs over. */
  withinBlock: boolean;
  /**
   * For a block that runs over: the share of its lines on the pages before
   * (0..1), roughly where in the block the page ends. 0 otherwise.
   */
  fraction: number;
  /**
   * Where exactly inside the block the page begins, when the break was
   * planned (pagePlan.ts): the word, table row, list item or code line.
   * Without it a page inside a block is only known roughly (`fraction`),
   * which happens only where a block is taller than a page.
   */
  at?: NonNullable<PagedOrigin["part"]>;
};

export type PageMap = {
  pageCount: number;
  blocks: PageMapBlock[];
  /** One entry for every page after the first. */
  pageStarts: PageStart[];
};

export function buildPageMap(laidOut: LaidOutBlock[]): PageMap {
  const withLines = laidOut
    .filter((block) => block.lines.length > 0)
    .sort((a, b) => a.blockIndex - b.blockIndex);

  const blocks = withLines.map((block) => ({
    blockIndex: block.blockIndex,
    startPage: Math.min(...block.lines),
    endPage: Math.max(...block.lines)
  }));
  const pageCount = blocks.reduce((max, block) => Math.max(max, block.endPage), blocks.length > 0 ? 1 : 0);
  const pageStarts: PageStart[] = [];

  for (let page = 2; page <= pageCount; page++) {
    const index = withLines.findIndex((block) => block.lines.includes(page));

    if (index === -1) {
      continue;
    }

    const block = withLines[index];
    const before = block.lines.filter((line) => line < page).length;

    pageStarts.push({
      page,
      blockIndex: block.blockIndex,
      withinBlock: before > 0,
      fraction: before > 0 ? before / block.lines.length : 0
    });
  }

  return { pageCount, blocks, pageStarts };
}

/**
 * The same map with every block index translated through `originalIndices`
 * (the index each laid-out block had before blocks were dropped), so it
 * refers to the document as written.
 */
export function remapBlockIndices(map: PageMap, originalIndices: number[]): PageMap {
  const original = (index: number) => originalIndices[index] ?? index;

  return {
    pageCount: map.pageCount,
    blocks: map.blocks.map((block) => ({ ...block, blockIndex: original(block.blockIndex) })),
    pageStarts: map.pageStarts.map((start) => ({ ...start, blockIndex: original(start.blockIndex) }))
  };
}

/**
 * A page map of the planned document (pagePlan.ts, cut at the page breaks)
 * told in terms of the document before the cuts: every part of a split block
 * counts as that block, and a page that begins with such a part begins inside
 * the block, at exactly the place the cut was made.
 */
export function pageMapToOrigins(map: PageMap, origins: PagedOrigin[]): PageMap {
  const blocks = new Map<number, PageMapBlock>();

  for (const block of map.blocks) {
    const blockIndex = origins[block.blockIndex]?.blockIndex ?? block.blockIndex;
    const known = blocks.get(blockIndex);

    blocks.set(blockIndex, {
      blockIndex,
      startPage: Math.min(known?.startPage ?? block.startPage, block.startPage),
      endPage: Math.max(known?.endPage ?? block.endPage, block.endPage)
    });
  }

  const pageStarts = map.pageStarts.map((start): PageStart => {
    const origin = origins[start.blockIndex];

    if (!origin) {
      return start;
    }

    if (!start.withinBlock && origin.part) {
      return { page: start.page, blockIndex: origin.blockIndex, withinBlock: true, fraction: 0, at: origin.part };
    }

    return { ...start, blockIndex: origin.blockIndex };
  });

  return {
    pageCount: map.pageCount,
    blocks: [...blocks.values()].sort((a, b) => a.blockIndex - b.blockIndex),
    pageStarts
  };
}
