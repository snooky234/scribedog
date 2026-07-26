import { collectImageSrcs, loadExportImages, type ExportImageMap } from "./imageAssets";
import { parseMarkdownToBlocks, type ExportBlock, type InlineRun } from "./markdownModel";

// Compiles many chapter files into one book: chapter order, chapter titles and
// numbering, page breaks between chapters, and an optional title page.
//
// This is the single engine behind both export entry points — the "merge into
// one file" checkbox in the export dialog is simply a call with every
// manuscript option turned off (see DEFAULT_MANUSCRIPT_OPTIONS / MERGE_ONLY_
// OPTIONS below). There is deliberately no second merge implementation.
//
// Two shapes come out of it: a flat block list for the paged formats
// (PDF/DOCX/ODT) and standalone HTML, and a per-chapter list for EPUB, which
// needs one XHTML document per chapter to build its spine and navigation.

export type ChapterNumbering = "none" | "number" | "label";

/** Where a chapter's title comes from when the file has no leading heading. */
export type ChapterTitleSource = "heading" | "fileName";

export type ManuscriptOptions = {
  includeTitlePage: boolean;
  title: string;
  subtitle: string;
  author: string;
  numbering: ChapterNumbering;
  /**
   * Template for `numbering: "label"`, with `{number}` as the placeholder —
   * e.g. "Kapitel {number}". Passed in already translated so this module stays
   * free of i18n.
   */
  chapterLabelTemplate: string;
  chapterTitleSource: ChapterTitleSource;
  /** Starts every chapter on a fresh page in the paged formats. */
  pageBreakBetweenChapters: boolean;
  /** Emits each chapter title as a heading; off keeps the files' own text. */
  includeChapterHeadings: boolean;
};

export const DEFAULT_MANUSCRIPT_OPTIONS: ManuscriptOptions = {
  includeTitlePage: true,
  title: "",
  subtitle: "",
  author: "",
  numbering: "number",
  chapterLabelTemplate: "{number}",
  chapterTitleSource: "heading",
  pageBreakBetweenChapters: true,
  includeChapterHeadings: true
};

/** The plain "merge into one file" mode: chapters back to back, nothing added. */
export const MERGE_ONLY_OPTIONS: ManuscriptOptions = {
  ...DEFAULT_MANUSCRIPT_OPTIONS,
  includeTitlePage: false,
  numbering: "none",
  includeChapterHeadings: false
};

const CHAPTER_NUMBERINGS: ChapterNumbering[] = ["none", "number", "label"];
const CHAPTER_TITLE_SOURCES: ChapterTitleSource[] = ["heading", "fileName"];

/**
 * Rebuilds options from the per-vault settings file, field by field. A file
 * written by a newer version — or hand-edited — falls back per field instead
 * of resetting the user's whole cover.
 */
export function normalizeManuscriptOptions(
  raw: unknown,
  defaults: ManuscriptOptions
): ManuscriptOptions {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    return defaults;
  }

  const stored = raw as Record<string, unknown>;

  const text = (key: keyof ManuscriptOptions, fallback: string): string =>
    typeof stored[key] === "string" ? (stored[key] as string) : fallback;

  const flag = (key: keyof ManuscriptOptions, fallback: boolean): boolean =>
    typeof stored[key] === "boolean" ? (stored[key] as boolean) : fallback;

  return {
    includeTitlePage: flag("includeTitlePage", defaults.includeTitlePage),
    title: text("title", defaults.title),
    subtitle: text("subtitle", defaults.subtitle),
    author: text("author", defaults.author),
    numbering: CHAPTER_NUMBERINGS.includes(stored.numbering as ChapterNumbering)
      ? (stored.numbering as ChapterNumbering)
      : defaults.numbering,
    chapterLabelTemplate: text("chapterLabelTemplate", defaults.chapterLabelTemplate),
    chapterTitleSource: CHAPTER_TITLE_SOURCES.includes(stored.chapterTitleSource as ChapterTitleSource)
      ? (stored.chapterTitleSource as ChapterTitleSource)
      : defaults.chapterTitleSource,
    pageBreakBetweenChapters: flag("pageBreakBetweenChapters", defaults.pageBreakBetweenChapters),
    includeChapterHeadings: flag("includeChapterHeadings", defaults.includeChapterHeadings)
  };
}

export type ManuscriptSource = {
  filePath: string;
  /** Path relative to the export root, used for the fallback chapter title. */
  relativePath: string;
  markdown: string;
};

export type CompiledChapter = {
  title: string;
  blocks: ExportBlock[];
  sourcePath: string;
};

