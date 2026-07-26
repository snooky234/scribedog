import { strToU8, zipSync, type Zippable } from "fflate";

import {
  DEFAULT_DOCUMENT_STYLE,
  getFontScale,
  getGenericFamily,
  getReferencedFontName,
  type DocumentStyle
} from "@/lib/fonts";

import type { BlockAlign, ExportBlock, InlineRun } from "./markdownModel";
import type { CompiledManuscript } from "./manuscript";

// Hand-written EPUB 3 writer. An .epub is a zip whose first entry must be an
// uncompressed "mimetype", exactly like the ODT export next door — which is
// why this needs no new dependency beyond the fflate already in the bundle,
// and stays clear of the copyleft/CLA questions of the epub libraries.
//
// Deliberately no font embedding: an embedded face is a redistribution of the
// font, which only some licences allow. The stylesheet references the family
// by name with a generic fallback, so the reading device substitutes.
//
// EPUB 3 navigation (nav.xhtml) is written alongside an EPUB 2 toc.ncx, since
// plenty of shipping e-readers still only look at the latter.

const EPUB_MIMETYPE = "application/epub+zip";
const CONTENT_DIR = "OEBPS";

export type EpubMetadata = {
  title: string;
  author: string;
  /** BCP 47 tag for dc:language, e.g. "de". */
  language: string;
  /** Stable book id; a random UUID is generated when omitted. */
  identifier?: string;
};

function escapeXml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function alignStyle(align: BlockAlign | undefined): string {
  return align && align !== "left" ? ` style="text-align:${align}"` : "";
}

function renderRuns(runs: InlineRun[], imageHrefs: Map<string, string>): string {
  let xhtml = "";

  for (const run of runs) {
    if (run.kind === "break") {
      xhtml += "<br/>";
      continue;
    }

    if (run.kind === "image") {
      const href = imageHrefs.get(run.src);

      if (href) {
        const width = run.width ? ` width="${run.width}"` : "";
        xhtml += `<img src="${escapeXml(href)}" alt="${escapeXml(run.alt)}"${width}/>`;
      } else if (run.alt) {
        xhtml += `<em>${escapeXml(run.alt)}</em>`;
      }

      continue;
    }

    let text = escapeXml(run.text);

    if (run.code) {
      text = `<code>${text}</code>`;
    }
    if (run.bold) {
      text = `<strong>${text}</strong>`;
    }
    if (run.italic) {
      text = `<em>${text}</em>`;
    }
    if (run.underline) {
      text = `<u>${text}</u>`;
    }
    if (run.strike) {
      text = `<s>${text}</s>`;
    }
    if (run.link) {
      text = `<a href="${escapeXml(run.link)}">${text}</a>`;
    }

    xhtml += text;
  }

  return xhtml;
}

function renderBlocks(blocks: ExportBlock[], imageHrefs: Map<string, string>): string {
  let xhtml = "";

  for (const block of blocks) {
    switch (block.kind) {
      case "heading": {
        const level = Math.min(Math.max(block.level, 1), 6);
        xhtml += `<h${level}${alignStyle(block.align)}>${renderRuns(block.runs, imageHrefs)}</h${level}>\n`;
        break;
      }
      case "paragraph":
        // An empty paragraph would collapse; the spacer keeps title-page
        // rhythm intact across readers.
        xhtml +=
          block.runs.length === 0
            ? `<p${alignStyle(block.align)}> </p>\n`
            : `<p${alignStyle(block.align)}>${renderRuns(block.runs, imageHrefs)}</p>\n`;
        break;
      case "codeBlock":
        xhtml += `<pre><code>${escapeXml(block.text)}</code></pre>\n`;
        break;
      case "blockquote":
        xhtml += `<blockquote>\n${renderBlocks(block.children, imageHrefs)}</blockquote>\n`;
        break;
      case "list": {
        const isTaskList = block.items.some((item) => item.checked !== null);
        const tag = block.ordered ? "ol" : "ul";
        const attrs = [
          block.ordered && block.start !== 1 ? ` start="${block.start}"` : "",
          !block.ordered && isTaskList ? ' class="task-list"' : ""
        ].join("");

        xhtml += `<${tag}${attrs}>\n`;

        for (const item of block.items) {
          // XHTML is XML: boolean attributes must carry a value, unlike the
          // HTML export's bare `disabled`/`checked`.
          const checkbox =
            item.checked === null
              ? ""
              : `<input type="checkbox" disabled="disabled"${item.checked ? ' checked="checked"' : ""}/> `;

          const [first, ...rest] = item.children;
          const inlineFirst = first?.kind === "paragraph" ? renderRuns(first.runs, imageHrefs) : "";
          const remaining = first?.kind === "paragraph" ? rest : item.children;

          xhtml += `<li>${checkbox}${inlineFirst}${renderBlocks(remaining, imageHrefs)}</li>\n`;
        }

        xhtml += `</${tag}>\n`;
        break;
      }
      case "table": {
        xhtml += "<table>\n";

        for (const row of block.rows) {
          xhtml += "<tr>";

          for (const cell of row) {
            const tag = cell.header ? "th" : "td";
            const align = cell.align !== "left" ? ` style="text-align:${cell.align}"` : "";
            xhtml += `<${tag}${align}>${renderRuns(cell.runs, imageHrefs)}</${tag}>`;
          }

          xhtml += "</tr>\n";
        }

        xhtml += "</table>\n";
        break;
      }
      case "hr":
        xhtml += "<hr/>\n";
        break;
      case "pageBreak":
        xhtml += '<div class="page-break"></div>\n';
        break;
    }
  }

  return xhtml;
}

