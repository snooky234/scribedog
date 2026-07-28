import { join } from "@tauri-apps/api/path";
import { exists, mkdir } from "@tauri-apps/plugin-fs";

import { writeMarkdownFile } from "@/lib/fileSystem";
import { snapshotFileVersion } from "@/store/appStore/versioning";
import {
  CONVERTIBLE_EXTENSIONS,
  SourceTooLargeError,
  classifyExtension,
  convertToMarkdown,
  extensionOf,
  type ConvertSource
} from "./convert";

// What the file dialog offers. The conversion itself is decided in convert.ts,
// which is also what the drag-and-drop path filters against.
export const IMPORT_FILE_EXTENSIONS = [...CONVERTIBLE_EXTENSIONS, "doc"];

export type ImportItemStatus = "pending" | "converting" | "done" | "error" | "cancelled";

export type ImportErrorKey =
  | "errorLegacyDoc"
  | "errorUnsupported"
  | "errorTooLarge"
  | "errorConvert"
  | "errorWrite"
  | "errorOcrNoModel"
  | "errorOcrProvider";

/**
 * One file to import. `relativeDirectory` is the folder structure to recreate
 * below the import target — set when a whole folder was dropped, so a nested
 * PDF lands in a matching subfolder instead of being flattened into the target.
 */
export type ImportSource = {
  source: ConvertSource;
  relativeDirectory?: string;
};

export type ImportItemResult = {
  /** Stable per batch, so two files of the same name stay distinguishable. */
  id: string;
  sourceName: string;
  /** What the dialog shows: the name, prefixed by its folder inside a drop. */
  label: string;
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

function baseNameOf(fileName: string): string {
  const lastDot = fileName.lastIndexOf(".");

  return lastDot <= 0 ? fileName : fileName.slice(0, lastDot);
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

// Applied per segment so a dropped folder's own name cannot smuggle a "..",
// an absolute path or a reserved character into the vault.
async function resolveTargetDirectory(
  targetDirectory: string,
  relativeDirectory: string | undefined
): Promise<string> {
  const segments = (relativeDirectory ?? "")
    .replace(/\\/g, "/")
    .split("/")
    .filter((segment) => segment !== "" && segment !== "." && segment !== "..")
    .map(sanitizeBaseName);

  if (segments.length === 0) {
    return targetDirectory;
  }

  const directory = await join(targetDirectory, ...segments);

  await mkdir(directory, { recursive: true });

  return directory;
}

function classifyError(extension: string): ImportErrorKey {
  return classifyExtension(extension) === "image" ? "errorOcrProvider" : "errorConvert";
}

/**
 * Imports each source as one markdown file into targetDirectory (defaults to
 * the vault root when the caller has no more specific folder selected).
 * vaultRoot stays the actual vault root throughout — it is what anchors the
 * shared images/ folder and the version history, regardless of which subfolder
 * the new note lands in. Every file is handled independently: a failing file is
 * reported per item and never aborts the rest of the batch.
 */
export async function importFiles(
  sources: readonly ImportSource[],
  vaultRoot: string,
  targetDirectory: string,
  onProgress: (progress: ImportProgress) => void,
  signal?: AbortSignal
): Promise<ImportItemResult[]> {
  const items: ImportItemResult[] = sources.map((entry, index) => ({
    id: `${index}-${entry.source.name}`,
    sourceName: entry.source.name,
    label: entry.relativeDirectory
      ? `${entry.relativeDirectory}/${entry.source.name}`
      : entry.source.name,
    status: "pending"
  }));

  let completed = 0;

  const reportProgress = () => {
    onProgress({ items: items.map((item) => ({ ...item })), completed, total: items.length });
  };

  reportProgress();

  for (const [index, item] of items.entries()) {
    if (signal?.aborted) {
      item.status = "cancelled";
      continue;
    }

    const extension = extensionOf(item.sourceName);
    const kind = classifyExtension(extension);

    item.status = "converting";
    reportProgress();

    try {
      if (kind === "legacyDoc") {
        item.status = "error";
        item.errorKey = "errorLegacyDoc";
        continue;
      }

      if (kind === "unsupported") {
        item.status = "error";
        item.errorKey = "errorUnsupported";
        continue;
      }

      if (kind === "image") {
        const { isAiOcrConfigured } = await import("./imageImporter");

        if (!isAiOcrConfigured()) {
          item.status = "error";
          item.errorKey = "errorOcrNoModel";
          continue;
        }
      }

      const baseName = sanitizeBaseName(baseNameOf(item.sourceName));
      const directory = await resolveTargetDirectory(
        targetDirectory,
        sources[index].relativeDirectory
      );
      const targetFilePath = await resolveUniqueMarkdownPath(directory, baseName);

      const markdown = await convertToMarkdown(
        sources[index].source,
        { embedImages: true, vaultRoot, targetFilePath, imageBaseName: baseName },
        signal
      );

      try {
        await writeMarkdownFile(targetFilePath, markdown);
        // Keeps the "as imported" state restorable after the first edits.
        snapshotFileVersion(vaultRoot, targetFilePath, markdown);
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
        item.errorKey =
          error instanceof SourceTooLargeError ? "errorTooLarge" : classifyError(extension);
        item.errorDetail = error instanceof Error ? error.message : String(error);
      }
    } finally {
      completed += 1;
      reportProgress();
    }
  }

  return items;
}
