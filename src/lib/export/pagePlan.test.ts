import { describe, expect, it } from "vitest";

import { parseMarkdownToBlocks, type ExportBlock, type InlineRun } from "./markdownModel";
import {
  applyPagePlan,
  paragraphCutOffset,
  paragraphText,
  planPages,
  splitRuns,
  type FlowCandidate
} from "./pagePlan";

const block = (blockIndex: number, y: number, extra: Partial<FlowCandidate> = {}): FlowCandidate => ({
  y,
  blockIndex,
  inner: null,
  topExtra: 0,
  tailExtra: 0,
  ...extra
});

describe("planPages", () => {
  it("ends every page at the latest point that still fits", () => {
    const breaks = planPages({ candidates: [block(1, 40), block(2, 90), block(3, 130), block(4, 190)], end: 230 }, 100);

    expect(breaks.map((plannedBreak) => plannedBreak.blockIndex)).toEqual([2, 4]);
  });

  it("does not break a document that fits one page", () => {
    expect(planPages({ candidates: [block(1, 40)], end: 90 }, 100)).toEqual([]);
  });

  it("counts what a page needs above and below a cut", () => {
    const breaks = planPages(
      {
        candidates: [block(1, 60), block(1, 95, { inner: { kind: "tableRow", row: 3 }, tailExtra: 9, topExtra: 20 })],
        end: 170
      },
      100
    );

    // 95 + 9 does not fit on page one, so it ends at 60; page two can end at
    // the row (95 + 9 fits from 60), and page three then starts 20pt lower.
    expect(breaks.map((plannedBreak) => plannedBreak.y)).toEqual([60, 95]);
  });

  it("takes the new page's extra height into account", () => {
    const breaks = planPages(
      {
        candidates: [block(1, 90, { inner: { kind: "tableRow", row: 2 }, topExtra: 30 }), block(2, 170)],
        end: 200
      },
      100
    );

    // Page two would hold 90..170 plus a 30pt header, 110 in all: that does
    // not fit, and with no point in between it overflows.
    expect(breaks.map((plannedBreak) => [plannedBreak.y, plannedBreak.overflow ?? false])).toEqual([
      [90, false],
      [170, true]
    ]);
  });

  it("always ends a page at a manual break", () => {
    const breaks = planPages({ candidates: [block(1, 20, { mandatory: true }), block(2, 50)], end: 60 }, 100);

    expect(breaks).toEqual([expect.objectContaining({ blockIndex: 1, mandatory: true })]);
  });

  it("marks a stretch taller than a page as overflow", () => {
    const breaks = planPages({ candidates: [block(1, 250)], end: 300 }, 100);

    expect(breaks).toEqual([expect.objectContaining({ blockIndex: 1, overflow: true })]);
  });
});

const words = (count: number) => Array.from({ length: count }, (_, index) => `word${index}`).join(" ");

describe("paragraph cuts", () => {
  const [paragraph] = parseMarkdownToBlocks(`${words(40)}\n`) as [Extract<ExportBlock, { kind: "paragraph" }>];

  it("cuts at the start of a word, on the early side of the planned line", () => {
    const text = paragraphText(paragraph.runs);
    const offset = paragraphCutOffset(paragraph.runs, 2, 4);

    expect(text[offset - 1]).toBe(" ");
    expect(text.slice(offset)).toMatch(/^word\d+/);
    expect(offset).toBeLessThanOrEqual(text.length / 2);
  });

  it("splits runs without the space at the cut and keeps the styles", () => {
    const runs: InlineRun[] = [
      { kind: "text", text: "Bold words ", bold: true, italic: false, underline: false, highlight: false, strike: false, code: false, link: null },
      { kind: "text", text: "and plain", bold: false, italic: false, underline: false, highlight: false, strike: false, code: false, link: null }
    ];
    const [before, after] = splitRuns(runs, 5);

    expect(before).toEqual([expect.objectContaining({ text: "Bold", bold: true })]);
    expect(after.map((run) => (run.kind === "text" ? run.text : ""))).toEqual(["words ", "and plain"]);
  });
});

