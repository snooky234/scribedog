import { join } from "@/platform/paths";
import { platform, PlatformUnavailableError, requireLocalFs } from "@/platform";

import { listMarkdownFiles, type MarkdownFileRecord } from "@/lib/fileSystem";
import { buildFileTree, type FileTreeNode } from "@/lib/fileTree";
import { getNoteDisplayName } from "@/lib/folderNotes";
import { DEFAULT_DOCUMENT_STYLE, type DocumentStyle } from "@/lib/fonts";
import type { ManualOrderMap, SortMode } from "@/lib/vaultMeta";

import { numberExportBlockLists, numberExportBlocks } from "./headingNumbers";
import { embedDiagrams } from "./diagramAssets";
import { collectImageSrcs, loadExportImages, type ExportImageMap } from "./imageAssets";
import {
  compileManuscript,
  type CompiledManuscript,
  type ManuscriptOptions,
  type ManuscriptSource
} from "./manuscript";
import { parseMarkdownToBlocks, type ExportBlock } from "./markdownModel";
import { addArchiveEntry, buildZipArchive, createArchive, mimeTypeFor } from "./zipArchive";

/** Formats available when every note becomes its own file. */
export const EXPORT_FORMATS = ["pdf", "docx", "odt", "html"] as const;

/**
 * Formats available when the notes are merged into one document. EPUB is only
 * here: a book made of one note per file would be a folder full of one-chapter
 * e-books, which is never what anyone wants.
 */
export const MERGED_EXPORT_FORMATS = [...EXPORT_FORMATS, "epub"] as const;

export type ExportFormat = (typeof MERGED_EXPORT_FORMATS)[number];

export function isMergedOnlyFormat(format: ExportFormat): boolean {
  return !(EXPORT_FORMATS as readonly string[]).includes(format);
}

/**
 * Where an export goes. "folder" is the desktop's export into a directory
 * the user picked, one file per note with a conflict prompt for each file
 * already there. "download" hands the result to `platform.downloads`: a
 * single document as it is, many documents packed into one ZIP, and never
 * a conflict prompt, because the browser (or the save dialog) settles the
 * name. The rendering is the same either way; only the last step differs.
 */
export type ExportDestination = { kind: "folder"; directory: string } | { kind: "download" };

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
    return MERGED_EXPORT_FORMATS.includes(stored as ExportFormat)
      ? (stored as ExportFormat)
      : "pdf";
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

type RenderedExport = { bytes?: Uint8Array; text?: string };

// Dynamic imports keep the heavyweight format libraries (pdfmake, docx,
// fflate) out of the startup bundle — they load on first export only.
async function renderBlocksAs(
  format: ExportFormat,
  title: string,
  sourceBlocks: ExportBlock[],
  images: ExportImageMap,
  style: DocumentStyle
): Promise<RenderedExport> {
  // Numbered once here, so every format below — and a merged manuscript,
  // whose chapters share one sequence — gets the same numbers as the editor.
  const blocks = numberExportBlocks(sourceBlocks, style.headingNumbering);

  switch (format) {
    case "html": {
      const { renderHtmlDocument } = await import("./htmlExport");
      return { text: renderHtmlDocument(title, blocks, images, style) };
    }
    case "pdf": {
      const { renderPdfDocument } = await import("./pdfExport");
      return { bytes: await renderPdfDocument(title, blocks, images, style) };
    }
    case "docx": {
      const { renderDocxDocument } = await import("./docxExport");
      return { bytes: await renderDocxDocument(title, blocks, images, style) };
    }
    case "odt": {
      const { renderOdtDocument } = await import("./odtExport");
      return { bytes: renderOdtDocument(blocks, images, style) };
    }
    case "epub":
      // Guarded by the dialog, which only offers EPUB in merged mode; a single
      // block list carries no chapter structure for a spine.
      throw new Error("EPUB requires a merged manuscript export");
  }
}

async function renderExportBytes(
  format: ExportFormat,
  title: string,
  markdown: string,
  markdownFilePath: string,
  style: DocumentStyle
): Promise<RenderedExport> {
  const parsed = parseMarkdownToBlocks(markdown);
  const images = await loadExportImages(markdownFilePath, collectImageSrcs(parsed));
  const blocks = await embedDiagrams(parsed, images);

  return renderBlocksAs(format, title, blocks, images, style);
}

