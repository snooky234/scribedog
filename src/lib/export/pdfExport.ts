import type { Content, TDocumentDefinitions } from "pdfmake/interfaces";

import type { ExportBlock, InlineRun } from "./markdownModel";
import { computeExportImageSize, type ExportImageMap } from "./imageAssets";
import { splitEmojiSegments } from "./emojiSegments";

type PdfMakeModule = typeof import("pdfmake/build/pdfmake");

type FontContainer = {
  vfs: Record<string, unknown>;
  fonts: Record<string, unknown>;
};

const EMOJI_FONT = "NotoEmoji";

// pdfmake plus its embedded fonts weigh several megabytes — load them lazily
// on the first PDF export instead of on app start. The UMD bundles may expose
// their exports either directly or under `default` depending on the
// bundler's CJS interop, hence the defensive unwrapping.
let pdfMakePromise: Promise<PdfMakeModule> | null = null;

function unwrapModule<T>(module: unknown): T {
  const withDefault = module as { default?: T };
  return (withDefault.default ?? module) as T;
}

async function loadPdfMake(): Promise<PdfMakeModule> {
  if (!pdfMakePromise) {
    pdfMakePromise = (async () => {
      const [pdfMakeModule, robotoModule, courierModule, emojiFontModule] = await Promise.all([
        import("pdfmake/build/pdfmake"),
        import("pdfmake/build/fonts/Roboto.js"),
        import("pdfmake/build/standard-fonts/Courier.js"),
        import("./notoEmojiFont")
      ]);

      const pdfMake = unwrapModule<PdfMakeModule>(pdfMakeModule);
      // Must be invoked as methods — these use `this` internally.
      const pdfMakeWithFonts = pdfMake as unknown as {
        addFontContainer: (container: FontContainer) => void;
        addVirtualFileSystem: (vfs: Record<string, string>) => void;
        addFonts: (fonts: Record<string, unknown>) => void;
      };

      pdfMakeWithFonts.addFontContainer(unwrapModule<FontContainer>(robotoModule));
      pdfMakeWithFonts.addFontContainer(unwrapModule<FontContainer>(courierModule));

      // Register the embedded emoji face; the four styles all map to the same
      // glyph-only file since it has no bold/italic variants.
      pdfMakeWithFonts.addVirtualFileSystem({
        [emojiFontModule.NOTO_EMOJI_FONT_FILE]: emojiFontModule.notoEmojiFontBase64
      });
      pdfMakeWithFonts.addFonts({
        [EMOJI_FONT]: {
          normal: emojiFontModule.NOTO_EMOJI_FONT_FILE,
          bold: emojiFontModule.NOTO_EMOJI_FONT_FILE,
          italics: emojiFontModule.NOTO_EMOJI_FONT_FILE,
          bolditalics: emojiFontModule.NOTO_EMOJI_FONT_FILE
        }
      });

      return pdfMake;
    })();
  }

  return pdfMakePromise;
}

const PAGE_CONTENT_WIDTH = 451; // A4 (595pt) minus the 72pt margins on both sides.
const CODE_FILL_COLOR = "#f4f4f4";
const BORDER_COLOR = "#c8c8c8";
const MUTED_COLOR = "#666666";

// Task-list checkbox as inline SVG (rendered via pdfmake's SVG support), so
// the box doesn't depend on a font carrying the ballot glyphs.
function checkboxSvg(checked: boolean): string {
  const box =
    '<rect x="1.5" y="1.5" width="13" height="13" rx="2.5" fill="none" stroke="#3f3f46" stroke-width="1.5"/>';
  const tick = checked
    ? '<path d="M4.5 8.5 L7 11 L11.5 5" fill="none" stroke="#3f3f46" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>'
    : "";
  return `<svg width="16" height="16" viewBox="0 0 16 16" xmlns="http://www.w3.org/2000/svg">${box}${tick}</svg>`;
}

function runsToPdfText(runs: InlineRun[], images: ExportImageMap): Content[] {
  const parts: Content[] = [];

  for (const run of runs) {
    if (run.kind === "break") {
      parts.push({ text: "\n" });
      continue;
    }

    if (run.kind === "image") {
      const asset = images.get(run.src);

      if (asset) {
        // Honors the editor display width, capped at the printable width;
        // pdfmake keeps the aspect ratio from the width alone.
        const { width } = computeExportImageSize(asset, run.width, PAGE_CONTENT_WIDTH);
        parts.push({
          image: asset.pngDataUrl,
          width
        });
      } else if (run.alt) {
        parts.push({ text: run.alt, italics: true, color: MUTED_COLOR });
      }

      continue;
    }

    const baseStyle = {
      bold: run.bold || undefined,
      italics: run.italic || undefined,
      decoration: run.underline ? "underline" : run.strike ? "lineThrough" : undefined,
      background: run.code ? CODE_FILL_COLOR : undefined,
      link: run.link ?? undefined,
      color: run.link ? "#0969da" : undefined
    };
    const bodyFont = run.code ? "Courier" : undefined;

    // Emoji glyphs only exist in the embedded NotoEmoji face, so each emoji
    // run of the text is tagged with it while the rest keeps the body font.
    for (const segment of splitEmojiSegments(run.text)) {
      parts.push({
        text: segment.text,
        font: segment.emoji ? EMOJI_FONT : bodyFont,
        ...baseStyle
      } as Content);
    }
  }

  return parts;
}

