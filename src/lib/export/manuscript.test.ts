import { describe, expect, it } from "vitest";

import {
  compileManuscript,
  DEFAULT_MANUSCRIPT_OPTIONS,
  MERGE_ONLY_OPTIONS,
  type ManuscriptOptions,
  type ManuscriptSource
} from "./manuscript";
import type { ExportBlock } from "./markdownModel";

function source(relativePath: string, markdown: string): ManuscriptSource {
  return { filePath: `C:/vault/${relativePath}`, relativePath, markdown };
}

function options(overrides: Partial<ManuscriptOptions> = {}): ManuscriptOptions {
  return { ...DEFAULT_MANUSCRIPT_OPTIONS, ...overrides };
}

function headingTexts(blocks: ExportBlock[]): string[] {
  return blocks.flatMap((block) =>
    block.kind === "heading"
      ? [block.runs.map((run) => (run.kind === "text" ? run.text : "")).join("")]
      : []
  );
}

const CHAPTERS = [
  source("01-aufbruch.md", "# Der Aufbruch\n\nEs begann an einem Dienstag."),
  source("02-ankunft.md", "# Die Ankunft\n\nDer Hafen war leer.")
];

describe("compileManuscript", () => {
  it("takes the chapter title from a leading H1 without repeating it in the body", async () => {
    const compiled = await compileManuscript(CHAPTERS, options({ includeTitlePage: false }));

    expect(compiled.chapters.map((chapter) => chapter.title)).toEqual([
      "1. Der Aufbruch",
      "2. Die Ankunft"
    ]);
    // Exactly one heading per chapter — the compiled one, not the original H1.
    expect(headingTexts(compiled.chapters[0].blocks)).toEqual(["1. Der Aufbruch"]);
  });

  it("falls back to the file name when the chapter has no leading heading", async () => {
    const compiled = await compileManuscript(
      [source("Ein stiller Abend.md", "Kein Titel, nur Text.")],
      options({ includeTitlePage: false })
    );

    expect(compiled.chapters[0].title).toBe("1. Ein stiller Abend");
  });

  it("uses the file name over the heading when asked to", async () => {
    const compiled = await compileManuscript(
      [source("01-aufbruch.md", "# Der Aufbruch\n\nText.")],
      options({ includeTitlePage: false, chapterTitleSource: "fileName", numbering: "none" })
    );

    expect(compiled.chapters[0].title).toBe("01-aufbruch");
    // The original H1 stays in the body, since it was not consumed as a title.
    expect(headingTexts(compiled.chapters[0].blocks)).toEqual(["01-aufbruch", "Der Aufbruch"]);
  });

  it("applies the label numbering template", async () => {
    const compiled = await compileManuscript(
      CHAPTERS,
      options({
        includeTitlePage: false,
        numbering: "label",
        chapterLabelTemplate: "Kapitel {number}"
      })
    );

    expect(compiled.chapters.map((chapter) => chapter.title)).toEqual([
      "Kapitel 1: Der Aufbruch",
      "Kapitel 2: Die Ankunft"
    ]);
  });

  it("puts a page break between chapters but never after the last one", async () => {
    const compiled = await compileManuscript(CHAPTERS, options({ includeTitlePage: false }));
    const breakCount = compiled.blocks.filter((block) => block.kind === "pageBreak").length;

    expect(breakCount).toBe(1);
    expect(compiled.blocks[compiled.blocks.length - 1].kind).not.toBe("pageBreak");
  });

  it("separates the title page from the first chapter even without chapter breaks", async () => {
    const compiled = await compileManuscript(
      CHAPTERS,
      options({
        includeTitlePage: true,
        title: "Die Reise",
        author: "A. Autorin",
        pageBreakBetweenChapters: false
      })
    );

    const firstBreak = compiled.blocks.findIndex((block) => block.kind === "pageBreak");

    expect(compiled.frontMatter.length).toBeGreaterThan(0);
    expect(firstBreak).toBe(compiled.frontMatter.length);
    expect(compiled.blocks.filter((block) => block.kind === "pageBreak")).toHaveLength(1);
  });

  it("centres every title page block", async () => {
    const compiled = await compileManuscript(
      CHAPTERS,
      options({ includeTitlePage: true, title: "Die Reise", subtitle: "Ein Roman", author: "A. Autorin" })
    );

    expect(compiled.frontMatter.every((block) => "align" in block && block.align === "center")).toBe(
      true
    );
    expect(headingTexts(compiled.frontMatter)).toEqual(["Die Reise", "Ein Roman"]);
  });

  it("omits the title page when no cover field is filled in", async () => {
    const compiled = await compileManuscript(CHAPTERS, options({ includeTitlePage: true }));

    expect(compiled.frontMatter).toEqual([]);
  });

  it("merge-only mode concatenates the chapters untouched", async () => {
    const compiled = await compileManuscript(CHAPTERS, MERGE_ONLY_OPTIONS);

    expect(compiled.frontMatter).toEqual([]);
    // The files' own H1s survive; no compiler-generated headings are added.
    expect(headingTexts(compiled.blocks)).toEqual(["Der Aufbruch", "Die Ankunft"]);
    expect(compiled.blocks.filter((block) => block.kind === "pageBreak")).toHaveLength(1);
  });
});
