import { numberExportBlocks } from "@/lib/export/headingNumbers";
import { embedDiagrams } from "@/lib/export/diagramAssets";
import { collectImageSrcs, loadExportImages, type ExportImageMap } from "@/lib/export/imageAssets";
import { normalizePageBreaks, parseMarkdownToBlocks, type ExportBlock } from "@/lib/export/markdownModel";
import type { DocumentStyle } from "@/lib/fonts";
import {
  getPrintFont,
  printBodySizePt,
  printLayoutCss,
  printLineHeightPt,
  type PrintFont
} from "@/lib/export/printLayout";
import { getPageLayout, pageCssRule } from "@/lib/pageSetup";
import { useEditorSettingsStore } from "@/store/useEditorSettingsStore";

// Prints the rendered Markdown content only — never the raw source and never
// the app chrome (toolbar, sidebar, scrollbars). The blocks are rendered via
// the export pipeline into a `.print-root` container inside the main
// document; the `@media print` rules in App.css hide the app UI and show
// only this container in a fixed light theme. Printing the main document
// (instead of a hidden iframe) is deliberate: WebView2 does not reliably
// scope window.print() to an iframe's contentWindow, which printed the app
// UI instead of the note.
//
// The page is laid out like the PDF export: paper size and margins from the
// page setup, type, spacing, image sizes and table columns generated from
// the PDF's own values (printLayout.ts), and the pages cut where the PDF's
// are (planPrintedPages). Scaling in the print dialog is the one thing that
// can still move them.
export async function printMarkdown(markdown: string, markdownFilePath: string | null): Promise<void> {
  const { headingNumbering, pageSize, pageMargins, fontId, fontSizePt, tableWidth } =
    useEditorSettingsStore.getState();
  const page = getPageLayout(pageSize, pageMargins);
  const font = getPrintFont(fontId);
  // Same numbering the editor shows, so the paper matches the screen.
  const parsed = numberExportBlocks(normalizePageBreaks(parseMarkdownToBlocks(markdown)), headingNumbering);

  const [images, { renderHtmlBody }] = await Promise.all([
    markdownFilePath ? loadExportImages(markdownFilePath, collectImageSrcs(parsed)) : Promise.resolve(new Map()),
    import("@/lib/export/htmlExport"),
    loadPrintFont(font)
  ]);
  const bodySizePt = printBodySizePt(fontSizePt);
  const blocks = await planPrintedPages(await embedDiagrams(parsed, images), images, {
    fontId,
    fontSizePt,
    headingNumbering,
    tableWidth,
    pageSize,
    pageMargins
  });

  const printRoot = document.createElement("div");
  printRoot.className = "print-root";
  printRoot.setAttribute("aria-hidden", "true");
  printRoot.innerHTML = renderHtmlBody(blocks, images, {
    contentWidthPt: page.contentWidthPt,
    // Less the safety line at the bottom, as the PDF reserves it (pagePlan.ts).
    contentHeightPt: page.contentHeightPt - printLineHeightPt(font, fontSizePt),
    fontSizePt: bodySizePt,
    lineHeightPt: printLineHeightPt(font, fontSizePt),
    tableWidth
  });

  // Generated rather than in print.css: @page cannot read custom properties
  // reliably, and the metrics come from the PDF's values.
  const pageStyle = document.createElement("style");
  pageStyle.textContent = [
    pageCssRule(page),
    printLayoutCss({ font, fontSizePt, listIndentPt: measureListIndent(font, bodySizePt) })
  ].join("\n");

  document.head.appendChild(pageStyle);
  document.body.appendChild(printRoot);
  document.documentElement.classList.add("scribedog-printing");

  let cleanedUp = false;
  const cleanup = () => {
    if (cleanedUp) {
      return;
    }
    cleanedUp = true;
    document.documentElement.classList.remove("scribedog-printing");
    printRoot.remove();
    pageStyle.remove();
  };

  window.addEventListener("afterprint", cleanup, { once: true });
  // Fallback in case afterprint doesn't fire on some WebView2 builds —
  // otherwise the print container would leak for the rest of the session.
  window.setTimeout(cleanup, 60_000);

  // Let the browser lay out the freshly inserted content (images decode
  // asynchronously from data URIs) before opening the print dialog.
  await new Promise((resolve) => window.setTimeout(resolve, 50));

  window.print();
}

// The pages end where the PDF's end: the same page plan cuts the document and
// puts a hard break into every cut, and each page keeps a line of room so
// Chromium, which sets text a little differently, never runs over. Without
// the plan (pdfmake failed to load) the browser breaks the pages itself.
async function planPrintedPages(blocks: ExportBlock[], images: ExportImageMap, style: DocumentStyle): Promise<ExportBlock[]> {
  try {
    const { planPdfDocument } = await import("@/lib/export/pdfExport");
    return (await planPdfDocument(blocks, images, style)).blocks;
  } catch (error) {
    console.error("Print pages could not be planned:", error);
    return blocks;
  }
}

// The faces have to be there before the dialog lays out the pages, or the
// preview is set in the fallback font.
async function loadPrintFont(font: PrintFont): Promise<void> {
  try {
    await font.loadStyles?.();
    const family = font.cssStack.split(",")[0];
    await Promise.all([
      document.fonts.load(`400 12pt ${family}`),
      document.fonts.load(`italic 400 12pt ${family}`),
      document.fonts.load(`${font.boldWeight} 12pt ${family}`),
      document.fonts.load(`italic ${font.boldWeight} 12pt ${family}`)
    ]);
  } catch {
    // A missing face falls back to the stack's next family; printing goes on.
  }
}

// pdfmake indents a list by the width of "9. " in the body font.
function measureListIndent(font: PrintFont, bodySizePt: number): number {
  const context = document.createElement("canvas").getContext("2d");

  if (!context) {
    return bodySizePt;
  }

  context.font = `${bodySizePt}pt ${font.cssStack}`;
  // Canvas measures in CSS pixels.
  return (context.measureText("9. ").width * 72) / 96;
}
