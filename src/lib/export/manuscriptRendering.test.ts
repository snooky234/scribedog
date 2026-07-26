import { strFromU8, unzipSync } from "fflate";
import { describe, expect, it } from "vitest";

import { DEFAULT_FONT_SIZE_PT, type AppFontId, type DocumentStyle } from "@/lib/fonts";

import { renderDocxDocument } from "./docxExport";
import { renderHtmlDocument } from "./htmlExport";
import { renderOdtDocument } from "./odtExport";
import { compileManuscript, DEFAULT_MANUSCRIPT_OPTIONS, type ManuscriptSource } from "./manuscript";

// The page break and the centred title page are the only blocks the manuscript
// compiler produces that plain markdown never does, so each renderer's new
// switch arm is only ever exercised from here.

const SOURCES: ManuscriptSource[] = [
  { filePath: "C:/vault/01.md", relativePath: "01.md", markdown: "# Der Aufbruch\n\nText." },
  { filePath: "C:/vault/02.md", relativePath: "02.md", markdown: "# Die Ankunft\n\nMehr Text." }
];

function style(fontId: AppFontId, fontSizePt: number = DEFAULT_FONT_SIZE_PT): DocumentStyle {
  return { fontId, fontSizePt };
}

async function compile() {
  return compileManuscript(SOURCES, {
    ...DEFAULT_MANUSCRIPT_OPTIONS,
    title: "Die Reise",
    subtitle: "Ein Roman",
    author: "A. Autorin"
  });
}

describe("manuscript rendering", () => {
  it("HTML: emits a page-break element and centres the title page", async () => {
    const { blocks, images } = await compile();
    const html = renderHtmlDocument("Die Reise", blocks, images, style("eb-garamond"));

    expect(html).toContain('<div class="page-break"></div>');
    expect(html).toContain('<h1 style="text-align:center">Die Reise</h1>');
    expect(html).toContain('font-family: "EB Garamond", Georgia');
    // Two chapters plus the title page means two breaks.
    expect(html.match(/class="page-break"/g)).toHaveLength(2);
  });

  it("ODT: uses the page-break style and a centred heading style", async () => {
    const { blocks, images } = await compile();
    const archive = unzipSync(renderOdtDocument(blocks, images, style("libre-baskerville")));
    const content = strFromU8(archive["content.xml"]);
    const styles = strFromU8(archive["styles.xml"]);

    expect(content).toContain('<text:p text:style-name="P_pagebreak"/>');
    expect(content).toContain('fo:break-before="page"');
    expect(content).toContain('text:style-name="H_center_1"');
    // Word ignores inherited alignment, so the centred style must carry the
    // font itself rather than lean on a parent style.
    expect(content).toMatch(/H_center_1[^>]*>.*?Libre Baskerville/s);
    expect(styles).toContain('fo:font-family="Libre Baskerville"');
  });

  it("DOCX: produces a document containing a page break", async () => {
    const { blocks, images } = await compile();
    const bytes = await renderDocxDocument("Die Reise", blocks, images, style("lato"));
    const archive = unzipSync(bytes);
    const document = strFromU8(archive["word/document.xml"]);

    expect(document).toContain('<w:br w:type="page"/>');
    expect(document).toContain('<w:jc w:val="center"/>');
    expect(strFromU8(archive["word/styles.xml"])).toContain('w:ascii="Lato"');
  });

  it("the system font keeps the safe Arial fallback in the office formats", async () => {
    const { blocks, images } = await compile();
    const archive = unzipSync(renderOdtDocument(blocks, images, style("system")));

    expect(strFromU8(archive["styles.xml"])).toContain('fo:font-family="Arial"');
  });
});

// The size is applied as a factor on each format's own scale, so the default
// must leave today's output untouched and a change must move body *and*
// headings together.
describe("document text size", () => {
  it("the default size changes nothing in any format", async () => {
    const { blocks, images } = await compile();

    expect(renderHtmlDocument("T", blocks, images, style("lato"))).toContain("font-size: 16px");

    const odt = strFromU8(unzipSync(renderOdtDocument(blocks, images, style("lato")))["styles.xml"]);
    expect(odt).toContain('fo:font-size="20pt"'); // Heading 1 at its tuned size.

    const docx = await renderDocxDocument("T", blocks, images, style("lato"));
    expect(strFromU8(unzipSync(docx)["word/styles.xml"])).toContain('w:val="22"'); // 11pt body.
  });

  it("scales HTML, ODT and DOCX proportionally", async () => {
    const { blocks, images } = await compile();
    const larger = style("lato", 16.5); // 1.5x the 11pt default.

    expect(renderHtmlDocument("T", blocks, images, larger)).toContain("font-size: 24px");

    const odt = strFromU8(unzipSync(renderOdtDocument(blocks, images, larger))["styles.xml"]);
    expect(odt).toContain('fo:font-size="30pt"'); // Heading 1: 20pt * 1.5.

    const docx = await renderDocxDocument("T", blocks, images, larger);
    expect(strFromU8(unzipSync(docx)["word/styles.xml"])).toContain('w:val="33"'); // 11pt * 1.5.
  });

  it("clamps a size outside the allowed range instead of producing absurd output", async () => {
    const { blocks, images } = await compile();
    const absurd = renderHtmlDocument("T", blocks, images, { fontId: "lato", fontSizePt: 400 });

    // 18pt is the maximum, so the factor caps at 18/11.
    expect(absurd).toContain(`font-size: ${Math.round((16 * 18) / 11 * 100) / 100}px`);
  });
});
