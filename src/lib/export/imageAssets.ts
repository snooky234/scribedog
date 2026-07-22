import { dirname, join } from "@tauri-apps/api/path";
import { readFile } from "@tauri-apps/plugin-fs";

import { ABSOLUTE_URL_PATTERN, guessImageMimeType } from "@/lib/fileSystem";

// Loaded once per exported document: maps the raw markdown src (exactly as it
// appears in the document) to an embeddable representation. PDF/DOCX/ODT get
// PNG bytes with known pixel dimensions (uniform format, avoids per-format
// SVG/WebP support gaps); HTML embeds the original bytes as a data URI.
export type ExportImageAsset = {
  originalDataUrl: string;
  pngDataUrl: string;
  pngBytes: Uint8Array;
  width: number;
  height: number;
};

export type ExportImageMap = Map<string, ExportImageAsset>;

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

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  const chunkSize = 0x8000;

  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize));
  }

  return btoa(binary);
}

function base64ToBytes(base64: string): Uint8Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);

  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }

  return bytes;
}

function loadHtmlImage(dataUrl: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("image load failed"));
    image.src = dataUrl;
  });
}

async function rasterizeToPng(
  dataUrl: string
): Promise<{ pngDataUrl: string; width: number; height: number }> {
  const image = await loadHtmlImage(dataUrl);
  const width = image.naturalWidth || image.width || 1;
  const height = image.naturalHeight || image.height || 1;

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;

  const context = canvas.getContext("2d");

  if (!context) {
    throw new Error("canvas 2d context unavailable");
  }

  context.drawImage(image, 0, 0, width, height);

  return { pngDataUrl: canvas.toDataURL("image/png"), width, height };
}

async function loadImageAsset(absolutePath: string): Promise<ExportImageAsset> {
  const bytes = await readFile(absolutePath);
  const mimeType = guessImageMimeType(absolutePath);
  const originalDataUrl = `data:${mimeType};base64,${bytesToBase64(bytes)}`;
  const { pngDataUrl, width, height } = await rasterizeToPng(originalDataUrl);
  const pngBase64 = pngDataUrl.slice(pngDataUrl.indexOf(",") + 1);

  return {
    originalDataUrl,
    pngDataUrl,
    pngBytes: base64ToBytes(pngBase64),
    width,
    height
  };
}

// Collects every distinct relative image src and loads it relative to the
// markdown file's directory. Remote (http/https/data) srcs and unreadable
// files are skipped — the exporters fall back to the alt text for those.
export async function loadExportImages(
  markdownFilePath: string,
  imageSrcs: Iterable<string>
): Promise<ExportImageMap> {
  const fileDirPath = await dirname(markdownFilePath);
  const assets: ExportImageMap = new Map();

  for (const src of new Set(imageSrcs)) {
    if (!src || ABSOLUTE_URL_PATTERN.test(src)) {
      continue;
    }

    try {
      const absolutePath = await join(fileDirPath, decodeURI(src));
      assets.set(src, await loadImageAsset(absolutePath));
    } catch {
      // Missing or unreadable image — exporters render the alt text instead.
    }
  }

  return assets;
}

export function collectImageSrcs(blocks: import("./markdownModel").ExportBlock[]): string[] {
  const srcs: string[] = [];

  const visitRuns = (runs: import("./markdownModel").InlineRun[]) => {
    for (const run of runs) {
      if (run.kind === "image") {
        srcs.push(run.src);
      }
    }
  };

  const visitBlocks = (list: import("./markdownModel").ExportBlock[]) => {
    for (const block of list) {
      switch (block.kind) {
        case "heading":
        case "paragraph":
          visitRuns(block.runs);
          break;
        case "blockquote":
          visitBlocks(block.children);
          break;
        case "list":
          for (const item of block.items) {
            visitBlocks(item.children);
          }
          break;
        case "table":
          for (const row of block.rows) {
            for (const cell of row) {
              visitRuns(cell.runs);
            }
          }
          break;
        default:
          break;
      }
    }
  };

  visitBlocks(blocks);

  return srcs;
}
