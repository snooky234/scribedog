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
 *
 * Called without the vault arguments the images are dropped instead — that is
 * the chat's mode, where nothing may be written to disk and an image would only
 * cost context. Note that leaving mammoth's `convertImage` at its default is
 * not an option there: it inlines every image as a base64 data URI.
 */
export async function convertDocxToMarkdown(
  fileBytes: Uint8Array,
  vaultRoot?: string,
  targetFilePath?: string,
  imageBaseName?: string
): Promise<string> {
  const mammoth = await import("mammoth/mammoth.browser");
  const embedImages =
    vaultRoot !== undefined && targetFilePath !== undefined && imageBaseName !== undefined;

  const result = await mammoth.convertToHtml(
    { arrayBuffer: fileBytes.buffer as ArrayBuffer },
    {
      convertImage: mammoth.images.imgElement(async (image) => {
        if (!embedImages) {
          return { src: "" };
        }

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

  const html = embedImages ? result.value : result.value.replace(/<img[^>]*>/gi, "");

  return convertHtmlToMarkdown(html);
}
