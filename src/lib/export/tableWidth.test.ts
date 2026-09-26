/**
 * @vitest-environment jsdom
 */
import { strFromU8, unzipSync } from "fflate";
import { describe, expect, it } from "vitest";

import { DEFAULT_DOCUMENT_STYLE, type DocumentStyle } from "@/lib/fonts";

import { renderHtmlDocument } from "./htmlExport";
import { renderOdtDocument } from "./odtExport";
import { parseMarkdownToBlocks } from "./markdownModel";

// The editor's table width setting cannot travel in the Markdown itself, so
// it rides along in DocumentStyle. These cover the two formats that build
// their output as text and can be asserted without a headless renderer.

// Built through the same parser the real export uses.
const TABLE = parseMarkdownToBlocks("| A | B |\n| - | - |\n| 1 | 2 |\n");

const full: DocumentStyle = { ...DEFAULT_DOCUMENT_STYLE, tableWidth: "full" };
const content: DocumentStyle = { ...DEFAULT_DOCUMENT_STYLE, tableWidth: "content" };

function odtContentXml(style: DocumentStyle): string {
  const archive = unzipSync(renderOdtDocument(TABLE, new Map(), style));
  return strFromU8(archive["content.xml"]);
}

describe("table width in exports", () => {
  it("spans the text width in HTML when set to full", () => {
    expect(renderHtmlDocument("t", TABLE, new Map(), full)).toContain("width: 100%");
  });

  it("leaves the HTML table at its content width when set to content", () => {
    const html = renderHtmlDocument("t", TABLE, new Map(), content);
    expect(html).toMatch(/table \{[^}]*width: auto/);
  });

  it("defaults to the full width when the style says nothing", () => {
    const html = renderHtmlDocument("t", TABLE, new Map(), DEFAULT_DOCUMENT_STYLE);
    expect(html).toMatch(/table \{[^}]*width: 100%/);
  });

  it("picks the matching ODT table style", () => {
    expect(odtContentXml(full)).toContain('table:style-name="TA_full"');
    expect(odtContentXml(content)).toContain('table:style-name="TA_content"');
  });

  it("defines both ODT table styles it references", () => {
    const xml = odtContentXml(content);
    expect(xml).toContain('style:name="TA_full"');
    expect(xml).toContain('style:name="TA_content"');
  });
});
