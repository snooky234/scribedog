import { strToU8, zipSync, type Zippable } from "fflate";

import type { ExportBlock, InlineRun } from "./markdownModel";
import { computeExportImageSize, type ExportImageMap } from "./imageAssets";

// Hand-written OpenDocument Text writer: an .odt is a zip whose first entry
// must be an uncompressed "mimetype", plus manifest, styles and content XML.
// No maintained JS library produces ODT, so the (small) subset of ODF needed
// for the editor's markdown features is generated here directly.

const ODT_MIMETYPE = "application/vnd.oasis.opendocument.text";

// Match the editor / HTML export's sans-serif look. Arial is the safest
// sans-serif present across Windows, macOS and most Linux setups.
const BODY_FONT = "Arial";

function escapeXml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

// ODF collapses consecutive spaces; runs of spaces and tabs must be encoded
// as <text:s/> and <text:tab/> to survive (relevant mainly for code).
function encodeOdtText(text: string): string {
  let xml = "";
  let index = 0;

  while (index < text.length) {
    const char = text[index];

    if (char === "\t") {
      xml += "<text:tab/>";
      index += 1;
      continue;
    }

    if (char === " ") {
      let count = 0;

      while (text[index + count] === " ") {
        count += 1;
      }

      if (count === 1) {
        xml += " ";
      } else {
        xml += ` <text:s text:c="${count - 1}"/>`;
      }

      index += count;
      continue;
    }

    xml += escapeXml(char);
    index += 1;
  }

  return xml;
}

function pxToCm(px: number): string {
  return `${((px / 96) * 2.54).toFixed(3)}cm`;
}

const PAGE_CONTENT_WIDTH_PX = 604; // A4 minus 2cm margins at 96dpi.

type OdtWriterState = {
  images: ExportImageMap;
  // Raw markdown src → picture path inside the archive.
  picturePaths: Map<string, string>;
  // Running counter for unique draw:name values on image frames.
  frameIndex: number;
};

function textStyleName(run: Extract<InlineRun, { kind: "text" }>): string | null {
  const parts = [
    run.bold ? "b" : "",
    run.italic ? "i" : "",
    run.underline ? "u" : "",
    run.strike ? "s" : "",
    run.code ? "c" : ""
  ].join("");

  return parts ? `T_${parts}` : null;
}

// Every used flag combination becomes one automatic text style.
function collectTextStyles(blocks: ExportBlock[]): string[] {
  const names = new Set<string>();

  const visitRuns = (runs: InlineRun[]) => {
    for (const run of runs) {
      if (run.kind === "text") {
        const name = textStyleName(run);

        if (name) {
          names.add(name);
        }
      }
    }
  };

  const visit = (list: ExportBlock[]) => {
    for (const block of list) {
      switch (block.kind) {
        case "heading":
        case "paragraph":
          visitRuns(block.runs);
          break;
        case "blockquote":
          visit(block.children);
          break;
        case "list":
          block.items.forEach((item) => visit(item.children));
          break;
        case "table":
          block.rows.forEach((row) => row.forEach((cell) => visitRuns(cell.runs)));
          break;
        default:
          break;
      }
    }
  };

  visit(blocks);

  return [...names];
}

function textStyleXml(name: string): string {
  const flags = name.slice(2);
  const properties = [
    flags.includes("b") ? 'fo:font-weight="bold"' : "",
    flags.includes("i") ? 'fo:font-style="italic"' : "",
    flags.includes("u") ? 'style:text-underline-style="solid" style:text-underline-width="auto"' : "",
    flags.includes("s") ? 'style:text-line-through-style="solid"' : "",
    flags.includes("c")
      ? 'style:font-name="Courier New" fo:background-color="#f4f4f4"'
      : ""
  ]
    .filter(Boolean)
    .join(" ");

  return `<style:style style:name="${name}" style:family="text"><style:text-properties ${properties}/></style:style>`;
}

