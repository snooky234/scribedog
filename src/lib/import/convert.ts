// One source file → markdown, without deciding what happens to the result.
//
// Split out of importer.ts because the same conversion has consumers with
// opposite needs: the file tree writes the markdown to disk as a new note (and
// wants embedded images extracted into the vault), while the chat panel only
// wants the text as context (where an image costs conversion time and context
// for nothing). `embedImages` is what separates the two — everything else about
// a format is decided here, once.
//
// Sources are read through ConvertSource rather than by path, because the two
// ways a file gets here have nothing else in common: the file dialog hands over
// a path, while a drag from the desktop hands over a File whose path the
// webview never discloses (see lib/dragDrop/droppedSources.ts).

import { readTextFile, stat } from "@tauri-apps/plugin-fs";

import { allowFileAccess } from "@/lib/fileSystem";

// Formats that carry structure a converter has to reconstruct.
export const CONVERT_DOCUMENT_EXTENSIONS = ["docx", "pdf"] as const;

// Transcribed by the configured AI model, so these only work with a model set
// up — the callers check isAiOcrConfigured() before offering them.
export const CONVERT_IMAGE_EXTENSIONS = ["png", "jpg", "jpeg", "gif", "webp"] as const;

// Read as text and either kept as-is, rendered into a table or fenced as code.
// Anything not listed is refused rather than guessed at: a binary decoded as
// UTF-8 produces pages of replacement characters.
export const CONVERT_TEXT_EXTENSIONS = [
  "md",
  "markdown",
  "mdown",
  "txt",
  "text",
  "csv",
  "tsv",
  "json",
  "yaml",
  "yml",
  "xml",
  "log",
  "html",
  "htm"
] as const;

export const CONVERTIBLE_EXTENSIONS: readonly string[] = [
  ...CONVERT_DOCUMENT_EXTENSIONS,
  ...CONVERT_IMAGE_EXTENSIONS,
  ...CONVERT_TEXT_EXTENSIONS
];

// Markdown needs no conversion at all; kept apart so the file tree can copy it
// through verbatim instead of round-tripping it through a converter.
const MARKDOWN_EXTENSIONS = ["md", "markdown", "mdown"];

// Text formats kept as they are — a .txt file already *is* the note's text, and
// wrapping it in a code fence would only make it unreadable in the editor.
const VERBATIM_EXTENSIONS = [...MARKDOWN_EXTENSIONS, "txt", "text"];

// Formats whose value lies in their exact characters, not in prose: fenced so
// indentation and quoting survive the round trip through the editor.
const CODE_FENCE_LANGUAGE: Record<string, string> = {
  json: "json",
  yaml: "yaml",
  yml: "yaml",
  xml: "xml",
  log: ""
};

// Refused before reading: at this size it is not a note, and decoding it would
// freeze the UI for seconds before the text is cut down anyway.
const MAX_TEXT_BYTES = 5 * 1024 * 1024;

// Above this a pipe table stops being something anyone reads — the rows are
// fenced as raw CSV instead, which at least stays searchable.
const MAX_TABLE_ROWS = 1_000;

export type SourceKind = "markdown" | "text" | "document" | "image" | "legacyDoc" | "unsupported";

/**
 * A file to convert, independent of where it came from. `bytes` and `text` are
 * lazy: for a dropped File they decode what the webview already holds, for a
 * picked path they read from disk.
 */
export type ConvertSource = {
  /** File name including its extension. */
  name: string;
  byteLength: () => Promise<number>;
  bytes: () => Promise<Uint8Array>;
  text: () => Promise<string>;
};

/** A file handed over by a drag from outside the app. */
export function sourceFromFile(file: File): ConvertSource {
  return {
    name: file.name,
    byteLength: async () => file.size,
    bytes: async () => new Uint8Array(await file.arrayBuffer()),
    text: () => file.text()
  };
}

/**
 * A file picked through the file dialog. Reading it needs the fs scope widened
 * to it — import sources live outside the opened vault by definition.
 */
export function sourceFromPath(path: string): ConvertSource {
  const grantAccess = async () => {
    await allowFileAccess(path).catch(() => undefined);
  };

  return {
    name: path.replace(/\\/g, "/").replace(/\/+$/, "").split("/").pop() ?? path,
    byteLength: async () => {
      await grantAccess();
      return (await stat(path)).size;
    },
    bytes: async () => {
      await grantAccess();
      const { readFile } = await import("@tauri-apps/plugin-fs");

      return readFile(path);
    },
    text: async () => {
      await grantAccess();
      return readTextFile(path);
    }
  };
}

export type ConvertTarget =
  | {
      // Embedded images are written into the vault's images/ folder and
      // referenced relative to the note being created.
      embedImages: true;
      vaultRoot: string;
      targetFilePath: string;
      imageBaseName: string;
    }
  | { embedImages: false };

export class SourceTooLargeError extends Error {
  constructor() {
    super("source file too large");
    this.name = "SourceTooLargeError";
  }
}

/** Lower-cased extension without the dot; "" when the name carries none. */
export function extensionOf(fileName: string): string {
  const lastDot = fileName.lastIndexOf(".");

  return lastDot <= 0 ? "" : fileName.slice(lastDot + 1).toLowerCase();
}

export function classifyExtension(extension: string): SourceKind {
  if (MARKDOWN_EXTENSIONS.includes(extension)) {
    return "markdown";
  }

  if ((CONVERT_TEXT_EXTENSIONS as readonly string[]).includes(extension)) {
    return "text";
  }

  if ((CONVERT_DOCUMENT_EXTENSIONS as readonly string[]).includes(extension)) {
    return "document";
  }

  if ((CONVERT_IMAGE_EXTENSIONS as readonly string[]).includes(extension)) {
    return "image";
  }

  // Named apart from "unsupported" so the user gets told *why* — the binary
  // .doc format has no browser-side parser, and "save as .docx" is the fix.
  return extension === "doc" ? "legacyDoc" : "unsupported";
}

