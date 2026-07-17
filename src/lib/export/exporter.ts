import { join } from "@tauri-apps/api/path";
import { exists, mkdir, writeFile, writeTextFile } from "@tauri-apps/plugin-fs";

import { allowMarkdownFolderAccess, listMarkdownFiles } from "@/lib/fileSystem";
import { collectImageSrcs, loadExportImages } from "./imageAssets";
import { parseMarkdownToBlocks } from "./markdownModel";

export const EXPORT_FORMATS = ["pdf", "docx", "odt", "html"] as const;

export type ExportFormat = (typeof EXPORT_FORMATS)[number];

export type ConflictDecision = "overwrite" | "skip" | "cancel";

export type ConflictResolution = {
  decision: ConflictDecision;
  // Folder export only: apply the same decision to all remaining conflicts.
  applyToAll: boolean;
};

// Called when the target file already exists; the UI asks the user.
export type ConflictResolver = (targetFileName: string) => Promise<ConflictResolution>;

export type ExportProgress = {
  completed: number;
  total: number;
  currentFileName: string;
};

export type ExportOutcome = {
  exportedCount: number;
  skippedCount: number;
  cancelled: boolean;
};

// Content lookup so unsaved editor changes can be exported instead of the
// stale on-disk state (App.tsx consults the in-memory document map first).
export type MarkdownReader = (filePath: string) => Promise<string>;

const LAST_EXPORT_DIRECTORY_STORAGE_KEY = "scribedog:lastExportDirectory";
const LAST_EXPORT_FORMAT_STORAGE_KEY = "scribedog:lastExportFormat";

export function getLastExportDirectory(): string | null {
  try {
    return window.localStorage.getItem(LAST_EXPORT_DIRECTORY_STORAGE_KEY);
  } catch {
    return null;
  }
}

export function setLastExportDirectory(directory: string): void {
  try {
    window.localStorage.setItem(LAST_EXPORT_DIRECTORY_STORAGE_KEY, directory);
  } catch {
    // localStorage may be unavailable — remembering the folder is optional.
  }
}

export function getLastExportFormat(): ExportFormat {
  try {
    const stored = window.localStorage.getItem(LAST_EXPORT_FORMAT_STORAGE_KEY);
    return EXPORT_FORMATS.includes(stored as ExportFormat) ? (stored as ExportFormat) : "pdf";
  } catch {
    return "pdf";
  }
}

export function setLastExportFormat(format: ExportFormat): void {
  try {
    window.localStorage.setItem(LAST_EXPORT_FORMAT_STORAGE_KEY, format);
  } catch {
    // Optional convenience only.
  }
}