function runsToOdtXml(runs: InlineRun[], state: OdtWriterState): string {
  let xml = "";

  for (const run of runs) {
    if (run.kind === "break") {
      xml += "<text:line-break/>";
      continue;
    }

    if (run.kind === "image") {
      const picturePath = state.picturePaths.get(run.src);
      const asset = state.images.get(run.src);

      if (picturePath && asset) {
        const size = computeExportImageSize(asset, run.width, PAGE_CONTENT_WIDTH_PX);
        // draw:style-name + draw:name matter: without a graphic style Word's
        // ODT import treats the frame as page-anchored and floats it to the
        // top of the page instead of keeping it at its position in the text.
        state.frameIndex += 1;
        xml +=
          `<draw:frame draw:style-name="G_inline" draw:name="Image${state.frameIndex}" text:anchor-type="as-char" draw:z-index="0" svg:width="${pxToCm(size.width)}" svg:height="${pxToCm(size.height)}">` +
          `<draw:image xlink:href="${escapeXml(picturePath)}" xlink:type="simple" xlink:show="embed" xlink:actuate="onLoad"/>` +
          `</draw:frame>`;
      } else if (run.alt) {
        xml += `<text:span text:style-name="T_i">${encodeOdtText(run.alt)}</text:span>`;
      }

      continue;
    }

    let content = encodeOdtText(run.text);
    const styleName = textStyleName(run);

    if (styleName) {
      content = `<text:span text:style-name="${styleName}">${content}</text:span>`;
    }

    if (run.link) {
      content = `<text:a xlink:type="simple" xlink:href="${escapeXml(run.link)}">${content}</text:a>`;
    }

    xml += content;
  }

  return xml;
}

function blocksToOdtXml(blocks: ExportBlock[], state: OdtWriterState, paragraphStyle = "P_default"): string {
  let xml = "";

  for (const block of blocks) {
    switch (block.kind) {
      case "heading": {
        const level = Math.min(Math.max(block.level, 1), 6);
        xml += `<text:h text:style-name="Heading_20_${level}" text:outline-level="${level}">${runsToOdtXml(block.runs, state)}</text:h>`;
        break;
      }
      case "paragraph":
        xml += `<text:p text:style-name="${paragraphStyle}">${runsToOdtXml(block.runs, state)}</text:p>`;
        break;
      case "codeBlock":
        for (const line of block.text.split("\n")) {
          xml += `<text:p text:style-name="P_code">${encodeOdtText(line)}</text:p>`;
        }
        break;
      case "blockquote":
        xml += blocksToOdtXml(block.children, state, "P_quote");
        break;
      case "list": {
        // Task lists get indented checkbox paragraphs instead of a bulleted
        // list — a bullet plus a checkbox glyph would double the marker
        // (matches how the PDF/DOCX exporters render tasks).
        const hasTaskItems = block.items.some((item) => item.checked !== null);

        if (hasTaskItems) {
          for (const item of block.items) {
            const [first, ...rest] = item.children;
            const firstRuns = first?.kind === "paragraph" ? first.runs : [];
            const restBlocks = first?.kind === "paragraph" ? rest : item.children;
            const checkbox = item.checked === null ? "" : item.checked ? "☑ " : "☐ ";
            xml += `<text:p text:style-name="P_task">${checkbox}${runsToOdtXml(firstRuns, state)}</text:p>`;
            xml += blocksToOdtXml(restBlocks, state, paragraphStyle);
          }
          break;
        }

        const listStyle = block.ordered ? "L_num" : "L_bul";
        xml += `<text:list text:style-name="${listStyle}">`;

        for (const item of block.items) {
          xml += "<text:list-item>";
          xml += blocksToOdtXml(item.children, state, paragraphStyle);
          xml += "</text:list-item>";
        }

        xml += "</text:list>";
        break;
      }
      case "table": {
        if (block.rows.length === 0) {
          break;
        }

        const columnCount = Math.max(...block.rows.map((row) => row.length));
        xml += "<table:table>";
        xml += `<table:table-column table:number-columns-repeated="${columnCount}"/>`;

        for (const row of block.rows) {
          xml += "<table:table-row>";

          for (let column = 0; column < columnCount; column += 1) {
            const cell = row[column];

            if (!cell) {
              xml += '<table:table-cell table:style-name="TC_body"><text:p text:style-name="P_default"/></table:table-cell>';
              continue;
            }

            const cellStyle = cell.header ? "TC_header" : "TC_body";
            const paragraphAlignStyle =
              cell.align === "center" ? "P_center" : cell.align === "right" ? "P_right" : "P_default";
            const runsXml = cell.header
              ? `<text:span text:style-name="T_b">${runsToOdtXml(cell.runs, state)}</text:span>`
              : runsToOdtXml(cell.runs, state);

            xml += `<table:table-cell table:style-name="${cellStyle}"><text:p text:style-name="${paragraphAlignStyle}">${runsXml}</text:p></table:table-cell>`;
          }

          xml += "</table:table-row>";
        }

        xml += "</table:table>";
        break;
      }
      case "hr":
        xml += '<text:p text:style-name="P_hr"/>';
        break;
    }
  }

  return xml;
}

