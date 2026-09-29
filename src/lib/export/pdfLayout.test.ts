import { createRequire } from "node:module";

import type { TDocumentDefinitions } from "pdfmake/interfaces";
import { describe, expect, it } from "vitest";

import { APP_FONTS, DEFAULT_DOCUMENT_STYLE, type DocumentStyle } from "@/lib/fonts";
import { getPageLayout } from "@/lib/pageSetup";

import type { ExportImageMap } from "./imageAssets";
import { normalizePageBreaks, parseMarkdownToBlocks, type ExportBlock } from "./markdownModel";
import { pageMapToOrigins } from "./pageMap";
import { paragraphText } from "./pagePlan";
import { buildFlowDefinition, buildPdfDocumentDefinition, planFromFlow, readPageMap } from "./pdfExport";

// The app renders with pdfmake's browser build, which does not load under
// Vitest; the Node build lays out the same document definitions with the same
// engine, so the page plan can be checked against a real layout: the flow on
// an endless page, the plan, and the paged PDF rendered from it.

const require = createRequire(import.meta.url);
const pdfmake = require("pdfmake") as {
  addFonts: (fonts: Record<string, unknown>) => void;
  createPdf: (definition: TDocumentDefinitions) => { getBuffer: () => Promise<Buffer> };
};
pdfmake.addFonts(require("pdfmake/fonts/Roboto.js") as Record<string, unknown>);
pdfmake.addFonts({
  Courier: { normal: "Courier", bold: "Courier-Bold", italics: "Courier-Oblique", bolditalics: "Courier-BoldOblique" }
});

async function renderText(definition: TDocumentDefinitions): Promise<string> {
  return Buffer.from(await pdfmake.createPdf(definition).getBuffer()).toString("latin1");
}

function pageCount(pdf: string): number {
  return (pdf.match(/\/Type \/Page\b/g) ?? []).length;
}

async function planned(markdown: string, overrides: Partial<DocumentStyle> = {}, images: ExportImageMap = new Map()) {
  const style = { ...DEFAULT_DOCUMENT_STYLE, ...overrides };
  const blocks = normalizePageBreaks(parseMarkdownToBlocks(markdown));
  const flow = buildFlowDefinition(blocks, images, style, "Roboto");
  await renderText(flow.definition);
  const paged = planFromFlow(blocks, flow.recording);
  const definition = buildPdfDocumentDefinition("t", paged.blocks, images, style, "Roboto");
  const pdf = await renderText(definition);

  return { blocks, paged, definition, pdf, map: pageMapToOrigins(readPageMap(definition), paged.origins) };
}

const sentence = (index: number) =>
  `Sentence ${index} with some ordinary words that fill a line of body text in the document.`;
const paragraphOf = (sentences: number, from = 0) =>
  Array.from({ length: sentences }, (_, index) => sentence(from + index)).join(" ");

// A long mix of what notes contain, to plan pages for.
function longDocument(): string {
  const parts: string[] = ["# Long document"];

  for (let section = 0; section < 12; section++) {
    parts.push(`## Section ${section}`);
    parts.push(paragraphOf(3 + (section % 5), section * 10));
    parts.push(paragraphOf(9 + (section % 3), section * 10 + 5));
    parts.push(Array.from({ length: 6 }, (_, item) => `- Item ${item} of section ${section}`).join("\n"));
    parts.push(
      [
        "| Name | Value | Note |",
        "| --- | --- | --- |",
        ...Array.from({ length: 8 }, (_, row) => `| Row ${row} | ${row * 7} | ${sentence(row)} |`)
      ].join("\n")
    );
    parts.push(["```", ...Array.from({ length: 7 }, (_, line) => `const line${line} = ${line};`), "```"].join("\n"));
  }

  return parts.join("\n\n");
}

describe("PDF layout", () => {
  it("uses the configured paper size", async () => {
    const { pdf } = await planned("Text\n", { pageSize: "letter" });

    expect(pdf).toContain("/MediaBox [0 0 612 792]");
  });

  it("starts a new page at a manual break and drops a trailing one", async () => {
    const { pdf } = await planned(
      'One\n\n<div style="page-break-after: always;"></div>\n\nTwo\n\n<div style="page-break-after: always;"></div>\n'
    );

    expect(pageCount(pdf)).toBe(2);
  });

  it("reports where each page begins", async () => {
    const { map } = await planned('One\n\nTwo\n\n<div style="page-break-after: always;"></div>\n\nThree\n\nFour\n');

    expect(map.pageCount).toBe(2);
    // Block indices count the page break itself (index 2).
    expect(map.pageStarts).toEqual([{ page: 2, blockIndex: 3, withinBlock: false, fraction: 0 }]);
  });
});

