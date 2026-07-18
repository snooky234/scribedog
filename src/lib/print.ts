import { collectImageSrcs, loadExportImages } from "@/lib/export/imageAssets";
import { parseMarkdownToBlocks } from "@/lib/export/markdownModel";

// Prints the rendered Markdown content only — never the raw source and never
// the app chrome (toolbar, sidebar, scrollbars). The blocks are rendered via
// the export pipeline into a `.print-root` container inside the main
// document; the `@media print` rules in App.css hide the app UI and show
// only this container in a fixed light theme. Printing the main document
// (instead of a hidden iframe) is deliberate: WebView2 does not reliably
// scope window.print() to an iframe's contentWindow, which printed the app
// UI instead of the note.
export async function printMarkdown(markdown: string, markdownFilePath: string | null): Promise<void> {
  const blocks = parseMarkdownToBlocks(markdown);

  const [images, { renderHtmlBody }] = await Promise.all([
    markdownFilePath ? loadExportImages(markdownFilePath, collectImageSrcs(blocks)) : Promise.resolve(new Map()),
    import("@/lib/export/htmlExport")
  ]);

  const printRoot = document.createElement("div");
  printRoot.className = "print-root";
  printRoot.setAttribute("aria-hidden", "true");
  printRoot.innerHTML = renderHtmlBody(blocks, images);

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