const CONTENT_XML_NAMESPACES =
  'xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0" ' +
  'xmlns:text="urn:oasis:names:tc:opendocument:xmlns:text:1.0" ' +
  'xmlns:table="urn:oasis:names:tc:opendocument:xmlns:table:1.0" ' +
  'xmlns:draw="urn:oasis:names:tc:opendocument:xmlns:drawing:1.0" ' +
  'xmlns:style="urn:oasis:names:tc:opendocument:xmlns:style:1.0" ' +
  'xmlns:fo="urn:oasis:names:tc:opendocument:xmlns:xsl-fo-compatible:1.0" ' +
  'xmlns:svg="urn:oasis:names:tc:opendocument:xmlns:svg-compatible:1.0" ' +
  'xmlns:xlink="http://www.w3.org/1999/xlink"';

function buildListStyleXml(name: string, ordered: boolean): string {
  let levels = "";

  for (let level = 1; level <= 10; level += 1) {
    const indent = `${(level * 0.635).toFixed(3)}cm`;
    const common =
      `<style:list-level-properties text:list-level-position-and-space-mode="label-alignment">` +
      `<style:list-level-label-alignment text:label-followed-by="listtab" text:list-tab-stop-position="${indent}" fo:text-indent="-0.635cm" fo:margin-left="${indent}"/>` +
      `</style:list-level-properties>`;

    levels += ordered
      ? `<text:list-level-style-number text:level="${level}" style:num-format="1" style:num-suffix=".">${common}</text:list-level-style-number>`
      : `<text:list-level-style-bullet text:level="${level}" text:bullet-char="${level % 2 === 1 ? "•" : "◦"}">${common}</text:list-level-style-bullet>`;
  }

  return `<text:list-style style:name="${name}">${levels}</text:list-style>`;
}

function buildContentXml(blocks: ExportBlock[], state: OdtWriterState): string {
  // T_b / T_i are also used standalone (table headers, image alt fallback).
  const usedTextStyles = new Set([...collectTextStyles(blocks), "T_b", "T_i"]);

  // Word does not resolve parent-style-name chains between automatic styles,
  // so every paragraph style carries the body font explicitly instead of
  // inheriting it from P_default/Standard.
  const bodyFontProps = `<style:text-properties style:font-name="${BODY_FONT}" fo:font-family="${BODY_FONT}"/>`;

  const automaticStyles = [
    ...[...usedTextStyles].map(textStyleXml),
    `<style:style style:name="P_default" style:family="paragraph" style:parent-style-name="Standard"><style:paragraph-properties fo:margin-top="0.05cm" fo:margin-bottom="0.15cm"/>${bodyFontProps}</style:style>`,
    `<style:style style:name="P_center" style:family="paragraph" style:parent-style-name="Standard"><style:paragraph-properties fo:text-align="center"/>${bodyFontProps}</style:style>`,
    `<style:style style:name="P_right" style:family="paragraph" style:parent-style-name="Standard"><style:paragraph-properties fo:text-align="end"/>${bodyFontProps}</style:style>`,
    '<style:style style:name="P_code" style:family="paragraph"><style:paragraph-properties fo:background-color="#f4f4f4" fo:margin-left="0.2cm" fo:margin-top="0cm" fo:margin-bottom="0cm"/><style:text-properties style:font-name="Consolas" fo:font-family="Consolas" fo:font-size="9pt"/></style:style>',
    `<style:style style:name="P_quote" style:family="paragraph" style:parent-style-name="Standard"><style:paragraph-properties fo:margin-left="0.5cm" fo:border-left="0.06cm solid #c8c8c8" fo:padding="0.15cm" fo:margin-top="0.05cm" fo:margin-bottom="0.15cm"/><style:text-properties style:font-name="${BODY_FONT}" fo:font-family="${BODY_FONT}" fo:color="#666666"/></style:style>`,
    '<style:style style:name="P_hr" style:family="paragraph"><style:paragraph-properties fo:border-bottom="0.02cm solid #c8c8c8" fo:margin-top="0.3cm" fo:margin-bottom="0.3cm"/></style:style>',
    `<style:style style:name="P_task" style:family="paragraph" style:parent-style-name="Standard"><style:paragraph-properties fo:margin-left="0.635cm" fo:margin-top="0.05cm" fo:margin-bottom="0.15cm"/>${bodyFontProps}</style:style>`,
    '<style:style style:name="TC_body" style:family="table-cell"><style:table-cell-properties fo:border="0.018cm solid #c8c8c8" fo:padding="0.1cm"/></style:style>',
    '<style:style style:name="TC_header" style:family="table-cell"><style:table-cell-properties fo:border="0.018cm solid #c8c8c8" fo:padding="0.1cm" fo:background-color="#f0f0f0"/></style:style>',
    // Inline anchoring for image frames — see the draw:frame comment above.
    '<style:style style:name="G_inline" style:family="graphic"><style:graphic-properties style:vertical-pos="middle" style:vertical-rel="text" style:wrap="none" fo:margin="0cm"/></style:style>',
    buildListStyleXml("L_num", true),
    buildListStyleXml("L_bul", false)
  ]
    .filter(Boolean)
    .join("");

  return (
    '<?xml version="1.0" encoding="UTF-8"?>' +
    `<office:document-content ${CONTENT_XML_NAMESPACES} office:version="1.2">` +
    FONT_FACE_DECLS +
    `<office:automatic-styles>${automaticStyles}</office:automatic-styles>` +
    `<office:body><office:text>${blocksToOdtXml(blocks, state)}</office:text></office:body>` +
    "</office:document-content>"
  );
}