async function writeExportFile(
  targetPath: string,
  rendered: { bytes?: Uint8Array; text?: string }
): Promise<void> {
  if (rendered.text !== undefined) {
    await requireLocalFs().writeTextFile(targetPath, rendered.text);
  } else if (rendered.bytes) {
    await requireLocalFs().writeFile(targetPath, rendered.bytes);
  }
}

/**
 * Widens the shell's filesystem scope to the target folder. Only that: the
 * vault stays whatever is open (`allowMarkdownFolderAccess` would also
 * switch the active storage to the target, which for a server vault on the
 * desktop would cut the export off from the notes it is about to read).
 */
async function allowExportFolder(directory: string): Promise<void> {
  await platform.vault.allowFolderAccess(directory);
}

function requireDownloads() {
  if (!platform.downloads) {
    throw new PlatformUnavailableError();
  }

  return platform.downloads;
}

/** Hands one finished file to the platform; false when the user cancelled the save dialog. */
async function downloadRendered(fileName: string, rendered: RenderedExport): Promise<boolean> {
  const data = rendered.text ?? rendered.bytes;

  if (data === undefined) {
    return false;
  }

  return requireDownloads().saveFile({ fileName, data, mimeType: mimeTypeFor(fileName) });
}

function rememberDestination(destination: ExportDestination, format: ExportFormat): void {
  if (destination.kind === "folder") {
    setLastExportDirectory(destination.directory);
  }

  setLastExportFormat(format);
}

/**
 * The folder half of a single-document export: where the file goes, and
 * whether the user wants an existing one written over. An outcome instead
 * of a path means the export stops here (cancelled or skipped).
 */
async function prepareSingleTarget(
  directory: string,
  fileName: string,
  onConflict: ConflictResolver
): Promise<{ targetPath: string } | { outcome: ExportOutcome }> {
  await allowExportFolder(directory);

  const targetPath = await join(directory, fileName);

  if (await requireLocalFs().exists(targetPath)) {
    const { decision } = await onConflict(fileName);

    if (decision === "cancel") {
      return { outcome: { exportedCount: 0, skippedCount: 0, cancelled: true } };
    }

    if (decision === "skip") {
      return { outcome: { exportedCount: 0, skippedCount: 1, cancelled: false } };
    }
  }

  return { targetPath };
}

export type SingleExportInput = {
  markdownFilePath: string;
  format: ExportFormat;
  destination: ExportDestination;
  baseName: string;
  readMarkdown: MarkdownReader;
  onConflict: ConflictResolver;
  style?: DocumentStyle;
};

export async function exportSingleNote(input: SingleExportInput): Promise<ExportOutcome> {
  const {
    markdownFilePath,
    format,
    destination,
    baseName,
    readMarkdown,
    onConflict,
    style = DEFAULT_DOCUMENT_STYLE
  } = input;

  const fileName = `${sanitizeExportName(baseName)}.${format}`;
  let targetPath: string | null = null;

  if (destination.kind === "folder") {
    const prepared = await prepareSingleTarget(destination.directory, fileName, onConflict);

    if ("outcome" in prepared) {
      return prepared.outcome;
    }

    targetPath = prepared.targetPath;
  }

  const markdown = await readMarkdown(markdownFilePath);
  const rendered = await renderExportBytes(
    format,
    sanitizeExportName(baseName),
    markdown,
    markdownFilePath,
    style
  );

  if (targetPath !== null) {
    await writeExportFile(targetPath, rendered);
  } else if (!(await downloadRendered(fileName, rendered))) {
    return { exportedCount: 0, skippedCount: 0, cancelled: true };
  }

  rememberDestination(destination, format);

  return { exportedCount: 1, skippedCount: 0, cancelled: false };
}

export type FolderExportInput = {
  sourceFolderPath: string;
  format: ExportFormat;
  destination: ExportDestination;
  folderName: string;
  readMarkdown: MarkdownReader;
  onConflict: ConflictResolver;
  onProgress?: (progress: ExportProgress) => void;
  style?: DocumentStyle;
};

/**
 * The two ways a list of rendered notes leaves the app. The folder sink
 * writes each note into the target tree (creating folders, asking about
 * files already there, honouring "apply to all"); the archive sink collects
 * them and hands one ZIP to the platform at the end. `prepare` runs before
 * the note is rendered, so a skipped file is never rendered for nothing.
 */