describe("planned pages", () => {
  it("ends every page exactly where the plan says, and knows where inside a block", async () => {
    const { map, pdf, paged } = await planned(longDocument());
    const plannedBreaks = paged.blocks.filter((block) => block.kind === "pageBreak").length;

    expect(pageCount(pdf)).toBe(plannedBreaks + 1);
    expect(map.pageStarts).toHaveLength(plannedBreaks);
    // No page begins inside a block without the exact place.
    expect(map.pageStarts.filter((start) => start.withinBlock && !start.at)).toEqual([]);
    // The long document is cut inside paragraphs, tables, lists or code at least once.
    expect(map.pageStarts.some((start) => start.at)).toBe(true);
  });

  it("leaves at least one line free at the bottom of every page", async () => {
    const { definition } = await planned(longDocument());
    const page = getPageLayout();
    const lineHeight = 10.5 * 1.35 * APP_FONTS.system.pdfLineHeight;
    const bottomByPage = new Map<number, number>();
    const visit = (node: unknown) => {
      if (!node || typeof node !== "object") {
        return;
      }

      for (const position of (node as { positions?: Array<{ pageNumber: number; top: number }> }).positions ?? []) {
        bottomByPage.set(position.pageNumber, Math.max(bottomByPage.get(position.pageNumber) ?? 0, position.top));
      }

      Object.values(node).forEach((value) => (Array.isArray(value) ? value.forEach(visit) : visit(value)));
    };

    (definition.content as unknown[]).forEach(visit);

    for (const lastLineTop of bottomByPage.values()) {
      // The last line ends a line above the bottom margin, give or take its own height.
      expect(lastLineTop + lineHeight).toBeLessThanOrEqual(page.heightPt - page.margins.bottom - lineHeight + 1);
    }
  });

  it("never leaves a heading at the bottom of a page", async () => {
    for (let lines = 5; lines < 40; lines += 3) {
      const filler = Array.from({ length: lines }, (_, index) => `Line ${index}`).join("\n\n");
      const { map, blocks } = await planned(`${filler}\n\n## Heading\n\n${paragraphOf(2)}\n`, { pageSize: "a5" });
      const heading = blocks.findIndex((block) => block.kind === "heading");
      const pages = map.blocks.filter((block) => block.blockIndex === heading || block.blockIndex === heading + 1);

      expect(new Set(pages.map((block) => block.startPage)).size).toBe(1);
    }
  });

  it("cuts a paragraph at a word and continues it on the next page", async () => {
    const markdown = `${Array.from({ length: 30 }, (_, index) => `Line ${index}`).join("\n\n")}\n\n${paragraphOf(20)}\n`;
    const { map, blocks } = await planned(markdown, { pageSize: "a5" });
    const start = map.pageStarts.find((pageStart) => pageStart.at?.kind === "paragraph");

    expect(start).toBeDefined();

    const original = blocks[start!.blockIndex] as Extract<ExportBlock, { kind: "paragraph" }>;
    const offset = start!.at!.kind === "paragraph" ? start!.at!.offset : 0;
    const text = paragraphText(original.runs);

    expect(text[offset - 1]).toBe(" ");
    expect(text.slice(offset)).toMatch(/^\S/);
  });

  it("breaks a list of few main points between its sub-points", async () => {
    const filler = Array.from({ length: 12 }, (_, index) => `Line ${index}`).join("\n\n");
    const points = [0, 1]
      .map((point) =>
        [`- Point ${point}`, ...Array.from({ length: 20 }, (_, sub) => `  - Sub-point ${sub} of point ${point}`)].join("\n")
      )
      .join("\n");
    const { map, pdf, paged, blocks } = await planned(`${filler}\n\n${points}\n`, { pageSize: "a5" });
    const list = blocks.findIndex((block) => block.kind === "list");

    // The list begins on the page the filler ends on, and is cut between sub-points.
    expect(map.pageStarts.some((start) => start.blockIndex === list && !start.withinBlock)).toBe(false);
    expect(map.pageStarts.some((start) => start.at?.kind === "listItem" && start.at.within)).toBe(true);
    expect(pageCount(pdf)).toBe(paged.blocks.filter((block) => block.kind === "pageBreak").length + 1);
  });

  it("keeps an image together with its italic caption", () => {
    const pixel =
      "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
    const images = new Map([
      ["a.png", { originalDataUrl: pixel, pngDataUrl: pixel, pngBytes: new Uint8Array(), width: 400, height: 300 }]
    ]);
    const blocks = parseMarkdownToBlocks("Intro\n\n![a](a.png)\n\n*Figure 1: The harbour*\n\nAfter\n");
    const definition = buildPdfDocumentDefinition("t", blocks, images, DEFAULT_DOCUMENT_STYLE, "Roboto");
    const content = definition.content as { id?: string; stack?: unknown[]; unbreakable?: boolean }[];

    expect(content).toHaveLength(3);
    expect(content[1]).toMatchObject({ id: "block:1:0", unbreakable: true });
    expect(content[1].stack).toHaveLength(2);
    expect(content[2].id).toBe("block:3:0");
  });

  it("scales an image down to the height a page has for it", () => {
    const pixel = "data:image/png;base64,AA==";
    const images = new Map([
      ["tall.png", { originalDataUrl: pixel, pngDataUrl: pixel, pngBytes: new Uint8Array(), width: 400, height: 2000 }]
    ]);
    const definition = buildPdfDocumentDefinition(
      "t",
      parseMarkdownToBlocks("![tall](tall.png)\n"),
      images,
      DEFAULT_DOCUMENT_STYLE,
      "Roboto"
    );
    const [image] = definition.content as { width: number }[];
    const lineHeight = 10.5 * 1.35 * APP_FONTS.system.pdfLineHeight;

    // A4 text area less the safety line and the image's 2pt margins.
    expect(image.width).toBeCloseTo(400 * ((841.89 - 144 - lineHeight - 4) / 2000), 1);
  });
});
