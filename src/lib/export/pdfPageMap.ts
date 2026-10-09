import type { DocumentStyle } from "@/lib/fonts";

import { embedDiagrams } from "./diagramAssets";
import { numberExportBlocks } from "./headingNumbers";
import { collectImageSrcs, loadExportImages } from "./imageAssets";
import { pageBreakKeepMask, parseMarkdownToBlocks } from "./markdownModel";
import { remapBlockIndices, type PageMap } from "./pageMap";
import { plainTableHeaders } from "./tableHeader";

/**
 * Where the pages of a note's PDF export break, computed without writing
 * the PDF: the same parse, images, diagrams, numbering and layout as the
 * export (exporter.ts), so the result is exact for it. Block indices refer
 * to the note's top-level blocks as parsed by parseMarkdownToBlocks, with
 * the page breaks the export drops (at the start, the end, doubled) counted.
 */
export async function computePdfPageMap(
  markdown: string,
  markdownFilePath: string | null,
  style: DocumentStyle
): Promise<PageMap> {
  const parsed = parseMarkdownToBlocks(markdown);
  const keep = pageBreakKeepMask(parsed);
  const originalIndices = parsed.flatMap((_, index) => (keep[index] ? [index] : []));
  const kept = originalIndices.map((index) => parsed[index]);
  const images = markdownFilePath ? await loadExportImages(markdownFilePath, collectImageSrcs(kept)) : new Map();
  const blocks = plainTableHeaders(
    numberExportBlocks(await embedDiagrams(kept, images), style.headingNumbering),
    style.plainTableHeader
  );
  const { layoutPdfPageMap } = await import("./pdfExport");

  return remapBlockIndices(await layoutPdfPageMap(blocks, images, style), originalIndices);
}
