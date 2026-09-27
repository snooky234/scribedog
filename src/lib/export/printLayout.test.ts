import { describe, expect, it } from "vitest";

import { renderHtmlBody } from "./htmlExport";
import type { ExportImageMap } from "./imageAssets";
import { parseMarkdownToBlocks } from "./markdownModel";
import { getPrintFont, printBodySizePt, printLayoutCss } from "./printLayout";

describe("getPrintFont", () => {
  it("prints the system default in Roboto with Medium as bold, like the PDF", () => {
    const font = getPrintFont("system");

    expect(font.cssStack).toMatch(/^"Roboto"/);
    expect(font.boldWeight).toBe(500);
    expect(font.loadStyles).not.toBeNull();
  });

  it("prints a catalog font in its own face", () => {
    expect(getPrintFont("lato").cssStack).toMatch(/^"Lato"/);
    expect(getPrintFont("lato").boldWeight).toBe(700);
  });
});

describe("printLayoutCss", () => {
  const css = (fontSizePt = 11, fontId: "lato" | "system" = "lato") =>
    printLayoutCss({ font: getPrintFont(fontId), fontSizePt, listIndentPt: 10.8 });

  it("multiplies the face's own line height in, as pdfmake does", () => {
    // Lato: 1.2 x 1.35.
    expect(css()).toContain("line-height: 1.62;");
    // Courier in code blocks: 0.786 x 1.35.
    expect(css()).toContain("line-height: 1.061;");
  });

  it("uses the PDF's body and heading sizes, scaled with the text size", () => {
    expect(css()).toContain("font-size: 10.5pt;");
    expect(css()).toContain(".print-root h1 { font-size: 22pt; padding: 14pt 0 8pt; }");
    expect(css(16.5)).toContain("font-size: 15.75pt;");
    expect(printBodySizePt(16.5)).toBe(15.75);
  });

  it("spaces blocks with padding, since pdfmake adds margins where CSS would collapse them", () => {
    expect(css()).toContain(".print-root p { margin: 0; padding: 2pt 0 6pt; }");
  });

  it("indents lists by the measured marker width", () => {
    expect(css()).toContain("padding: 2pt 0 6pt 10.8pt;");
  });

  it("sets bold in the PDF's weight", () => {
    expect(css(11, "system")).toContain(".print-root strong, .print-root b, .print-root th { font-weight: 500; }");
  });
});

describe("renderHtmlBody for print", () => {
  const paged = { contentWidthPt: 451, contentHeightPt: 698, fontSizePt: 10.5, lineHeightPt: 17, tableWidth: "full" as const };
  const images: ExportImageMap = new Map([
    [
      "images/a.png",
      { originalDataUrl: "data:image/png;base64,AA==", pngDataUrl: "", pngBytes: new Uint8Array(), width: 600, height: 300 }
    ],
    [
      "images/b.png",
      { originalDataUrl: "data:image/png;base64,AA==", pngDataUrl: "", pngBytes: new Uint8Array(), width: 200, height: 100 }
    ]
  ]);

  it("sizes images in points, as the PDF does", () => {
    const html = renderHtmlBody(parseMarkdownToBlocks("![a](images/a.png)\n\n![b](images/b.png)\n"), images, paged);

    expect(html).toContain('style="width:451pt"');
    expect(html).toContain('style="width:200pt"');
  });

  it("marks a paragraph of images only, which the PDF sets without paragraph spacing", () => {
    const html = renderHtmlBody(parseMarkdownToBlocks("![a](images/a.png)\n\nText ![b](images/b.png)\n"), images, paged);

    expect(html.match(/class="print-image"/g)).toHaveLength(1);
  });

  it("gives a full-width table the PDF's column split", () => {
    const html = renderHtmlBody(parseMarkdownToBlocks("| A | B |\n| - | - |\n| x | a much longer cell |\n"), images, paged);

    expect(html).toMatch(/<table class="print-table--full print-keep print-rows-whole"><colgroup><col style="width:[\d.]+%" \/><col style="width:[\d.]+%" \/><\/colgroup>/);
  });

  it("puts the header row into a thead, so the browser repeats it on every page like the PDF", () => {
    const html = renderHtmlBody(parseMarkdownToBlocks("| A | B |\n| - | - |\n| x | y |\n"), images, paged);

    expect(html).toContain("<thead><tr><th>A</th><th>B</th></tr>\n</thead>");
  });

  it("keeps an image with its caption, and short code and tables, on one page like the PDF", () => {
    const html = renderHtmlBody(
      parseMarkdownToBlocks("![a](images/a.png)\n\n*Figure 1*\n\n```\none\n```\n\n| A |\n| - |\n| x |\n"),
      images,
      paged
    );

    expect(html).toMatch(/^<div class="print-keep">\n<p class="print-image">.*<\/p>\n<p><em>Figure 1<\/em><\/p>\n<\/div>/);
    expect(html).toContain('<pre class="print-keep">');
    expect(html).toContain('class="print-table--full print-keep print-rows-whole"');
  });

  it("caps an image at the height of the text area", () => {
    const tall: ExportImageMap = new Map([
      [
        "t.png",
        { originalDataUrl: "data:image/png;base64,AA==", pngDataUrl: "", pngBytes: new Uint8Array(), width: 300, height: 1400 }
      ]
    ]);
    const html = renderHtmlBody(parseMarkdownToBlocks("![t](t.png)\n"), tall, paged);

    // (698 - 4) / 1400 of 300pt.
    expect(html).toContain('style="width:148.71pt"');
  });

  it("leaves a content-width table its own width and the HTML export as it was", () => {
    const table = parseMarkdownToBlocks("| A | B |\n| - | - |\n| 1 | 2 |\n| 3 | 4 |\n| 5 | 6 |\n");

    expect(renderHtmlBody(table, images, { ...paged, tableWidth: "content" })).toContain(
      '<table class="print-rows-whole">\n'
    );
    expect(renderHtmlBody(table, images)).toContain("<table>\n");
    expect(renderHtmlBody(parseMarkdownToBlocks("![a](images/a.png)\n"), images)).not.toContain("pt\"");
  });
});