type RecordSink = {
  prepare(relativeSegments: string[], fileName: string): Promise<ConflictDecision>;
  write(relativeSegments: string[], fileName: string, rendered: RenderedExport): Promise<void>;
  /** Once, after the last note; false if the user cancelled the download's save dialog. */
  finish(): Promise<boolean>;
};

function createFolderSink(exportRootPath: string, onConflict: ConflictResolver): RecordSink {
  let blanketDecision: Extract<ConflictDecision, "overwrite" | "skip"> | null = null;

  const targetPathFor = async (relativeSegments: string[], fileName: string) => {
    let targetDirectoryPath = exportRootPath;

    for (const segment of relativeSegments) {
      targetDirectoryPath = await join(targetDirectoryPath, sanitizeExportName(segment));
    }

    return { targetDirectoryPath, targetPath: await join(targetDirectoryPath, fileName) };
  };

  return {
    async prepare(relativeSegments, fileName) {
      const { targetDirectoryPath, targetPath } = await targetPathFor(relativeSegments, fileName);

      await requireLocalFs().mkdir(targetDirectoryPath, { recursive: true });

      if (!(await requireLocalFs().exists(targetPath))) {
        return "overwrite";
      }

      if (blanketDecision) {
        return blanketDecision;
      }

      const resolution = await onConflict(
        relativeSegments.length > 0 ? `${relativeSegments.join("/")}/${fileName}` : fileName
      );

      if (resolution.applyToAll && resolution.decision !== "cancel") {
        blanketDecision = resolution.decision;
      }

      return resolution.decision;
    },
    async write(relativeSegments, fileName, rendered) {
      const { targetPath } = await targetPathFor(relativeSegments, fileName);
      await writeExportFile(targetPath, rendered);
    },
    finish: async () => true
  };
}

function createArchiveSink(archiveName: string): RecordSink {
  const entries = createArchive();

  return {
    prepare: async () => "overwrite",
    async write(relativeSegments, fileName, rendered) {
      const path = [...relativeSegments.map(sanitizeExportName), fileName].join("/");
      addArchiveEntry(entries, path, rendered.text ?? rendered.bytes ?? new Uint8Array());
    },
    finish: () => {
      const fileName = `${sanitizeExportName(archiveName)}.zip`;

      return requireDownloads().saveFile({
        fileName,
        data: buildZipArchive(entries),
        mimeType: mimeTypeFor(fileName)
      });
    }
  };
}

type ExportRecordsInput = {
  records: MarkdownFileRecord[];
  format: ExportFormat;
  sink: RecordSink;
  readMarkdown: MarkdownReader;
  onProgress?: (progress: ExportProgress) => void;
  style: DocumentStyle;
};

// Shared render/conflict/progress core for exporting a resolved list of notes
// (each with a relativePath under the export root) — used by both the
// single-folder export and the multi-selection export.
async function writeExportRecords(input: ExportRecordsInput): Promise<ExportOutcome> {
  const { records, format, sink, readMarkdown, onProgress, style } = input;

  let exportedCount = 0;
  let skippedCount = 0;

  for (const [index, record] of records.entries()) {
    const relativeSegments = record.relativePath.split("/");
    relativeSegments.pop();
    // A folder note is exported into its folder under the folder's name
    // ("Rezepte/Rezepte.html"), not under the reserved file name.
    const baseName = sanitizeExportName(getNoteDisplayName(record.relativePath));
    const targetFileName = `${baseName}.${format}`;

    onProgress?.({
      completed: index,
      total: records.length,
      currentFileName: targetFileName
    });

    const decision = await sink.prepare(relativeSegments, targetFileName);

    if (decision === "cancel") {
      return { exportedCount, skippedCount, cancelled: true };
    }

    if (decision === "skip") {
      skippedCount += 1;
      continue;
    }

    const markdown = await readMarkdown(record.filePath);
    const rendered = await renderExportBytes(format, baseName, markdown, record.filePath, style);
    await sink.write(relativeSegments, targetFileName, rendered);
    exportedCount += 1;
  }

  onProgress?.({ completed: records.length, total: records.length, currentFileName: "" });

  if (!(await sink.finish())) {
    return { exportedCount, skippedCount, cancelled: true };
  }

  return { exportedCount, skippedCount, cancelled: false };
}

