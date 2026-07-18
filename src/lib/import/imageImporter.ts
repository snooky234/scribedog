import { readFile } from "@tauri-apps/plugin-fs";

import { generateOcrMarkdown } from "@/lib/aiClient";
import { guessImageMimeType } from "@/lib/fileSystem";
import { useAiSettingsStore } from "@/store/useAiSettingsStore";

// Anthropic's recommended maximum edge; also keeps local vision models fast.
const MAX_IMAGE_EDGE_PX = 1568;

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  const chunkSize = 0x8000;

  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize));
  }

  return btoa(binary);
}

// Downscales oversized images before sending them to the model so huge
// screenshots/scans do not blow the request or context size. Falls back to
// the original bytes when decoding fails (e.g. unsupported format).
async function prepareImageForOcr(
  bytes: Uint8Array,
  mimeType: string
): Promise<{ base64: string; mimeType: string }> {
  try {
    const blob = new Blob([bytes.buffer as ArrayBuffer], { type: mimeType });
    const bitmap = await createImageBitmap(blob);
    const largestEdge = Math.max(bitmap.width, bitmap.height);

    if (largestEdge <= MAX_IMAGE_EDGE_PX) {
      bitmap.close();
      return { base64: bytesToBase64(bytes), mimeType };
    }

    const scale = MAX_IMAGE_EDGE_PX / largestEdge;
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(bitmap.width * scale);
    canvas.height = Math.round(bitmap.height * scale);

    const context = canvas.getContext("2d");

    if (!context) {
      bitmap.close();
      return { base64: bytesToBase64(bytes), mimeType };
    }

    context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    bitmap.close();

    const scaledBlob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, "image/png")
    );

    if (!scaledBlob) {
      return { base64: bytesToBase64(bytes), mimeType };
    }

    const scaledBytes = new Uint8Array(await scaledBlob.arrayBuffer());

    return { base64: bytesToBase64(scaledBytes), mimeType: "image/png" };
  } catch {
    return { base64: bytesToBase64(bytes), mimeType };
  }
}

export function isAiOcrConfigured(): boolean {
  const { settings } = useAiSettingsStore.getState();
  return settings.model.trim().length > 0;
}

/**
 * Transcribes a standalone image file to markdown through the configured AI
 * model. Vision support is not checked upfront — a provider error is thrown
 * and surfaced per file by the import dialog.
 */
export async function convertImageToMarkdown(
  sourcePath: string,
  signal?: AbortSignal
): Promise<string> {
  const { settings } = useAiSettingsStore.getState();
  const bytes = await readFile(sourcePath);
  const { base64, mimeType } = await prepareImageForOcr(bytes, guessImageMimeType(sourcePath));

  return generateOcrMarkdown(settings, base64, mimeType, signal);
}