// Sans-serif everywhere: font-face declarations must exist in BOTH styles.xml
// and content.xml — style:font-name references only resolve against the decls
// of the file they appear in; Word falls back to its serif default otherwise.
// fo:font-family is set alongside as a second channel Word reads reliably.
const FONT_FACE_DECLS =
  "<office:font-face-decls>" +
  `<style:font-face style:name="${BODY_FONT}" svg:font-family="${BODY_FONT}" style:font-family-generic="swiss" style:font-pitch="variable"/>` +
  '<style:font-face style:name="Consolas" svg:font-family="Consolas" style:font-family-generic="modern" style:font-pitch="fixed"/>' +
  "</office:font-face-decls>";

function buildStylesXml(): string {
  const headingSizes = [20, 16, 13.5, 12, 11, 10.5];
  const headingStyles = headingSizes
    .map(
      (size, index) =>
        `<style:style style:name="Heading_20_${index + 1}" style:display-name="Heading ${index + 1}" style:family="paragraph" style:parent-style-name="Standard" style:next-style-name="Standard">` +
        `<style:paragraph-properties fo:margin-top="0.4cm" fo:margin-bottom="0.2cm" fo:keep-with-next="always"/>` +
        `<style:text-properties style:font-name="${BODY_FONT}" fo:font-family="${BODY_FONT}" fo:font-size="${size}pt" fo:font-weight="bold" fo:color="#1f2328"/>` +
        `</style:style>`
    )
    .join("");

  return (
    '<?xml version="1.0" encoding="UTF-8"?>' +
    `<office:document-styles ${CONTENT_XML_NAMESPACES} office:version="1.2">` +
    FONT_FACE_DECLS +
    "<office:styles>" +
    `<style:default-style style:family="paragraph"><style:text-properties style:font-name="${BODY_FONT}" fo:font-family="${BODY_FONT}"/></style:default-style>` +
    `<style:style style:name="Standard" style:family="paragraph"><style:text-properties style:font-name="${BODY_FONT}" fo:font-family="${BODY_FONT}"/></style:style>` +
    headingStyles +
    "</office:styles>" +
    "</office:document-styles>"
  );
}

function buildManifestXml(picturePaths: Iterable<string>): string {
  const pictureEntries = [...picturePaths]
    .map(
      (path) =>
        `<manifest:file-entry manifest:full-path="${escapeXml(path)}" manifest:media-type="image/png"/>`
    )
    .join("");

  return (
    '<?xml version="1.0" encoding="UTF-8"?>' +
    '<manifest:manifest xmlns:manifest="urn:oasis:names:tc:opendocument:xmlns:manifest:1.0" manifest:version="1.2">' +
    `<manifest:file-entry manifest:full-path="/" manifest:media-type="${ODT_MIMETYPE}"/>` +
    '<manifest:file-entry manifest:full-path="content.xml" manifest:media-type="text/xml"/>' +
    '<manifest:file-entry manifest:full-path="styles.xml" manifest:media-type="text/xml"/>' +
    pictureEntries +
    "</manifest:manifest>"
  );
}

export function renderOdtDocument(blocks: ExportBlock[], images: ExportImageMap): Uint8Array {
  const picturePaths = new Map<string, string>();
  const pictureFiles: Record<string, Uint8Array> = {};
  let pictureIndex = 0;

  for (const [src, asset] of images) {
    const path = `Pictures/image${pictureIndex}.png`;
    pictureIndex += 1;
    picturePaths.set(src, path);
    pictureFiles[path] = asset.pngBytes;
  }

  const state: OdtWriterState = { images, picturePaths, frameIndex: 0 };

  const archive: Zippable = {
    // Per ODF spec the mimetype entry must come first and stay uncompressed.
    mimetype: [strToU8(ODT_MIMETYPE), { level: 0 }],
    "META-INF/manifest.xml": strToU8(buildManifestXml(picturePaths.values())),
    "content.xml": strToU8(buildContentXml(blocks, state)),
    "styles.xml": strToU8(buildStylesXml()),
    ...pictureFiles
  };

  return zipSync(archive);
}
