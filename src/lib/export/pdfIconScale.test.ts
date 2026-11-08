import { describe, expect, it } from "vitest";

import { DEFAULT_DOCUMENT_STYLE, getFontScale } from "@/lib/fonts";

import { normalizePageBreaks, parseMarkdownToBlocks } from "./markdownModel";
import type { PdfIconFont } from "./iconSegments";
import { buildPdfDocumentDefinition } from "./pdfExport";
import { PDF_BODY_SIZE_PT, PDF_HEADINGS, PDF_LINE_HEIGHT } from "./pdfTypography";

// The PDF cannot scale a font the way the webview does (size-adjust), so an
// icon run is given a larger font size of its own. Checked on the document
// definition, which is what pdfmake lays out.

const icon = String.fromCodePoint(0xf308);
const fonts = (scale: number): PdfIconFont[] => [{ name: "icons", ranges: [[0xf300, 0xf3ff]], scale }];

type Run = { text?: string; font?: string; fontSize?: number; lineHeight?: number };

function runs(definition: unknown): Run[] {
  const found: Run[] = [];
  const visit = (node: unknown) => {
    if (Array.isArray(node)) {
      node.forEach(visit);
    } else if (node && typeof node === "object") {
      const record = node as Record<string, unknown>;

      if (typeof record.text === "string") {
        found.push(record as Run);
      }

      Object.values(record).forEach(visit);
    }
  };

  visit((definition as { content: unknown }).content);

  return found;
}

function build(markdown: string, iconFonts: PdfIconFont[]) {
  const blocks = normalizePageBreaks(parseMarkdownToBlocks(markdown));

  return buildPdfDocumentDefinition("t", blocks, new Map(), DEFAULT_DOCUMENT_STYLE, "Roboto", iconFonts);
}

const scale = getFontScale(DEFAULT_DOCUMENT_STYLE.fontSizePt);
const bodySize = Math.round(PDF_BODY_SIZE_PT * scale * 100) / 100;

describe("icon size in the PDF", () => {
  it("sets an icon run in a larger size, from the body size in a paragraph", () => {
    const iconRun = runs(build(`text ${icon} text`, fonts(1.5))).find((run) => run.font === "icons");

    expect(iconRun?.fontSize).toBe(Math.round(bodySize * 1.5 * 100) / 100);
  });

  it("scales from the heading's size inside a heading", () => {
    const iconRun = runs(build(`# Title ${icon}`, fonts(2))).find((run) => run.font === "icons");
    const headingSize = Math.round(PDF_HEADINGS[0].sizePt * scale * 100) / 100;

    expect(iconRun?.fontSize).toBe(Math.round(headingSize * 2 * 100) / 100);
  });

  it("keeps the line as tall as the text around it, so a larger icon does not stretch it", () => {
    const iconRun = runs(build(`text ${icon}`, fonts(2))).find((run) => run.font === "icons");

    expect(iconRun?.lineHeight).toBeCloseTo((PDF_LINE_HEIGHT * bodySize) / (bodySize * 2));
  });

  it("leaves the run alone at 1, and the text around an icon never gets a size", () => {
    const all = runs(build(`before ${icon} after`, fonts(1)));
    const scaled = runs(build(`before ${icon} after`, fonts(1.5)));

    expect(all.every((run) => run.fontSize === undefined)).toBe(true);
    expect(scaled.filter((run) => run.font !== "icons").every((run) => run.fontSize === undefined)).toBe(true);
  });

  it("does not shrink the line height for a smaller icon", () => {
    const iconRun = runs(build(`text ${icon}`, fonts(0.75))).find((run) => run.font === "icons");

    expect(iconRun?.fontSize).toBe(Math.round(bodySize * 0.75 * 100) / 100);
    expect(iconRun?.lineHeight).toBeUndefined();
  });
});
