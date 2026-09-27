import type { DocumentStyle } from "@/lib/fonts";

import type { ExportImageMap } from "./imageAssets";
import type { ExportBlock } from "./markdownModel";
import type { PageMap } from "./pageMap";
import { layoutPdfPageMap } from "./pdfExport";

// What the page map layout needs, in a form that crosses to a worker: the
// blocks as the PDF export would render them, and of every image only its
// size. The layout never looks at pixels, so each image is laid out from a
// one-pixel placeholder given the image's size (pdfExport sets width and
// height explicitly).

export type PageMapRequest = {
  blocks: ExportBlock[];
  imageSizes: Array<[src: string, size: { width: number; height: number }]>;
  style: DocumentStyle;
};

const PLACEHOLDER_PNG =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

export function layoutPageMapRequest(request: PageMapRequest): Promise<PageMap> {
  const images: ExportImageMap = new Map(
    request.imageSizes.map(([src, size]) => [
      src,
      {
        originalDataUrl: PLACEHOLDER_PNG,
        pngDataUrl: PLACEHOLDER_PNG,
        pngBytes: new Uint8Array(),
        width: size.width,
        height: size.height
      }
    ])
  );

  return layoutPdfPageMap(request.blocks, images, request.style);
}
