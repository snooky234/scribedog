import { strFromU8, unzipSync } from "fflate";
import { describe, expect, it } from "vitest";

import { DEFAULT_DOCUMENT_STYLE, type DocumentStyle } from "@/lib/fonts";

import { renderDocxDocument } from "./docxExport";
import { parseMarkdownToBlocks } from "./markdownModel";
import { renderOdtDocument } from "./odtExport";

// The page setup cannot travel in the Markdown itself, so it rides along in
// DocumentStyle. DOCX and ODT write it into their XML, which can be asserted
// without a renderer; the PDF takes the same numbers from getPageLayout.

const BLOCKS = parseMarkdownToBlocks("# Title\n\nText.\n");

function docxDocumentXml(bytes: Uint8Array): string {
  return strFromU8(unzipSync(bytes)["word/document.xml"]);
}

function odtStylesXml(style: DocumentStyle): string {
  return strFromU8(unzipSync(renderOdtDocument(BLOCKS, new Map(), style))["styles.xml"]);
}

describe("page setup in DOCX", () => {
  it("writes US Letter with narrow margins into the section", async () => {
    const xml = docxDocumentXml(
      await renderDocxDocument("t", BLOCKS, new Map(), {
        ...DEFAULT_DOCUMENT_STYLE,
        pageSize: "letter",
        pageMargins: "narrow"
      })
    );

    expect(xml).toMatch(/<w:pgSz[^>]*w:w="12240"[^>]*w:h="15840"/);
    expect(xml).toMatch(/<w:pgMar[^>]*w:top="720"[^>]*w:right="720"[^>]*w:bottom="720"[^>]*w:left="720"/);
  });

  it("writes A4 with normal margins when the style says nothing", async () => {
    const xml = docxDocumentXml(await renderDocxDocument("t", BLOCKS, new Map(), DEFAULT_DOCUMENT_STYLE));

    expect(xml).toMatch(/<w:pgSz[^>]*w:w="11906"[^>]*w:h="16838"/);
    expect(xml).toMatch(/<w:pgMar[^>]*w:left="1440"/);
  });

  it("keeps headings with the next paragraph", async () => {
    const bytes = await renderDocxDocument("t", BLOCKS, new Map(), DEFAULT_DOCUMENT_STYLE);
    const styles = strFromU8(unzipSync(bytes)["word/styles.xml"]);

    expect(styles).toMatch(/w:styleId="Heading1"[\s\S]*?<w:keepNext\/>/);
  });
});

describe("page setup in ODT", () => {
  it("defines a page layout and uses it on the standard master page", () => {
    const xml = odtStylesXml({ ...DEFAULT_DOCUMENT_STYLE, pageSize: "a5", pageMargins: "wide" });

    expect(xml).toContain('fo:page-width="14.800cm"');
    expect(xml).toContain('fo:page-height="21.000cm"');
    expect(xml).toContain('fo:margin-left="3.175cm"');
    expect(xml).toContain('fo:margin-top="2.540cm"');
    expect(xml).toContain('<style:master-page style:name="Standard" style:page-layout-name="PL_page"/>');
  });

  it("puts the automatic styles between the styles and the master styles", () => {
    const xml = odtStylesXml(DEFAULT_DOCUMENT_STYLE);

    expect(xml.indexOf("</office:styles>")).toBeLessThan(xml.indexOf("<office:automatic-styles>"));
    expect(xml.indexOf("</office:automatic-styles>")).toBeLessThan(xml.indexOf("<office:master-styles>"));
  });
});

// ONLYOFFICE carries the bold of a span that opens a paragraph over into the
// paragraph style and every later paragraph of it; runs that state their own
// weight are immune (odtExport.ts).
describe("text runs in ODT", () => {
  it("gives plain text an explicit normal weight and slant", () => {
    const blocks = parseMarkdownToBlocks("**Bold** start\n\nPlain paragraph\n");
    const xml = strFromU8(unzipSync(renderOdtDocument(blocks, new Map(), DEFAULT_DOCUMENT_STYLE))["content.xml"]);

    expect(xml).toContain('<text:span text:style-name="T_n">Plain paragraph</text:span>');
    expect(xml).toMatch(/style:name="T_n"[^>]*><style:text-properties fo:font-weight="normal" fo:font-style="normal"/);
    expect(xml).toMatch(/style:name="T_b"[^>]*><style:text-properties fo:font-weight="bold" fo:font-style="normal"/);
  });
});