describe("applyPagePlan", () => {
  it("puts a page break in front of a block", () => {
    const blocks = parseMarkdownToBlocks("One\n\nTwo\n\nThree\n");
    const paged = applyPagePlan(blocks, [block(2, 0)]);

    expect(paged.blocks.map((item) => item.kind)).toEqual(["paragraph", "paragraph", "pageBreak", "paragraph"]);
    expect(paged.origins.map((origin) => origin.blockIndex)).toEqual([0, 1, 2, 2]);
  });

  it("splits a paragraph at a word and records where the second part begins", () => {
    const blocks = parseMarkdownToBlocks(`${words(40)}\n`);
    const paged = applyPagePlan(blocks, [block(0, 0, { inner: { kind: "paragraphLine", line: 2, lines: 4 } })]);
    const [first, , second] = paged.blocks as Extract<ExportBlock, { kind: "paragraph" }>[];
    const origin = paged.origins[2];

    expect(paged.blocks.map((item) => item.kind)).toEqual(["paragraph", "pageBreak", "paragraph"]);
    expect(`${paragraphText(first.runs)} ${paragraphText(second.runs)}`).toBe(words(40));
    expect(origin.part?.kind).toBe("paragraph");
    expect(paragraphText((blocks[0] as typeof first).runs).slice(origin.part?.kind === "paragraph" ? origin.part.offset : 0)).toBe(
      paragraphText(second.runs)
    );
  });

  it("splits a table before a row, repeats the header and keeps the columns", () => {
    const blocks = parseMarkdownToBlocks("| A | B |\n| - | - |\n| 1 | x |\n| 2 | y |\n| 3 | z |\n");
    const paged = applyPagePlan(blocks, [block(0, 0, { inner: { kind: "tableRow", row: 2 } })]);
    const tables = paged.blocks.filter((item) => item.kind === "table") as Extract<ExportBlock, { kind: "table" }>[];

    expect(tables.map((table) => table.rows.length)).toEqual([2, 3]);
    expect(tables[1].rows[0][0].header).toBe(true);
    expect(tables[1].columnSource).toBe(tables[0].columnSource);
    expect(paged.origins[2]).toEqual({ blockIndex: 0, part: { kind: "tableRow", row: 2 } });
  });

  it("splits a list before an item and continues the numbering", () => {
    const blocks = parseMarkdownToBlocks("1. a\n2. b\n3. c\n");
    const paged = applyPagePlan(blocks, [block(0, 0, { inner: { kind: "listItem", item: 2 } })]);
    const lists = paged.blocks.filter((item) => item.kind === "list") as Extract<ExportBlock, { kind: "list" }>[];

    expect(lists.map((list) => [list.start, list.items.length])).toEqual([
      [1, 2],
      [3, 1]
    ]);
  });

  it("splits a list inside an item and continues that item without a marker", () => {
    const blocks = parseMarkdownToBlocks("1. a\n   - x\n   - y\n   - z\n2. b\n");
    const cut = { kind: "listItem" as const, item: 0, within: { child: 1, item: 2 } };
    const paged = applyPagePlan(blocks, [block(0, 0, { inner: cut })]);
    const lists = paged.blocks.filter((item) => item.kind === "list") as Extract<ExportBlock, { kind: "list" }>[];
    const nested = (list: Extract<ExportBlock, { kind: "list" }>, index: number, child: number) =>
      list.items[index].children[child] as Extract<ExportBlock, { kind: "list" }>;

    expect(lists).toHaveLength(2);
    expect(lists[0].items).toHaveLength(1);
    expect(nested(lists[0], 0, 1).items).toHaveLength(2);
    expect(lists[1].start).toBe(1);
    expect(lists[1].items.map((item) => item.continued ?? false)).toEqual([true, false]);
    expect(nested(lists[1], 0, 0).items).toHaveLength(1);
    expect(paged.origins[2]).toEqual({ blockIndex: 0, part: cut });
  });

  it("cuts one list at several depths", () => {
    const blocks = parseMarkdownToBlocks("- a\n  - x\n  - y\n- b\n- c\n");
    const paged = applyPagePlan(blocks, [
      block(0, 0, { inner: { kind: "listItem", item: 0, within: { child: 1, item: 1 } } }),
      block(0, 10, { inner: { kind: "listItem", item: 2 } })
    ]);
    const lists = paged.blocks.filter((item) => item.kind === "list") as Extract<ExportBlock, { kind: "list" }>[];

    expect(lists.map((list) => list.items.length)).toEqual([1, 2, 1]);
    expect(lists[1].items[0].continued).toBe(true);
  });

  it("splits a code block before a line", () => {
    const blocks = parseMarkdownToBlocks("```\na\nb\nc\nd\n```\n");
    const paged = applyPagePlan(blocks, [block(0, 0, { inner: { kind: "codeLine", line: 3 } })]);
    const codes = paged.blocks.filter((item) => item.kind === "codeBlock") as Extract<ExportBlock, { kind: "codeBlock" }>[];

    expect(codes.map((code) => code.text)).toEqual(["a\nb\nc", "d"]);
  });

  it("leaves a manual break alone", () => {
    const blocks = parseMarkdownToBlocks('One\n\n<div style="page-break-after: always;"></div>\n\nTwo\n');
    const paged = applyPagePlan(blocks, [block(2, 0, { mandatory: true })]);

    expect(paged.blocks.map((item) => item.kind)).toEqual(["paragraph", "pageBreak", "paragraph"]);
  });
});
