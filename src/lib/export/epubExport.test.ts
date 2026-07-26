/**
 * @vitest-environment jsdom
 */
import { strFromU8, unzipSync } from "fflate";
import { describe, expect, it } from "vitest";

import { DEFAULT_FONT_SIZE_PT } from "@/lib/fonts";

import { renderEpubDocument } from "./epubExport";
import { compileManuscript, DEFAULT_MANUSCRIPT_OPTIONS, type ManuscriptSource } from "./manuscript";

const SOURCES: ManuscriptSource[] = [
  { filePath: "C:/vault/01.md", relativePath: "01.md", markdown: "# Der Aufbruch\n\nText **fett**." },
  {
    filePath: "C:/vault/02.md",
    relativePath: "02.md",
    markdown: "# Die Ankunft\n\n- [x] erledigt\n- [ ] offen\n\n| A | B |\n| - | - |\n| 1 | 2 |"
  }
];

async function buildEpub() {
  const manuscript = await compileManuscript(SOURCES, {
    ...DEFAULT_MANUSCRIPT_OPTIONS,
    title: "Die Reise",
    author: "A. Autorin"
  });

  const bytes = renderEpubDocument(
    manuscript,
    { title: "Die Reise", author: "A. Autorin", language: "de" },
    { fontId: "eb-garamond", fontSizePt: DEFAULT_FONT_SIZE_PT }
  );

  const entries = unzipSync(bytes);
  const text = (path: string) => strFromU8(entries[path]);

  return { bytes, entries, text };
}

describe("renderEpubDocument", () => {
  it("writes mimetype as the first entry with the exact media type", async () => {
    const { bytes, text } = await buildEpub();

    expect(text("mimetype")).toBe("application/epub+zip");
    // Readers sniff the media type at a fixed offset, which only holds if the
    // entry is first and stored uncompressed.
    expect(strFromU8(bytes.slice(30, 30 + 8))).toBe("mimetype");
    expect(strFromU8(bytes.slice(38, 38 + 20))).toBe("application/epub+zip");
  });

  it("ships the container, package, both navigation documents and a stylesheet", async () => {
    const { entries } = await buildEpub();

    expect(Object.keys(entries)).toEqual(
      expect.arrayContaining([
        "META-INF/container.xml",
        "OEBPS/content.opf",
        "OEBPS/nav.xhtml",
        "OEBPS/toc.ncx",
        "OEBPS/style.css"
      ])
    );
  });

  it("puts the title page and every chapter into the spine in reading order", async () => {
    const { text } = await buildEpub();
    const opf = text("OEBPS/content.opf");
    const spineOrder = [...opf.matchAll(/<itemref idref="(doc\d+)"\/>/g)].map((match) => match[1]);

    expect(spineOrder).toEqual(["doc0", "doc1", "doc2"]);
    expect(opf).toContain('href="title.xhtml"');
    expect(opf).toContain('href="chapter-001.xhtml"');
    expect(opf).toContain('href="chapter-002.xhtml"');
  });

  it("names the chapters in both navigation documents", async () => {
    const { text } = await buildEpub();

    expect(text("OEBPS/nav.xhtml")).toContain("1. Der Aufbruch");
    expect(text("OEBPS/toc.ncx")).toContain("2. Die Ankunft");
  });

  it("produces well-formed XML for every XHTML document", async () => {
    const { entries, text } = await buildEpub();
    const parser = new DOMParser();

    const xmlPaths = Object.keys(entries).filter(
      (path) => path.endsWith(".xhtml") || path.endsWith(".opf") || path.endsWith(".ncx")
    );

    expect(xmlPaths.length).toBeGreaterThan(3);

    for (const path of xmlPaths) {
      const parsed = parser.parseFromString(text(path), "application/xml");
      const error = parsed.querySelector("parsererror");

      expect(error?.textContent ?? `${path}: ok`).toBe(`${path}: ok`);
    }
  });

  it("writes XML-legal boolean attributes for task list checkboxes", async () => {
    const { text } = await buildEpub();
    const chapter = text("OEBPS/chapter-002.xhtml");

    // Bare `disabled`/`checked` as in the HTML export would not be valid XML.
    expect(chapter).toContain('disabled="disabled"');
    expect(chapter).toContain('checked="checked"');
    expect(chapter).not.toMatch(/<input[^>]*\sdisabled(?=[\s/>])/);
  });

  it("references the chosen font family without embedding any font file", async () => {
    const { entries, text } = await buildEpub();

    expect(text("OEBPS/style.css")).toContain('font-family: "EB Garamond", serif');
    expect(Object.keys(entries).some((path) => /\.(woff2?|ttf|otf)$/i.test(path))).toBe(false);
  });

  it("declares title, author and language in the package metadata", async () => {
    const { text } = await buildEpub();
    const opf = text("OEBPS/content.opf");

    expect(opf).toContain("<dc:title>Die Reise</dc:title>");
    expect(opf).toContain("<dc:creator>A. Autorin</dc:creator>");
    expect(opf).toContain("<dc:language>de</dc:language>");
    expect(opf).toMatch(/<dc:identifier id="book-id">urn:uuid:[^<]+<\/dc:identifier>/);
  });
});