/**
 * The sink for a many-notes export: the folder `<directory>/<folderName>`
 * (merged into if it exists, never replaced), or a ZIP of that name.
 */
async function createRecordSink(
  destination: ExportDestination,
  folderName: string,
  onConflict: ConflictResolver
): Promise<RecordSink> {
  if (destination.kind === "download") {
    return createArchiveSink(folderName);
  }

  await allowExportFolder(destination.directory);

  const exportRootPath = await join(destination.directory, sanitizeExportName(folderName));
  await requireLocalFs().mkdir(exportRootPath, { recursive: true });

  return createFolderSink(exportRootPath, onConflict);
}

// Exports every note under the folder, preserving the subfolder structure.
// An existing target folder is merged into (per the issue: never replaced);
// per-file conflicts go through the resolver, honoring "apply to all".
export async function exportFolderNotes(input: FolderExportInput): Promise<ExportOutcome> {
  const {
    sourceFolderPath,
    format,
    destination,
    folderName,
    readMarkdown,
    onConflict,
    onProgress,
    style = DEFAULT_DOCUMENT_STYLE
  } = input;

  const sink = await createRecordSink(destination, folderName, onConflict);
  const records = await listMarkdownFiles(sourceFolderPath);

  const outcome = await writeExportRecords({
    records,
    format,
    sink,
    readMarkdown,
    onProgress,
    style
  });

  if (!outcome.cancelled) {
    rememberDestination(destination, format);
  }

  return outcome;
}

export type MultipleExportEntry = { kind: "file" | "folder"; path: string };

export type MultipleExportInput = {
  entries: MultipleExportEntry[];
  format: ExportFormat;
  destination: ExportDestination;
  folderName: string;
  readMarkdown: MarkdownReader;
  onConflict: ConflictResolver;
  onProgress?: (progress: ExportProgress) => void;
  style?: DocumentStyle;
};

// Exports an arbitrary multi-selection (files and/or folders) into a single
// destination folder: each selected file becomes one record, each selected
// folder is resolved recursively via listMarkdownFiles and its own name is
// prefixed onto the relativePath so its subfolder structure is preserved.
export async function exportMultipleNotes(input: MultipleExportInput): Promise<ExportOutcome> {
  const {
    entries,
    format,
    destination,
    folderName,
    readMarkdown,
    onConflict,
    onProgress,
    style = DEFAULT_DOCUMENT_STYLE
  } = input;

  const sink = await createRecordSink(destination, folderName, onConflict);

  const recordLists = await Promise.all(
    entries.map(async (entry): Promise<MarkdownFileRecord[]> => {
      if (entry.kind === "file") {
        const fileName = entry.path.replace(/\\/g, "/").split("/").pop() ?? entry.path;
        return [{ filePath: entry.path, relativePath: fileName, mtimeMs: 0 }];
      }

      const folderBaseName = entry.path.replace(/\\/g, "/").replace(/\/+$/, "").split("/").pop() ?? entry.path;
      const nestedRecords = await listMarkdownFiles(entry.path);

      return nestedRecords.map((record) => ({
        ...record,
        relativePath: `${sanitizeExportName(folderBaseName)}/${record.relativePath}`
      }));
    })
  );

  const records = recordLists.flat();

  const outcome = await writeExportRecords({
    records,
    format,
    sink,
    readMarkdown,
    onProgress,
    style
  });

  if (!outcome.cancelled) {
    rememberDestination(destination, format);
  }

  return outcome;
}

// ---------------------------------------------------------------------------
// Merged / manuscript export
// ---------------------------------------------------------------------------

/**
 * Chapter order, exactly as the sidebar shows it. Anything else would silently
 * reorder a book whose chapters the user arranged by hand, so the tree — with
 * its sort mode and manual drag order — is the single source of truth.
 */
