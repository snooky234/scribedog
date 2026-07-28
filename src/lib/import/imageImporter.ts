import { generateOcrMarkdown } from "@/lib/aiClient";
import { guessImageMimeType } from "@/lib/fileSystem";
import { encodeImageForVision } from "@/lib/imageEncoding";
import { useAiSettingsStore } from "@/store/useAiSettingsStore";

export function isAiOcrConfigured(): boolean {
  const { settings } = useAiSettingsStore.getState();
  return settings.model.trim().length > 0;
}

/**
 * Transcribes a standalone image to markdown through the configured AI model.
 * Vision support is not checked upfront — a provider error is thrown and
 * surfaced per file by the import dialog. `fileName` only serves to derive the
 * MIME type.
 */
export async function convertImageToMarkdown(
  bytes: Uint8Array,
  fileName: string,
  signal?: AbortSignal
): Promise<string> {
  const { settings } = useAiSettingsStore.getState();
  const { base64, mimeType } = await encodeImageForVision(bytes, guessImageMimeType(fileName));

  return generateOcrMarkdown(settings, base64, mimeType, signal);
}
