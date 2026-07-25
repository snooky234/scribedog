import { readFile } from "@tauri-apps/plugin-fs";

import { generateOcrMarkdown } from "@/lib/aiClient";
import { guessImageMimeType } from "@/lib/fileSystem";
import { encodeImageForVision } from "@/lib/imageEncoding";
import { useAiSettingsStore } from "@/store/useAiSettingsStore";

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
  const { base64, mimeType } = await encodeImageForVision(bytes, guessImageMimeType(sourcePath));

  return generateOcrMarkdown(settings, base64, mimeType, signal);
}