function buildXhtmlDocument(title: string, language: string, body: string): string {
  return (
    '<?xml version="1.0" encoding="UTF-8"?>\n' +
    '<!DOCTYPE html>\n' +
    `<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" xml:lang="${escapeXml(language)}" lang="${escapeXml(language)}">\n` +
    `<head>\n<meta charset="utf-8"/>\n<title>${escapeXml(title)}</title>\n` +
    '<link rel="stylesheet" type="text/css" href="style.css"/>\n</head>\n' +
    `<body>\n${body}</body>\n</html>\n`
  );
}

function buildStylesheet(style: DocumentStyle): string {
  const family = getReferencedFontName(style.fontId);
  const generic = getGenericFamily(style.fontId);
  // A percentage rather than an absolute size: the reader's own text-size
  // control keeps working, and 100% means "leave it as the device likes it".
  const sizePercent = Math.round(getFontScale(style.fontSizePt) * 100);

  return `@charset "utf-8";
/* The family is referenced, never embedded — the reader substitutes when it
   is not installed, which is why the generic fallback matters here. */
body {
  font-family: "${family}", ${generic};
  font-size: ${sizePercent}%;
  line-height: 1.5;
  margin: 0 5%;
  widows: 2;
  orphans: 2;
}
h1, h2, h3, h4, h5, h6 { line-height: 1.25; page-break-after: avoid; }
h1 { font-size: 1.6em; margin: 1.2em 0 0.6em; }
h2 { font-size: 1.35em; }
h3 { font-size: 1.15em; }
p { margin: 0 0 0.7em; text-indent: 0; }
img { max-width: 100%; height: auto; }
code { font-family: monospace; font-size: 0.9em; }
pre { white-space: pre-wrap; background: #f6f8fa; padding: 0.6em; }
blockquote { margin: 0.8em 1.2em; font-style: italic; }
table { border-collapse: collapse; }
th, td { border: 1px solid #999; padding: 0.3em 0.6em; }
hr { border: none; border-top: 1px solid #999; margin: 1.6em 0; }
ul.task-list { list-style: none; padding-left: 1.2em; }
.page-break { page-break-before: always; break-before: page; }
`;
}

/** Deterministic slug so a chapter's file name stays readable in the archive. */
function chapterFileName(index: number): string {
  return `chapter-${String(index + 1).padStart(3, "0")}.xhtml`;
}

function generateIdentifier(): string {
  const globalCrypto = globalThis.crypto as { randomUUID?: () => string } | undefined;

  if (globalCrypto?.randomUUID) {
    return `urn:uuid:${globalCrypto.randomUUID()}`;
  }

  // Non-browser fallback (tests): still unique enough to identify one book.
  return `urn:uuid:${Date.now().toString(16)}-${Math.random().toString(16).slice(2, 10)}`;
}

type EpubDocument = { fileName: string; title: string; xhtml: string };

function buildPackageOpf(
  documents: EpubDocument[],
  imageEntries: Array<{ href: string; mediaType: string }>,
  metadata: Required<EpubMetadata>
): string {
  const manifestItems = [
    '<item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>',
    '<item id="ncx" href="toc.ncx" media-type="application/x-dtbncx+xml"/>',
    '<item id="style" href="style.css" media-type="text/css"/>',
    ...documents.map(
      (document, index) =>
        `<item id="doc${index}" href="${escapeXml(document.fileName)}" media-type="application/xhtml+xml"/>`
    ),
    ...imageEntries.map(
      (image, index) =>
        `<item id="img${index}" href="${escapeXml(image.href)}" media-type="${image.mediaType}"/>`
    )
  ].join("\n    ");

  const spineItems = documents
    .map((_document, index) => `<itemref idref="doc${index}"/>`)
    .join("\n    ");

  return `<?xml version="1.0" encoding="UTF-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="book-id">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:identifier id="book-id">${escapeXml(metadata.identifier)}</dc:identifier>
    <dc:title>${escapeXml(metadata.title)}</dc:title>
    <dc:language>${escapeXml(metadata.language)}</dc:language>
    ${metadata.author ? `<dc:creator>${escapeXml(metadata.author)}</dc:creator>` : ""}
    <meta property="dcterms:modified">${new Date().toISOString().replace(/\.\d{3}Z$/, "Z")}</meta>
  </metadata>
  <manifest>
    ${manifestItems}
  </manifest>
  <spine toc="ncx">
    ${spineItems}
  </spine>
</package>
`;
}