// Inline images can't sit inside a pdfmake text array, so a paragraph whose
// runs contain images is split into alternating text and image chunks.
function runsToBlockContent(runs: InlineRun[], images: ExportImageMap, style?: string): Content[] {
  const result: Content[] = [];
  let textBuffer: InlineRun[] = [];

  const flushText = () => {
    if (textBuffer.length > 0) {
      result.push({ text: runsToPdfText(textBuffer, images), style });
      textBuffer = [];
    }
  };

  for (const run of runs) {
    if (run.kind === "image" && images.has(run.src)) {
      flushText();
      const asset = images.get(run.src)!;
      const { width } = computeExportImageSize(asset, run.width, PAGE_CONTENT_WIDTH);
      result.push({ image: asset.pngDataUrl, width, margin: [0, 2, 0, 2] });
    } else {
      textBuffer.push(run);
    }
  }

  flushText();

  if (result.length === 0) {
    result.push({ text: "", style });
  }

  return result;
}

function blocksToPdfContent(blocks: ExportBlock[], images: ExportImageMap): Content[] {
  const content: Content[] = [];

  for (const block of blocks) {
    switch (block.kind) {
      case "heading": {
        const level = Math.min(Math.max(block.level, 1), 6);
        content.push({ text: runsToPdfText(block.runs, images), style: `h${level}` });
        break;
      }
      case "paragraph":
        for (const chunk of runsToBlockContent(block.runs, images, "paragraph")) {
          content.push(chunk);
        }
        break;
      case "codeBlock":
        content.push({
          table: {
            widths: ["*"],
            body: [[{ text: block.text, font: "Courier", fontSize: 9, margin: [8, 6, 8, 6] }]]
          },
          layout: {
            hLineWidth: () => 0,
            vLineWidth: () => 0,
            fillColor: () => CODE_FILL_COLOR
          },
          margin: [0, 4, 0, 8]
        });
        break;
      case "blockquote":
        content.push({
          table: {
            widths: [2, "*"],
            body: [
              [
                { text: "", fillColor: BORDER_COLOR },
                { stack: blocksToPdfContent(block.children, images), color: MUTED_COLOR }
              ]
            ]
          },
          layout: {
            hLineWidth: () => 0,
            vLineWidth: () => 0,
            paddingLeft: () => 0,
            paddingTop: () => 0,
            paddingBottom: () => 0
          },
          margin: [0, 4, 0, 8]
        });
        break;
      case "list": {
        const items: Content[] = block.items.map((item) => {
          const stack = blocksToPdfContent(item.children, images);

          if (item.checked === null) {
            return stack.length === 1 ? stack[0] : { stack };
          }

          // Task list: draw the checkbox with canvas instead of a glyph.
          // Neither Roboto nor the emoji face carries both the empty and
          // checked box, so drawing keeps the two states visually consistent.
          return {
            columns: [{ svg: checkboxSvg(item.checked), width: 12 }, { stack, width: "*" }],
            columnGap: 4
          };
        });

        const hasTaskItems = block.items.some((item) => item.checked !== null);
        const listContent: Content = block.ordered
          ? { ol: items, start: block.start, margin: [0, 2, 0, 6] }
          : hasTaskItems
            ? { stack: items, margin: [4, 2, 0, 6] }
            : { ul: items, margin: [0, 2, 0, 6] };

        content.push(listContent);
        break;
      }
      case "table": {
        if (block.rows.length === 0) {
          break;
        }

        const columnCount = Math.max(...block.rows.map((row) => row.length));
        const body = block.rows.map((row) => {
          const cells: Content[] = row.map((cell) => ({
            text: runsToPdfText(cell.runs, images),
            bold: cell.header || undefined,
            fillColor: cell.header ? "#f0f0f0" : undefined,
            alignment: cell.align
          }));

          while (cells.length < columnCount) {
            cells.push({ text: "" });
          }

          return cells;
        });

        content.push({
          table: {
            headerRows: block.rows[0]?.[0]?.header ? 1 : 0,
            widths: Array(columnCount).fill("auto"),
            body
          },
          layout: {
            hLineColor: () => BORDER_COLOR,
            vLineColor: () => BORDER_COLOR
          },
          margin: [0, 4, 0, 8]
        });
        break;
      }
      case "hr":
        content.push({
          canvas: [
            { type: "line", x1: 0, y1: 0, x2: PAGE_CONTENT_WIDTH, y2: 0, lineWidth: 0.5, lineColor: BORDER_COLOR }
          ],
          margin: [0, 10, 0, 10]
        });
        break;
    }
  }

  return content;
}

export async function renderPdfDocument(
  title: string,
  blocks: ExportBlock[],
  images: ExportImageMap
): Promise<Uint8Array> {
  const pdfMake = await loadPdfMake();

  const documentDefinition: TDocumentDefinitions = {
    info: { title },
    pageSize: "A4",
    pageMargins: [72, 72, 72, 72],
    defaultStyle: { font: "Roboto", fontSize: 10.5, lineHeight: 1.35 },
    styles: {
      h1: { fontSize: 22, bold: true, margin: [0, 14, 0, 8] },
      h2: { fontSize: 17, bold: true, margin: [0, 12, 0, 6] },
      h3: { fontSize: 14, bold: true, margin: [0, 10, 0, 5] },
      h4: { fontSize: 12, bold: true, margin: [0, 8, 0, 4] },
      h5: { fontSize: 10.5, bold: true, margin: [0, 8, 0, 4] },
      h6: { fontSize: 10.5, bold: true, color: MUTED_COLOR, margin: [0, 8, 0, 4] },
      paragraph: { margin: [0, 2, 0, 6] }
    },
    content: blocksToPdfContent(blocks, images)
  };

  const buffer = await pdfMake.createPdf(documentDefinition).getBuffer();

  return new Uint8Array(buffer);
}