export function isConvertibleFileName(fileName: string): boolean {
  const kind = classifyExtension(extensionOf(fileName));

  return kind === "markdown" || kind === "text" || kind === "document" || kind === "image";
}

// ---------------------------------------------------------------------------
// Delimited text
// ---------------------------------------------------------------------------

/**
 * Which character separates the columns. CSV written by a German Excel is
 * semicolon-separated, so trusting the file extension would turn every such
 * file into a one-column table.
 */
function detectDelimiter(sample: string, extension: string): string {
  if (extension === "tsv") {
    return "\t";
  }

  // Only separators outside quotes count, so "Meier, Anna" in a
  // semicolon-separated file does not vote for the comma.
  const firstLine = (sample.split(/\r?\n/, 1)[0] ?? "").split(/"[^"]*"/).join("");
  const ranked = [",", ";", "\t"]
    .map((candidate) => ({ candidate, count: firstLine.split(candidate).length - 1 }))
    .sort((left, right) => right.count - left.count);

  return ranked[0].count > 0 ? ranked[0].candidate : ",";
}

/** RFC 4180 parse: quoted fields may contain the delimiter, newlines and "". */
function parseDelimited(content: string, delimiter: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;

  for (let index = 0; index < content.length; index += 1) {
    const character = content[index];

    if (inQuotes) {
      if (character !== '"') {
        field += character;
      } else if (content[index + 1] === '"') {
        field += '"';
        index += 1;
      } else {
        inQuotes = false;
      }

      continue;
    }

    if (character === '"') {
      inQuotes = true;
    } else if (character === delimiter) {
      row.push(field);
      field = "";
    } else if (character === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else if (character !== "\r") {
      field += character;
    }
  }

  if (field || row.length > 0) {
    row.push(field);
    rows.push(row);
  }

  return rows;
}

function escapeTableCell(value: string): string {
  return value.replace(/\|/g, "\\|").replace(/\r?\n/g, "<br>").trim();
}

function delimitedToMarkdown(content: string, extension: string): string {
  const delimiter = detectDelimiter(content, extension);
  const rows = parseDelimited(content, delimiter).filter((row) =>
    row.some((cell) => cell.trim() !== "")
  );

  if (rows.length === 0) {
    return "";
  }

  if (rows.length > MAX_TABLE_ROWS) {
    return ["```", content.trim(), "```"].join("\n");
  }

  // A ragged row would break the table, so every row is padded to the widest.
  const columnCount = rows.reduce((widest, row) => Math.max(widest, row.length), 0);
  const pad = (row: string[]) =>
    Array.from({ length: columnCount }, (_, index) => escapeTableCell(row[index] ?? ""));

  const [headerRow, ...bodyRows] = rows;

  return [
    `| ${pad(headerRow).join(" | ")} |`,
    `| ${Array.from({ length: columnCount }, () => "---").join(" | ")} |`,
    ...bodyRows.map((row) => `| ${pad(row).join(" | ")} |`)
  ].join("\n");
}

// ---------------------------------------------------------------------------
// Conversion
// ---------------------------------------------------------------------------

async function readSourceText(source: ConvertSource): Promise<string> {
  if ((await source.byteLength()) > MAX_TEXT_BYTES) {
    throw new SourceTooLargeError();
  }

  const text = await source.text();

  // Excel and Notepad prefix UTF-8 files with a BOM, which would otherwise show
  // up as an invisible first character of the first heading.
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}

async function convertTextSource(source: ConvertSource, extension: string): Promise<string> {
  const content = await readSourceText(source);

  if (VERBATIM_EXTENSIONS.includes(extension)) {
    return content;
  }

  if (extension === "csv" || extension === "tsv") {
    return delimitedToMarkdown(content, extension);
  }

  if (extension === "html" || extension === "htm") {
    const { convertHtmlToMarkdown } = await import("./htmlToMarkdown");
    return convertHtmlToMarkdown(content);
  }

  const language = CODE_FENCE_LANGUAGE[extension] ?? "";

  return [`\`\`\`${language}`, content.trimEnd(), "```"].join("\n");
}

/**
 * Converts one source file to markdown. Throws on failure — every caller
 * reports failures per file rather than aborting a whole batch.
 */
export async function convertToMarkdown(
  source: ConvertSource,
  target: ConvertTarget,
  signal?: AbortSignal
): Promise<string> {
  const extension = extensionOf(source.name);
  const kind = classifyExtension(extension);

  if (kind === "markdown" || kind === "text") {
    return convertTextSource(source, extension);
  }

  if (kind === "image") {
    const { convertImageToMarkdown } = await import("./imageImporter");
    return convertImageToMarkdown(await source.bytes(), source.name, signal);
  }

  if (extension === "docx") {
    const { convertDocxToMarkdown } = await import("./docxImporter");

    return target.embedImages
      ? convertDocxToMarkdown(
          await source.bytes(),
          target.vaultRoot,
          target.targetFilePath,
          target.imageBaseName
        )
      : convertDocxToMarkdown(await source.bytes());
  }

  const { convertPdfToMarkdown } = await import("./pdfImporter");

  return target.embedImages
    ? convertPdfToMarkdown(
        await source.bytes(),
        signal,
        target.vaultRoot,
        target.targetFilePath,
        target.imageBaseName
      )
    : convertPdfToMarkdown(await source.bytes(), signal);
}
