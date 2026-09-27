import { describe, expect, it } from "vitest";

import { renderHtmlBody } from "./htmlExport";
import {
  normalizePageBreaks,
  pageBreakKeepMask,
  parseMarkdownToBlocks,
  parseMarkdownToBlocksWithLines,
  type ExportBlock
} from "./markdownModel";

// The editor writes its inline formatting in a few non-CommonMark spellings
// ("++u++", "==mark=="); the export parser has to read the same ones, or a
// highlighted phrase exports as literal equals signs.
describe("parseMarkdownToBlocks inline marks", () => {
  it("reads ==text== as a highlight run", () => {
    const [block] = parseMarkdownToBlocks("Ein ==wichtiger== Satz.");

    expect(block.kind).toBe("paragraph");
    if (block.kind !== "paragraph") {
      return;
    }

    const runs = block.runs.filter((run) => run.kind === "text");
    expect(runs.map((run) => (run.kind === "text" ? [run.text, run.highlight] : null))).toEqual([
      ["Ein ", false],
      ["wichtiger", true],
      [" Satz.", false]
    ]);
  });

  it("keeps a highlight combined with other marks", () => {
    const [block] = parseMarkdownToBlocks("==**fett** und ++unter++==");

    if (block.kind !== "paragraph") {
      throw new Error("expected paragraph");
    }

    const texts = block.runs.filter((run) => run.kind === "text");
    expect(texts.every((run) => run.kind === "text" && run.highlight)).toBe(true);
    expect(texts[0]).toMatchObject({ text: "fett", bold: true });
    expect(texts[2]).toMatchObject({ text: "unter", underline: true });
  });

  it("renders a highlight run as <mark> in HTML", () => {
    const html = renderHtmlBody(parseMarkdownToBlocks("Ein ==wichtiger== Satz."), new Map());

    expect(html).toContain("Ein <mark>wichtiger</mark> Satz.");
  });
});

// The editor writes a line break inside a table cell as "<br>" (the only
// form a Markdown cell has for it); the export reads it as a break instead
// of the literal tag.
describe("parseMarkdownToBlocks table cells", () => {
  it("reads <br> inside a cell as a line break", () => {
    const [block] = parseMarkdownToBlocks("| A |\n| --- |\n| one<br>two |\n");

    if (block.kind !== "table") {
      throw new Error("expected table");
    }

    expect(block.rows[1][0].runs.map((run) => (run.kind === "text" ? run.text : run.kind))).toEqual([
      "one",
      "break",
      "two"
    ]);
  });

  it("leaves <br> outside a table as text", () => {
    const [block] = parseMarkdownToBlocks("one<br>two\n");

    if (block.kind !== "paragraph") {
      throw new Error("expected paragraph");
    }

    expect(block.runs.some((run) => run.kind === "break")).toBe(false);
  });
});

// The editor's manual page break (extensions/pageBreak.ts) is a line of raw
// HTML on disk; with html: false the export parser would print it as text.
describe("parseMarkdownToBlocks page breaks", () => {
  const BREAK = '<div style="page-break-after: always;"></div>';

  it("reads the page break line as a pageBreak block", () => {
    const blocks = parseMarkdownToBlocks(`One\n\n${BREAK}\n\nTwo\n`);

    expect(blocks.map((block) => block.kind)).toEqual(["paragraph", "pageBreak", "paragraph"]);
  });

  it("reads the other accepted spellings too", () => {
    const blocks = parseMarkdownToBlocks("One\n\n<div style='break-before: page'></div>\n\nTwo\n");

    expect(blocks[1]).toEqual({ kind: "pageBreak" });
  });

  it("leaves the line as text inside a list", () => {
    const [list] = parseMarkdownToBlocks(`- item\n\n  ${BREAK}\n`);

    if (list.kind !== "list") {
      throw new Error("expected list");
    }

    expect(list.items[0].children.map((block) => block.kind)).toEqual(["paragraph", "paragraph"]);
  });

  it("renders it as a page-break element in HTML", () => {
    const html = renderHtmlBody(parseMarkdownToBlocks(`One\n\n${BREAK}\n\nTwo\n`), new Map());

    expect(html).toContain('<div class="page-break"></div>');
    expect(html).not.toContain("page-break-after");
  });
});

describe("normalizePageBreaks", () => {
  const pageBreak: ExportBlock = { kind: "pageBreak" };
  const paragraph = (text: string): ExportBlock => ({
    kind: "paragraph",
    runs: [
      {
        kind: "text",
        text,
        bold: false,
        italic: false,
        underline: false,
        highlight: false,
        strike: false,
        code: false,
        link: null
      }
    ]
  });

  it("drops breaks at the start and the end", () => {
    const kinds = normalizePageBreaks([pageBreak, paragraph("a"), pageBreak, pageBreak]).map((block) => block.kind);

    expect(kinds).toEqual(["paragraph"]);
  });

  it("merges consecutive breaks, like a chapter break before a chapter's own", () => {
    const kinds = normalizePageBreaks([paragraph("a"), pageBreak, pageBreak, paragraph("b")]).map(
      (block) => block.kind
    );

    expect(kinds).toEqual(["paragraph", "pageBreak", "paragraph"]);
  });

  it("returns an empty list for a document of breaks only", () => {
    expect(normalizePageBreaks([pageBreak, pageBreak])).toEqual([]);
  });
});

describe("pageBreakKeepMask", () => {
  it("marks the blocks normalizePageBreaks keeps", () => {
    const blocks: ExportBlock[] = [
      { kind: "pageBreak" },
      { kind: "hr" },
      { kind: "pageBreak" },
      { kind: "pageBreak" },
      { kind: "hr" },
      { kind: "pageBreak" }
    ];

    expect(pageBreakKeepMask(blocks)).toEqual([false, true, true, false, true, false]);
  });
});

describe("parseMarkdownToBlocksWithLines", () => {
  it("gives every top-level block the line it starts on", () => {
    const markdown = [
      "# Title",
      "",
      "Para one",
      "continued",
      "",
      "- a",
      "- b",
      "",
      "> quote",
      "",
      "| A |",
      "| - |",
      "| 1 |",
      "",
      "```",
      "code",
      "```",
      "",
      "---",
      "",
      '<div style="page-break-after: always;"></div>',
      "",
      "Last"
    ].join("\n");
    const { blocks, lines } = parseMarkdownToBlocksWithLines(markdown);

    expect(lines).toHaveLength(blocks.length);
    expect(lines).toEqual([0, 2, 5, 8, 10, 14, 18, 20, 22]);
  });
});