export function collectOrderedRecords(
  records: MarkdownFileRecord[],
  sortMode: SortMode,
  manualOrder: ManualOrderMap
): MarkdownFileRecord[] {
  const tree = buildFileTree(records, [], { sortMode, manualOrder });
  const ordered: MarkdownFileRecord[] = [];
  const byRelativePath = new Map(records.map((record) => [record.relativePath, record]));
  const byFilePath = new Map(records.map((record) => [record.filePath, record]));

  const visit = (nodes: FileTreeNode[]) => {
    for (const node of nodes) {
      if (node.kind === "folder") {
        // The folder's own note is not among its children; it is the
        // folder's introduction and comes before them.
        const folderNote = node.folderNotePath ? byFilePath.get(node.folderNotePath) : undefined;

        if (folderNote) {
          ordered.push(folderNote);
        }

        visit(node.children);
        continue;
      }

      const record = byRelativePath.get(node.relativePath);

      if (record) {
        ordered.push(record);
      }
    }
  };

  visit(tree);

  return ordered;
}

export type MergedExportInput = {
  /** Chapter files, already in the order they should appear in the book. */
  records: MarkdownFileRecord[];
  format: ExportFormat;
  destination: ExportDestination;
  baseName: string;
  readMarkdown: MarkdownReader;
  onConflict: ConflictResolver;
  onProgress?: (progress: ExportProgress) => void;
  manuscriptOptions: ManuscriptOptions;
  style?: DocumentStyle;
  /** BCP 47 tag for the EPUB's dc:language. */
  language?: string;
};

/**
 * Compiles many notes into a single document. Both entry points land here: the
 * export dialog's "merge into one file" checkbox passes MERGE_ONLY_OPTIONS,
 * the manuscript dialog passes the user's cover and numbering settings.
 */
export async function exportMergedNotes(input: MergedExportInput): Promise<ExportOutcome> {
  const {
    records,
    format,
    destination,
    baseName,
    readMarkdown,
    onConflict,
    onProgress,
    manuscriptOptions,
    style = DEFAULT_DOCUMENT_STYLE,
    language = "en"
  } = input;

  const fileName = `${sanitizeExportName(baseName)}.${format}`;
  let targetPath: string | null = null;

  if (destination.kind === "folder") {
    const prepared = await prepareSingleTarget(destination.directory, fileName, onConflict);

    if ("outcome" in prepared) {
      return prepared.outcome;
    }

    targetPath = prepared.targetPath;
  }

  const sources: ManuscriptSource[] = [];

  for (const [index, record] of records.entries()) {
    onProgress?.({
      completed: index,
      total: records.length,
      currentFileName: record.relativePath
    });

    sources.push({
      filePath: record.filePath,
      relativePath: record.relativePath,
      markdown: await readMarkdown(record.filePath)
    });
  }

  const manuscript = await compileManuscript(sources, manuscriptOptions);
  const documentTitle = manuscriptOptions.title.trim() || sanitizeExportName(baseName);

  onProgress?.({ completed: records.length, total: records.length, currentFileName: fileName });

  const rendered: RenderedExport =
    format === "epub"
      ? await (async () => {
          const { renderEpubDocument } = await import("./epubExport");
          // EPUB renders chapter by chapter, so the numbering runs over all of
          // them at once and hands each chapter its own numbered slice back.
          const chapterBlocks = numberExportBlockLists(
            manuscript.chapters.map((chapter) => chapter.blocks),
            style.headingNumbering
          );
          const numberedManuscript: CompiledManuscript = {
            ...manuscript,
            chapters: manuscript.chapters.map((chapter, index) => ({ ...chapter, blocks: chapterBlocks[index] }))
          };
          return {
            bytes: renderEpubDocument(
              numberedManuscript,
              {
                title: documentTitle,
                author: manuscriptOptions.author.trim(),
                language
              },
              style
            )
          };
        })()
      : await renderBlocksAs(format, documentTitle, manuscript.blocks, manuscript.images, style);

  if (targetPath !== null) {
    await writeExportFile(targetPath, rendered);
  } else if (!(await downloadRendered(fileName, rendered))) {
    return { exportedCount: 0, skippedCount: 0, cancelled: true };
  }

  rememberDestination(destination, format);

  return { exportedCount: 1, skippedCount: 0, cancelled: false };
}

export async function countExportableNotes(sourceFolderPath: string): Promise<number> {
  const records = await listMarkdownFiles(sourceFolderPath);
  return records.length;
}

export function getDefaultExportBaseName(path: string): string {
  return getNoteDisplayName(path.replace(/[\\/]+$/, ""));
}
