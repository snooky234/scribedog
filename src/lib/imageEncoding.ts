// Shared image → base64 encoding for every vision request in the app: the
// OCR import path (src/lib/import/imageImporter.ts) and the chat agent's
// get_image tool (src/lib/chat/imageAttachments.ts). Both need the exact same
// downscaling, so it lives here once rather than being duplicated per caller.

// Anthropic's recommended maximum edge; also keeps local vision models fast.
const MAX_IMAGE_EDGE_PX = 1568;

// Byte budget above which an image is re-encoded as JPEG even when its
// dimensions are already fine. A photo stored as PNG is what this exists for:
// 1.7 MB of PNG become 2.3 MB of base64 in the request body, and a cloud
// provider answers a body that size with 413 (Mistral's comes back with an
// empty body) — the same picture as JPEG is well under 200 KB. Below the
// budget the original bytes are kept byte for byte, so text screenshots and
// diagrams stay lossless for the OCR import path.
const MAX_IMAGE_BYTES = 900_000;
const JPEG_QUALITY = 0.85;

export type EncodedImage = { base64: string; mimeType: string };

export function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  const chunkSize = 0x8000;

  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize));
  }

  return btoa(binary);
}

/**
 * Encodes image bytes for a vision request, downscaling oversized images and
 * re-encoding oversized payloads first, so huge screenshots/scans/photos do not
 * blow the request or context size. Falls back to the original bytes when
 * decoding fails (e.g. unsupported format) — the provider's own error is a
 * better signal than a local guess.
 */
export async function encodeImageForVision(
  bytes: Uint8Array,
  mimeType: string
): Promise<EncodedImage> {
  try {
    const blob = new Blob([bytes.buffer as ArrayBuffer], { type: mimeType });
    const bitmap = await createImageBitmap(blob);
    const largestEdge = Math.max(bitmap.width, bitmap.height);
    const scale = Math.min(1, MAX_IMAGE_EDGE_PX / largestEdge);

    if (scale === 1 && bytes.length <= MAX_IMAGE_BYTES) {
      bitmap.close();
      return { base64: bytesToBase64(bytes), mimeType };
    }

    const canvas = document.createElement("canvas");
    canvas.width = Math.round(bitmap.width * scale);
    canvas.height = Math.round(bitmap.height * scale);

    const context = canvas.getContext("2d");

    if (!context) {
      bitmap.close();
      return { base64: bytesToBase64(bytes), mimeType };
    }

    // JPEG carries no alpha channel, so transparency is flattened onto white
    // first — the way any viewer shows it. Without this, transparent areas
    // come out black and a model reads the picture wrong.
    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    bitmap.close();

    const encodedBlob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, "image/jpeg", JPEG_QUALITY)
    );

    if (!encodedBlob) {
      return { base64: bytesToBase64(bytes), mimeType };
    }

    const encodedBytes = new Uint8Array(await encodedBlob.arrayBuffer());

    // Re-encoding something that was only over the byte budget can come out
    // bigger than it went in (screenshots of text compress better as PNG) —
    // then the original is the better payload after all.
    if (scale === 1 && encodedBytes.length >= bytes.length) {
      return { base64: bytesToBase64(bytes), mimeType };
    }

    return { base64: bytesToBase64(encodedBytes), mimeType: "image/jpeg" };
  } catch {
    return { base64: bytesToBase64(bytes), mimeType };
  }
}
