/**
 * @vitest-environment jsdom
 */
import { strFromU8, unzipSync } from "fflate";
import { describe, expect, it } from "vitest";

import { DEFAULT_DOCUMENT_STYLE } from "@/lib/fonts";

import { renderHtmlDocument } from "./htmlExport";
import { parseMarkdownToBlocks, type ExportBlock } from "./markdownModel";
import { renderOdtDocument } from "./odtExport";
import { plainTableHeaders } from "./tableHeader";

// The setting only changes what is rendered, never the Markdown, so it is
// applied to the block list the formats are rendered from.

const MARKDOWN = "| A | B |\n| - | - |\n| 1 | 2 |\n";

function headerFlags(blocks: ExportBlock[]): boolean[] {
  return blocks.flatMap((block): boolean[] => {
    switch (block.kind) {
      case "table":
        return block.rows.flatMap((row) => row.map((cell) => cell.header));
      case "blockquote":
        return headerFlags(block.children);
      case "list":
        return block.items.flatMap((item) => headerFlags(item.children));
      default:
        return [];
    }
  });
}

describe("plainTableHeaders", () => {
  it("takes the header flag off every cell of a table", () => {
    const blocks = parseMarkdownToBlocks(MARKDOWN);

    expect(headerFlags(blocks)).toEqual([true, true, false, false]);
    expect(headerFlags(plainTableHeaders(blocks, true))).toEqual([false, false, false, false]);
  });

  it("reaches a table in a quote and in a list item", () => {
    const blocks = parseMarkdownToBlocks(
      `> ${MARKDOWN.split("\n").join("\n> ")}\n\n- item\n\n  ${MARKDOWN.trim().split("\n").join("\n  ")}\n`
    );
    const flags = headerFlags(plainTableHeaders(blocks, true));

    expect(flags.length).toBeGreaterThan(0);
    expect(flags.every((flag) => !flag)).toBe(true);
  });

  it("leaves the blocks alone when the setting is off", () => {
    const blocks = parseMarkdownToBlocks(MARKDOWN);

    expect(plainTableHeaders(blocks, false)).toBe(blocks);
    expect(plainTableHeaders(blocks, undefined)).toBe(blocks);
  });

  it("does not change the blocks it was given", () => {
    const blocks = parseMarkdownToBlocks(MARKDOWN);
    plainTableHeaders(blocks, true);

    expect(headerFlags(blocks)).toEqual([true, true, false, false]);
  });
});

describe("plain table header in exports", () => {
  const table = parseMarkdownToBlocks(MARKDOWN);
  const plain = plainTableHeaders(table, true);

  it("writes header cells into HTML by default and body cells when plain", () => {
    expect(renderHtmlDocument("t", table, new Map(), DEFAULT_DOCUMENT_STYLE)).toContain("<th>A</th>");

    const html = renderHtmlDocument("t", plain, new Map(), DEFAULT_DOCUMENT_STYLE);
    expect(html).toContain("<td>A</td>");
    expect(html).not.toContain("<th>");
  });

  it("styles the ODT first row as a body row when plain", () => {
    const content = (blocks: ExportBlock[]) =>
      strFromU8(unzipSync(renderOdtDocument(blocks, new Map(), DEFAULT_DOCUMENT_STYLE))["content.xml"]);

    expect(content(table)).toContain('table:style-name="TC_header"');
    expect(content(plain)).not.toContain('table:style-name="TC_header"');
  });
});
