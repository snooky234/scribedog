import { readFile } from "@tauri-apps/plugin-fs";

import {
  getRelativeImageMarkdownPath,
  saveImageToFolder
} from "@/lib/fileSystem";
import { convertHtmlToMarkdown } from "./htmlToMarkdown";

const EXTENSION_BY_MIME: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/gif": "gif",
  "image/webp": "webp",
  "image/bmp": "bmp",
  "image/svg+xml": "svg"
};

function base64ToBytes(base64: string): Uint8Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);

  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }

  return bytes;
}

/**
 * Converts a DOCX file to markdown. Embedded images are written into the
 * vault's root-level "images/" folder and referenced relative to the target
 * markdown file, matching how pasted editor images behave.
 */
export async function convertDocxToMarkdown(
  sourcePath: string,
  vaultRoot: string,
  targetFilePath: string,
  imageBaseName: string
): Promise<string> {
  const mammoth = await import("mammoth/mammoth.browser");
  const fileBytes = await readFile(sourcePath);

  const result = await mammoth.convertToHtml(
    { arrayBuffer: fileBytes.buffer as ArrayBuffer },
    {
      convertImage: mammoth.images.imgElement(async (image) => {
        const base64 = await image.read("base64");
        const mimeType = image.contentType || "image/png";
        const extension = EXTENSION_BY_MIME[mimeType] ?? "png";

        const rootRelativePath = await saveImageToFolder(
          vaultRoot,
          `${imageBaseName}.${extension}`,
          mimeType,
          base64ToBytes(base64)
        );
        const src = await getRelativeImageMarkdownPath(vaultRoot, targetFilePath, rootRelativePath);

        return { src };
      })
    }
  );

  return convertHtmlToMarkdown(result.value);
}
