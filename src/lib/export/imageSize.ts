import type { ExportImageAsset } from "./imageAssets";

/**
 * The pixel size an image should occupy in a paged export (PDF/DOCX/ODT).
 *
 * Honors the display width the user set by dragging in the editor (stored in
 * the run, in CSS px), falling back to the image's native width. The result is
 * capped at the printable page width, and the height is derived from the
 * asset's real aspect ratio — so a resized image no longer stretches to the
 * full page width (HTML already did this via a plain width attribute).
 */
export function computeExportImageSize(
  asset: Pick<ExportImageAsset, "width" | "height">,
  displayWidth: number | null,
  maxWidth: number
): { width: number; height: number } {
  const nativeWidth = asset.width || 1;
  const requestedWidth = displayWidth && displayWidth > 0 ? displayWidth : nativeWidth;
  const width = Math.min(requestedWidth, maxWidth);
  const height = (asset.height || 1) * (width / nativeWidth);

  return { width, height };
}

/**
 * The size of an image on a page (PDF and direct print): as above, and in
 * addition no taller than the page's text area. An image cannot be split
 * across pages, so a taller one would either overflow the page or leave it
 * nearly empty; scaled down it always fits one page.
 */
export function computePagedImageSize(
  asset: Pick<ExportImageAsset, "width" | "height">,
  displayWidth: number | null,
  maxWidth: number,
  maxHeight: number
): { width: number; height: number } {
  const size = computeExportImageSize(asset, displayWidth, maxWidth);

  if (size.height <= maxHeight || size.height <= 0) {
    return size;
  }

  return { width: size.width * (maxHeight / size.height), height: maxHeight };
}