function buildNavXhtml(documents: EpubDocument[], metadata: Required<EpubMetadata>): string {
  const items = documents
    .map(
      (document) =>
        `<li><a href="${escapeXml(document.fileName)}">${escapeXml(document.title)}</a></li>`
    )
    .join("\n      ");

  return buildXhtmlDocument(
    metadata.title,
    metadata.language,
    `<nav epub:type="toc" id="toc">
    <h1>${escapeXml(metadata.title)}</h1>
    <ol>
      ${items}
    </ol>
  </nav>
`
  );
}

function buildTocNcx(documents: EpubDocument[], metadata: Required<EpubMetadata>): string {
  const navPoints = documents
    .map(
      (document, index) =>
        `<navPoint id="nav${index}" playOrder="${index + 1}">
      <navLabel><text>${escapeXml(document.title)}</text></navLabel>
      <content src="${escapeXml(document.fileName)}"/>
    </navPoint>`
    )
    .join("\n    ");

  return `<?xml version="1.0" encoding="UTF-8"?>
<ncx xmlns="http://www.daisy.org/z3986/2005/ncx/" version="2005-1">
  <head>
    <meta name="dtb:uid" content="${escapeXml(metadata.identifier)}"/>
    <meta name="dtb:depth" content="1"/>
    <meta name="dtb:totalPageCount" content="0"/>
    <meta name="dtb:maxPageNumber" content="0"/>
  </head>
  <docTitle><text>${escapeXml(metadata.title)}</text></docTitle>
  <navMap>
    ${navPoints}
  </navMap>
</ncx>
`;
}

const CONTAINER_XML = `<?xml version="1.0" encoding="UTF-8"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles>
    <rootfile full-path="${CONTENT_DIR}/content.opf" media-type="application/oebps-package+xml"/>
  </rootfiles>
</container>
`;

export function renderEpubDocument(
  manuscript: CompiledManuscript,
  metadata: EpubMetadata,
  style: DocumentStyle = DEFAULT_DOCUMENT_STYLE
): Uint8Array {
  const resolvedMetadata: Required<EpubMetadata> = {
    title: metadata.title.trim() || "Untitled",
    author: metadata.author.trim(),
    language: metadata.language || "en",
    identifier: metadata.identifier ?? generateIdentifier()
  };

  // Images are written as real files rather than data URIs: readers handle
  // them better, and the archive stays compressible.
  const imageHrefs = new Map<string, string>();
  const imageFiles: Record<string, Uint8Array> = {};
  const imageEntries: Array<{ href: string; mediaType: string }> = [];

  let imageIndex = 0;

  for (const [src, asset] of manuscript.images) {
    const href = `images/image${imageIndex}.png`;
    imageIndex += 1;
    imageHrefs.set(src, href);
    imageFiles[`${CONTENT_DIR}/${href}`] = asset.pngBytes;
    imageEntries.push({ href, mediaType: "image/png" });
  }

  const documents: EpubDocument[] = [];

  if (manuscript.frontMatter.length > 0) {
    documents.push({
      fileName: "title.xhtml",
      title: resolvedMetadata.title,
      xhtml: buildXhtmlDocument(
        resolvedMetadata.title,
        resolvedMetadata.language,
        renderBlocks(manuscript.frontMatter, imageHrefs)
      )
    });
  }

  manuscript.chapters.forEach((chapter, index) => {
    documents.push({
      fileName: chapterFileName(index),
      title: chapter.title,
      xhtml: buildXhtmlDocument(
        chapter.title,
        resolvedMetadata.language,
        renderBlocks(chapter.blocks, imageHrefs)
      )
    });
  });

  const archive: Zippable = {
    // Per the EPUB spec the mimetype entry must come first and stay
    // uncompressed, the same constraint the ODT writer works under.
    mimetype: [strToU8(EPUB_MIMETYPE), { level: 0 }],
    "META-INF/container.xml": strToU8(CONTAINER_XML),
    [`${CONTENT_DIR}/content.opf`]: strToU8(
      buildPackageOpf(documents, imageEntries, resolvedMetadata)
    ),
    [`${CONTENT_DIR}/nav.xhtml`]: strToU8(buildNavXhtml(documents, resolvedMetadata)),
    [`${CONTENT_DIR}/toc.ncx`]: strToU8(buildTocNcx(documents, resolvedMetadata)),
    [`${CONTENT_DIR}/style.css`]: strToU8(buildStylesheet(style)),
    ...Object.fromEntries(
      documents.map((document) => [
        `${CONTENT_DIR}/${document.fileName}`,
        strToU8(document.xhtml)
      ])
    ),
    ...imageFiles
  };

  return zipSync(archive);
}