// Windows-reserved characters; keeps the name usable on all platforms.
export function sanitizeExportName(name: string): string {
  const sanitized = name
    .replace(/[<>:"/\\|?*\x00-\x1f]/g, "_")
    .replace(/[. ]+$/, "")
    .trim();

  return sanitized || "export";
}

async function renderExportBytes(
  format: ExportFormat,
  title: string,
  markdown: string,
  markdownFilePath: string
): Promise<{ bytes?: Uint8Array; text?: string }> {
  const blocks = parseMarkdownToBlocks(markdown);
  const images = await loadExportImages(markdownFilePath, collectImageSrcs(blocks));

  // Dynamic imports keep the heavyweight format libraries (pdfmake, docx,
  // fflate) out of the startup bundle — they load on first export only.
  switch (format) {
    case "html": {
      const { renderHtmlDocument } = await import("./htmlExport");
      return { text: renderHtmlDocument(title, blocks, images) };
    }
    case "pdf": {
      const { renderPdfDocument } = await import("./pdfExport");
      return { bytes: await renderPdfDocument(title, blocks, images) };
    }
    case "docx": {
      const { renderDocxDocument } = await import("./docxExport");
      return { bytes: await renderDocxDocument(title, blocks, images) };
    }
    case "odt": {
      const { renderOdtDocument } = await import("./odtExport");
      return { bytes: renderOdtDocument(blocks, images) };
    }
  }
}

async function writeExportFile(
  targetPath: string,
  rendered: { bytes?: Uint8Array; text?: string }
): Promise<void> {
  if (rendered.text !== undefined) {
    await writeTextFile(targetPath, rendered.text);
  } else if (rendered.bytes) {
    await writeFile(targetPath, rendered.bytes);
  }
}

export type SingleExportInput = {
  markdownFilePath: string;
  format: ExportFormat;
  targetDirectory: string;
  baseName: string;
  readMarkdown: MarkdownReader;
  onConflict: ConflictResolver;
};

export async function exportSingleNote(input: SingleExportInput): Promise<ExportOutcome> {
  const { markdownFilePath, format, targetDirectory, baseName, readMarkdown, onConflict } = input;

  await allowMarkdownFolderAccess(targetDirectory);

  const fileName = `${sanitizeExportName(baseName)}.${format}`;
  const targetPath = await join(targetDirectory, fileName);

  if (await exists(targetPath)) {
    const { decision } = await onConflict(fileName);

    if (decision === "cancel") {
      return { exportedCount: 0, skippedCount: 0, cancelled: true };
    }

    if (decision === "skip") {
      return { exportedCount: 0, skippedCount: 1, cancelled: false };
    }
  }

  const markdown = await readMarkdown(markdownFilePath);
  const rendered = await renderExportBytes(format, sanitizeExportName(baseName), markdown, markdownFilePath);
  await writeExportFile(targetPath, rendered);
  setLastExportDirectory(targetDirectory);
  setLastExportFormat(format);

  return { exportedCount: 1, skippedCount: 0, cancelled: false };
}

export type FolderExportInput = {
  sourceFolderPath: string;
  format: ExportFormat;
  targetDirectory: string;
  folderName: string;
  readMarkdown: MarkdownReader;
  onConflict: ConflictResolver;
  onProgress?: (progress: ExportProgress) => void;
};

// Exports every note under the folder, preserving the subfolder structure.
// An existing target folder is merged into (per the issue: never replaced);
// per-file conflicts go through the resolver, honoring "apply to all".
export async function exportFolderNotes(input: FolderExportInput): Promise<ExportOutcome> {
  const {
    sourceFolderPath,
    format,
    targetDirectory,
    folderName,
    readMarkdown,
    onConflict,
    onProgress
  } = input;

  await allowMarkdownFolderAccess(targetDirectory);

  const records = await listMarkdownFiles(sourceFolderPath);
  const exportRootPath = await join(targetDirectory, sanitizeExportName(folderName));

  await mkdir(exportRootPath, { recursive: true });

  let exportedCount = 0;
  let skippedCount = 0;
  let blanketDecision: Extract<ConflictDecision, "overwrite" | "skip"> | null = null;

  for (const [index, record] of records.entries()) {
    const relativeSegments = record.relativePath.split("/");
    const noteFileName = relativeSegments.pop() ?? record.relativePath;
    const baseName = sanitizeExportName(noteFileName.replace(/\.md$/i, ""));
    const targetFileName = `${baseName}.${format}`;

    onProgress?.({
      completed: index,
      total: records.length,
      currentFileName: targetFileName
    });

    let targetDirectoryPath = exportRootPath;

    for (const segment of relativeSegments) {
      targetDirectoryPath = await join(targetDirectoryPath, sanitizeExportName(segment));
    }

    await mkdir(targetDirectoryPath, { recursive: true });

    const targetPath = await join(targetDirectoryPath, targetFileName);

    if (await exists(targetPath)) {
      let decision: ConflictDecision;

      if (blanketDecision) {
        decision = blanketDecision;
      } else {
        const resolution = await onConflict(
          relativeSegments.length > 0
            ? `${relativeSegments.join("/")}/${targetFileName}`
            : targetFileName
        );
        decision = resolution.decision;

        if (resolution.applyToAll && decision !== "cancel") {
          blanketDecision = decision;
        }
      }

      if (decision === "cancel") {
        return { exportedCount, skippedCount, cancelled: true };
      }

      if (decision === "skip") {
        skippedCount += 1;
        continue;
      }
    }

    const markdown = await readMarkdown(record.filePath);
    const rendered = await renderExportBytes(format, baseName, markdown, record.filePath);
    await writeExportFile(targetPath, rendered);
    exportedCount += 1;
  }

  onProgress?.({ completed: records.length, total: records.length, currentFileName: "" });
  setLastExportDirectory(targetDirectory);
  setLastExportFormat(format);

  return { exportedCount, skippedCount, cancelled: false };
}

export async function countExportableNotes(sourceFolderPath: string): Promise<number> {
  const records = await listMarkdownFiles(sourceFolderPath);
  return records.length;
}

export function getDefaultExportBaseName(path: string): string {
  const fileName = path.replace(/\\/g, "/").replace(/\/+$/, "").split("/").pop() ?? path;
  return fileName.replace(/\.md$/i, "");
}
