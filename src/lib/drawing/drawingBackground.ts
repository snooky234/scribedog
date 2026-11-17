import type { DrawingBackground } from "@/lib/drawing/drawingSvg";

/**
 * Turns an image file into the background of a drawing (see drawingSvg.ts).
 * The drawing keeps the image's natural size as its own, so the note shows it
 * as large as before; only the embedded data may be smaller. A photo straight
 * off a phone would otherwise make every later edit read and rewrite tens of
 * megabytes for detail that the page never shows.
 */

/** Longest edge the embedded image keeps; larger ones are scaled down for the file only. */
export const MAX_BACKGROUND_EDGE = 2560;

/** Raster formats that can be drawn on, and what a downscaled copy is written as. */
const REENCODE_TYPE_BY_MIME_TYPE: Record<string, string> = {
  "image/png": "image/png",
  "image/jpeg": "image/jpeg",
  "image/webp": "image/webp",
  "image/gif": "image/png",
  "image/bmp": "image/png"
};

/** Formats a data URI in the drawing may hold as they are (see BACKGROUND_DATA_URI_PATTERN). */
const EMBEDDABLE_MIME_TYPES = new Set(["image/png", "image/jpeg", "image/webp", "image/gif"]);

const LOSSY_QUALITY = 0.9;

/** Whether an image of this type can be drawn on. SVG cannot: it is not a raster. */
export function canDrawOnMimeType(mimeType: string): boolean {
  return Object.prototype.hasOwnProperty.call(REENCODE_TYPE_BY_MIME_TYPE, mimeType);
}

/** The pixel size the embedded copy gets: unchanged up to the limit, else scaled to fit it. */
export function embeddedRasterSize(
  width: number,
  height: number,
  maxEdge: number = MAX_BACKGROUND_EDGE
): { width: number; height: number } {
  const longest = Math.max(width, height);

  if (longest <= maxEdge) {
    return { width, height };
  }

  const scale = maxEdge / longest;
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale))
  };
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  const chunkSize = 0x8000;

  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize));
  }

  return btoa(binary);
}

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("image could not be decoded"));
    image.src = url;
  });
}

/**
 * The background for drawing on the image in `data`. The original bytes are
 * embedded unchanged where the format allows and the size is within the
 * limit, so nothing is lost by drawing on a picture; otherwise a re-encoded
 * copy is.
 */
export async function createDrawingBackground(data: Uint8Array, mimeType: string): Promise<DrawingBackground> {
  const targetType = canDrawOnMimeType(mimeType) ? REENCODE_TYPE_BY_MIME_TYPE[mimeType] : null;

  if (!targetType) {
    throw new Error(`unsupported image type ${mimeType}`);
  }

  const url = URL.createObjectURL(new Blob([data], { type: mimeType }));

  try {
    const image = await loadImage(url);
    const width = image.naturalWidth;
    const height = image.naturalHeight;

    if (width <= 0 || height <= 0) {
      throw new Error("image has no size");
    }

    const raster = embeddedRasterSize(width, height);

    if (raster.width === width && raster.height === height && EMBEDDABLE_MIME_TYPES.has(mimeType)) {
      return { href: `data:${mimeType};base64,${bytesToBase64(data)}`, width, height };
    }

    const canvas = document.createElement("canvas");
    canvas.width = raster.width;
    canvas.height = raster.height;
    const context = canvas.getContext("2d");

    if (!context) {
      throw new Error("canvas 2d context unavailable");
    }

    context.imageSmoothingQuality = "high";
    context.drawImage(image, 0, 0, raster.width, raster.height);
    const href = canvas.toDataURL(targetType, targetType === "image/png" ? undefined : LOSSY_QUALITY);

    // A webview that cannot write WebP answers with PNG, which is fine.
    return { href, width, height };
  } finally {
    URL.revokeObjectURL(url);
  }
}