export type CompiledManuscript = {
  /** Title-page blocks; empty when the title page is switched off. */
  frontMatter: ExportBlock[];
  chapters: CompiledChapter[];
  /** Everything in one stream — front matter, chapters and page breaks. */
  blocks: ExportBlock[];
  /** Images from every chapter, merged into one lookup. */
  images: ExportImageMap;
};

function textRun(text: string, bold = false, italic = false): InlineRun {
  return {
    kind: "text",
    text,
    bold,
    italic,
    underline: false,
    strike: false,
    code: false,
    link: null
  };
}

function plainText(runs: InlineRun[]): string {
  return runs
    .map((run) => (run.kind === "text" ? run.text : ""))
    .join("")
    .trim();
}

export function getFileBaseName(relativePath: string): string {
  const fileName = relativePath.replace(/\\/g, "/").split("/").pop() ?? relativePath;
  return fileName.replace(/\.md$/i, "");
}

/**
 * Chapter title plus the body it belongs to. A leading level-1 heading is
 * consumed as the title so the compiled chapter does not repeat it under the
 * heading the compiler emits itself.
 */
function splitChapterTitle(
  blocks: ExportBlock[],
  source: ManuscriptSource,
  titleSource: ChapterTitleSource
): { title: string; body: ExportBlock[] } {
  const fileTitle = getFileBaseName(source.relativePath);
  const [first, ...rest] = blocks;

  if (titleSource === "heading" && first?.kind === "heading" && first.level === 1) {
    const headingTitle = plainText(first.runs);

    if (headingTitle) {
      return { title: headingTitle, body: rest };
    }
  }

  return { title: fileTitle, body: blocks };
}

function formatChapterHeading(
  title: string,
  chapterNumber: number,
  options: ManuscriptOptions
): string {
  if (options.numbering === "number") {
    return title ? `${chapterNumber}. ${title}` : String(chapterNumber);
  }

  if (options.numbering === "label") {
    const label = options.chapterLabelTemplate.replace("{number}", String(chapterNumber));
    return title ? `${label}: ${title}` : label;
  }

  return title;
}

function buildTitlePage(options: ManuscriptOptions): ExportBlock[] {
  const blocks: ExportBlock[] = [];
  const title = options.title.trim();
  const subtitle = options.subtitle.trim();
  const author = options.author.trim();

  if (!title && !subtitle && !author) {
    return blocks;
  }

  // Leading empty paragraphs push the block down the page — the export model
  // has no vertical centring, and this is what a manuscript title page does
  // in practice anyway.
  blocks.push({ kind: "paragraph", runs: [], align: "center" });
  blocks.push({ kind: "paragraph", runs: [], align: "center" });

  if (title) {
    blocks.push({ kind: "heading", level: 1, runs: [textRun(title)], align: "center" });
  }

  if (subtitle) {
    blocks.push({ kind: "heading", level: 2, runs: [textRun(subtitle)], align: "center" });
  }

  if (author) {
    blocks.push({ kind: "paragraph", runs: [], align: "center" });
    blocks.push({ kind: "paragraph", runs: [textRun(author)], align: "center" });
  }

  return blocks;
}

export async function compileManuscript(
  sources: ManuscriptSource[],
  options: ManuscriptOptions
): Promise<CompiledManuscript> {
  const images: ExportImageMap = new Map();
  const chapters: CompiledChapter[] = [];

  for (const [index, source] of sources.entries()) {
    const parsed = parseMarkdownToBlocks(source.markdown);
    const { title, body } = splitChapterTitle(parsed, source, options.chapterTitleSource);
    const headingText = formatChapterHeading(title, index + 1, options);

    // Images resolve relative to their own chapter file, so they have to be
    // loaded per source before the chapters are merged.
    const chapterImages = await loadExportImages(source.filePath, collectImageSrcs(parsed));

    for (const [src, asset] of chapterImages) {
      images.set(src, asset);
    }

    const blocks: ExportBlock[] = options.includeChapterHeadings
      ? [{ kind: "heading", level: 1, runs: [textRun(headingText)] }, ...body]
      : parsed;

    chapters.push({ title: headingText || title, blocks, sourcePath: source.filePath });
  }

  const frontMatter = options.includeTitlePage ? buildTitlePage(options) : [];
  const blocks: ExportBlock[] = [...frontMatter];

  chapters.forEach((chapter, index) => {
    // A break before every chapter, plus one after the title page. Never a
    // trailing break, which would leave a blank final page.
    const needsBreak =
      blocks.length > 0 && (options.pageBreakBetweenChapters || (index === 0 && frontMatter.length > 0));

    if (needsBreak) {
      blocks.push({ kind: "pageBreak" });
    }

    blocks.push(...chapter.blocks);
  });

  return { frontMatter, chapters, blocks, images };
}
