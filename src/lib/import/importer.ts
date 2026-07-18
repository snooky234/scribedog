import { join } from "@tauri-apps/api/path";
import { exists } from "@tauri-apps/plugin-fs";

import { allowFileAccess, writeMarkdownFile } from "@/lib/fileSystem";

export const IMPORT_DOCUMENT_EXTENSIONS = ["docx", "pdf"] as const;
export const IMPORT_IMAGE_EXTENSIONS = ["png", "jpg", "jpeg", "gif", "webp"] as const;

export const IMPORT_FILE_EXTENSIONS = [
  ...IMPORT_DOCUMENT_EXTENSIONS,
  "doc",
  ...IMPORT_IMAGE_EXTENSIONS
];

export type ImportItemStatus = "pending" | "converting" | "done" | "error" | "cancelled";

export type ImportErrorKey =
  | "errorLegacyDoc"
  | "errorUnsupported"
  | "errorConvert"
  | "errorWrite"
  | "errorOcrNoModel"
  | "errorOcrProvider";

export type ImportItemResult = {
  sourcePath: string;
  sourceName: string;
  status: ImportItemStatus;
  createdFilePath?: string;
  errorKey?: ImportErrorKey;
  errorDetail?: string;
};

export type ImportProgress = {
  items: ImportItemResult[];
  completed: number;
  total: number;
};

function getFileName(path: string): string {
  return path.replace(/\\/g, "/").replace(/\/+$/, "").split("/").pop() ?? path;
}

function splitExtension(fileName: string): { base: string; extension: string } {
  const lastDot = fileName.lastIndexOf(".");

  if (lastDot <= 0) {
    return { base: fileName, extension: "" };
  }

  return {
    base: fileName.slice(0, lastDot),
    extension: fileName.slice(lastDot + 1).toLowerCase()
  };
}

// Same "name", "name 2", "name 3" … pattern the store uses for new files.
async function resolveUniqueMarkdownPath(vaultRoot: string, baseName: string): Promise<string> {
  let candidatePath = await join(vaultRoot, `${baseName}.md`);
  let suffix = 2;

  while (await exists(candidatePath)) {
    candidatePath = await join(vaultRoot, `${baseName} ${suffix}.md`);
    suffix += 1;
  }

  return candidatePath;
}

// Windows-reserved characters; mirrors sanitizeExportName in the exporter.
function sanitizeBaseName(name: string): string {
  const sanitized = name
    .replace(/[<>:"/\\|?*\x00-\x1f]/g, "_")
    .replace(/[. ]+$/, "")
    .trim();

  return sanitized || "import";
}

async function convertSourceToMarkdown(
  extension: string,
  sourcePath: string,
  vaultRoot: string,
  targetFilePath: string,
  imageBaseName: string,
  signal?: AbortSignal
): Promise<string> {
  if (extension === "docx") {
    const { convertDocxToMarkdown } = await import("./docxImporter");
    return convertDocxToMarkdown(sourcePath, vaultRoot, targetFilePath, imageBaseName);
  }

  if (extension === "pdf") {
    const { convertPdfToMarkdown } = await import("./pdfImporter");
    return convertPdfToMarkdown(sourcePath, vaultRoot, targetFilePath, imageBaseName, signal);
  }

  const { convertImageToMarkdown } = await import("./imageImporter");
  return convertImageToMarkdown(sourcePath, signal);
}

function isImageExtension(extension: string): boolean {
  return (IMPORT_IMAGE_EXTENSIONS as readonly string[]).includes(extension);
}

function classifyError(extension: string): ImportErrorKey {
  return isImageExtension(extension) ? "errorOcrProvider" : "errorConvert";
}

/**
 * Imports each selected file as one markdown file in the vault root. Every
 * file is handled independently: a failing file is reported per item and
 * never aborts the rest of the batch.
 */
export async function importFiles(
  sourcePaths: string[],
  vaultRoot: string,
  onProgress: (progress: ImportProgress) => void,
  signal?: AbortSignal
): Promise<ImportItemResult[]> {
  const items: ImportItemResult[] = sourcePaths.map((sourcePath) => ({
    sourcePath,
    sourceName: getFileName(sourcePath),
    status: "pending"
  }));

  let completed = 0;

  const reportProgress = () => {
    onProgress({ items: items.map((item) => ({ ...item })), completed, total: items.length });
  };

  reportProgress();

  for (const item of items) {
    if (signal?.aborted) {
      item.status = "cancelled";
      continue;
    }

    const { base, extension } = splitExtension(item.sourceName);

    item.status = "converting";
    reportProgress();

    try {
      if (extension === "doc") {
        item.status = "error";
        item.errorKey = "errorLegacyDoc";
        continue;
      }

      if (
        !(IMPORT_DOCUMENT_EXTENSIONS as readonly string[]).includes(extension) &&
        !isImageExtension(extension)
      ) {
        item.status = "error";
        item.errorKey = "errorUnsupported";
        continue;
      }

      if (isImageExtension(extension)) {
        const { isAiOcrConfigured } = await import("./imageImporter");

        if (!isAiOcrConfigured()) {
          item.status = "error";
          item.errorKey = "errorOcrNoModel";
          continue;
        }
      }

      await allowFileAccess(item.sourcePath).catch(() => undefined);

      const baseName = sanitizeBaseName(base);
      const targetFilePath = await resolveUniqueMarkdownPath(vaultRoot, baseName);

      const markdown = await convertSourceToMarkdown(
        extension,
        item.sourcePath,
        vaultRoot,
        targetFilePath,
        baseName,
        signal
      );

      try {
        await writeMarkdownFile(targetFilePath, markdown);
      } catch (error) {
        item.status = "error";
        item.errorKey = "errorWrite";
        item.errorDetail = error instanceof Error ? error.message : String(error);
        continue;
      }

      item.status = "done";
      item.createdFilePath = targetFilePath;
    } catch (error) {
      if (signal?.aborted) {
        item.status = "cancelled";
      } else {
        item.status = "error";
        item.errorKey = classifyError(extension);
        item.errorDetail = error instanceof Error ? error.message : String(error);
      }
    } finally {
      completed += 1;
      reportProgress();
    }
  }

  return items;
}
