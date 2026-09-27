import type { Content, TDocumentDefinitions } from "pdfmake/interfaces";

import {
  APP_FONTS,
  DEFAULT_DOCUMENT_STYLE,
  getFontScale,
  type DocumentStyle,
  type TableWidth
} from "@/lib/fonts";
import { getPageLayout } from "@/lib/pageSetup";

import type { ExportBlock, InlineRun } from "./markdownModel";
import type { ExportImageMap } from "./imageAssets";
import { computePagedImageSize } from "./imageSize";
import { captionAfter, isShortBlock } from "./keepTogether";
import { buildPageMap, pageMapToOrigins, type LaidOutBlock, type PageMap } from "./pageMap";
import {
  applyPagePlan,
  MIN_LINES_AT_PAGE_EDGE,
  planPages,
  SHORT_BLOCK_LINES,
  type FlowCandidate,
  type FlowLayout,
  type PagedDocument
} from "./pagePlan";
import { splitEmojiSegments } from "./emojiSegments";
import { registerPdfFont } from "./pdfFonts";
import { CELL_CHROME_PT, maxWordLength, maxWordLengthForColumn, splitOverlongWords } from "./pdfTableFit";
import { computeColumnShares, rowsFitWhole } from "./tableColumns";
import {
  PDF_BLOCK_MARGIN,
  PDF_BODY_SIZE_PT,
  PDF_CODE_CELL_MARGIN,
  PDF_CODE_INSET,
  PDF_CODE_SIZE_PT,
  PDF_HEADINGS,
  PDF_HR_MARGIN,
  PDF_IMAGE_MARGIN,
  PDF_LINE_HEIGHT,
  PDF_LIST_MARGIN,
  PDF_PARAGRAPH_MARGIN,
  PDF_QUOTE_BAR,
  PDF_TABLE_CELL_PADDING,
  PDF_TABLE_LINE_WIDTH as TABLE_LINE_WIDTH
} from "./pdfTypography";

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

const CODE_FILL_COLOR = "#f4f4f4";
const HIGHLIGHT_FILL_COLOR = "#fde68a";
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

// The text area of a page, which caps every image (computePagedImageSize).
type ImageBox = { width: number; height: number };

function runsToPdfText(runs: InlineRun[], images: ExportImageMap, box: ImageBox): Content[] {
  const parts: Content[] = [];

  for (const run of runs) {
    if (run.kind === "break") {
      parts.push({ text: "\n" });
      continue;
    }

    if (run.kind === "image") {
      const asset = images.get(run.src);

      if (asset) {
        // Honors the editor display width, capped at the printable area;
        // pdfmake keeps the aspect ratio from the width alone.
        // Both sides are given, so the page map worker can lay the image
        // out from a placeholder of the right size (pageMapWorker.ts).
        const { width, height } = computePagedImageSize(asset, run.width, box.width, box.height);
        parts.push({
          image: asset.pngDataUrl,
          width,
          height
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
      background: run.highlight ? HIGHLIGHT_FILL_COLOR : run.code ? CODE_FILL_COLOR : undefined,
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
function runsToBlockContent(runs: InlineRun[], images: ExportImageMap, box: ImageBox, style?: string): Content[] {
  const result: Content[] = [];
  let textBuffer: InlineRun[] = [];

  const flushText = () => {
    if (textBuffer.length > 0) {
      result.push({ text: runsToPdfText(textBuffer, images, box), style });
      textBuffer = [];
    }
  };

  for (const run of runs) {
    if (run.kind === "image" && images.has(run.src)) {
      flushText();
      const asset = images.get(run.src)!;
      const { width, height } = computePagedImageSize(asset, run.width, box.width, box.height);
      result.push({ image: asset.pngDataUrl, width, height, margin: [0, PDF_IMAGE_MARGIN, 0, PDF_IMAGE_MARGIN] });
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

// What the block renderer needs from the document style, handed down
// through nested quotes and lists.
type PdfLayout = {
  tableWidth: TableWidth;
  // Body font size in pt, after the user's scale.
  fontSize: number;
  // Width between the page margins in pt (lib/pageSetup.ts).
  contentWidth: number;
  // Height of a line of body text in pt.
  lineHeight: number;
  // Where images have to fit: the text area less the safety zone
  // (pagePlan.ts) and an image's own margins.
  imageBox: ImageBox;
  // False on the endless page of the flow layout: a page break would start a
  // second page there, and the keep-together flags lay parts out in
  // fragments whose recorded positions are off (a table's first row reports
  // its header's). Neither changes a height, which is all the flow is for.
  pageBreaks: boolean;
};

// Marks the words of a table cell that cannot fit their column, so pdfmake
// breaks those inside the word instead of pushing the table off the page
// (see pdfTableFit.ts). Images, emoji and line breaks pass through.
function fitCellText(parts: Content[], maxLength: number, maxLengthWide: number): Content[] {
  return parts.flatMap((part) => {
    const item = part as { text?: unknown; font?: string; bold?: boolean; image?: string };

    if (typeof item.text !== "string" || item.font === EMOJI_FONT || item.image) {
      return [part];
    }

    const wide = item.bold === true || item.font === "Courier";
    const segments = splitOverlongWords(item.text, wide ? maxLengthWide : maxLength);

    if (segments.length === 1 && !segments[0].breakAll) {
      return [part];
    }

    return segments.map(
      (segment) =>
        ({
          ...item,
          text: segment.text,
          ...(segment.breakAll ? { wordBreak: "break-all" } : {})
        }) as Content
    );
  });
}

function paragraphContent(block: Extract<ExportBlock, { kind: "paragraph" }>, images: ExportImageMap, layout: PdfLayout): Content[] {
  return runsToBlockContent(block.runs, images, layout.imageBox, "paragraph").map(
    (chunk) => (block.align && typeof chunk === "object" ? { ...chunk, alignment: block.align } : chunk) as Content
  );
}

// The rows a table's columns are measured from: the whole table, also for a
// part of one that was split across pages (pagePlan.ts).
function columnSource(block: Extract<ExportBlock, { kind: "table" }>) {
  return block.columnSource ?? block.rows;
}

/**
 * `onBlock` hears which of the returned items each block produced; the top
 * level uses it to tag them with the block's index for the page map.
 */
function blocksToPdfContent(
  blocks: ExportBlock[],
  images: ExportImageMap,
  layout: PdfLayout,
  onBlock?: (blockIndex: number, items: Content[]) => void
): Content[] {
  const content: Content[] = [];
  let breakBeforeNext = false;
  const finishBlock = (blockIndex: number, items: Content[]) => {
    if (breakBeforeNext && blocks[blockIndex].kind !== "pageBreak" && typeof items[0] === "object") {
      (items[0] as { pageBreak?: string }).pageBreak = "before";
      breakBeforeNext = false;
    }

    onBlock?.(blockIndex, items);
  };

  for (let index = 0; index < blocks.length; index++) {
    const block = blocks[index];
    const start = content.length;
    const blockIndex = index;
    const caption = captionAfter(blocks, index, images);

    // An image and its caption move to the next page together.
    if (block.kind === "paragraph" && caption?.kind === "paragraph") {
      content.push({
        stack: [...paragraphContent(block, images, layout), ...paragraphContent(caption, images, layout)],
        ...(layout.pageBreaks ? { unbreakable: true } : {})
      });
      index += 1;
      finishBlock(blockIndex, content.slice(start));
      continue;
    }

    switch (block.kind) {
      case "heading": {
        const level = Math.min(Math.max(block.level, 1), 6);
        content.push({
          text: runsToPdfText(block.runs, images, layout.imageBox),
          style: `h${level}`,
          alignment: block.align
        });
        break;
      }
      case "paragraph":
        content.push(...paragraphContent(block, images, layout));
        break;
      case "codeBlock":
        content.push({
          ...(layout.pageBreaks && isShortBlock(block) ? { unbreakable: true } : {}),
          table: {
            widths: ["*"],
            // Size comes from the "code" style so it scales with the document
            // text size along with everything else.
            body: [
              [
                {
                  text: block.text,
                  font: "Courier",
                  style: "code",
                  margin: [
                    PDF_CODE_CELL_MARGIN.horizontal,
                    PDF_CODE_CELL_MARGIN.vertical,
                    PDF_CODE_CELL_MARGIN.horizontal,
                    PDF_CODE_CELL_MARGIN.vertical
                  ]
                }
              ]
            ]
          },
          layout: {
            hLineWidth: () => 0,
            vLineWidth: () => 0,
            fillColor: () => CODE_FILL_COLOR
          },
          margin: [0, PDF_BLOCK_MARGIN.top, 0, PDF_BLOCK_MARGIN.bottom]
        });
        break;
      case "blockquote":
        content.push({
          table: {
            widths: [PDF_QUOTE_BAR, "*"],
            body: [
              [
                { text: "", fillColor: BORDER_COLOR },
                { stack: blocksToPdfContent(block.children, images, layout), color: MUTED_COLOR }
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
          margin: [0, PDF_BLOCK_MARGIN.top, 0, PDF_BLOCK_MARGIN.bottom]
        });
        break;
      case "list": {
        const items: Content[] = block.items.map((item) => {
          const stack = blocksToPdfContent(item.children, images, layout);

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
          ? { ol: items, start: block.start, margin: [0, PDF_LIST_MARGIN.top, 0, PDF_LIST_MARGIN.bottom] }
          : hasTaskItems
            ? { stack: items, margin: [4, PDF_LIST_MARGIN.top, 0, PDF_LIST_MARGIN.bottom] }
            : { ul: items, margin: [0, PDF_LIST_MARGIN.top, 0, PDF_LIST_MARGIN.bottom] };

        content.push(listContent);
        break;
      }
      case "table": {
        if (block.rows.length === 0) {
          break;
        }

        const measured = columnSource(block);
        const columnCount = Math.max(...measured.map((row) => row.length));
        // A full-width table gets the column split the print uses too
        // (tableColumns.ts), as widths of each column's text: the table's
        // width minus its one outer line, less each cell's padding and line.
        // So does a part of a split table of any width, so that its columns
        // line up with the part on the page before.
        const fixedWidths = layout.tableWidth !== "content" || block.columnSource !== undefined;
        const textWidths = fixedWidths
          ? computeColumnShares(measured, layout.contentWidth, layout.fontSize).map((share) =>
              Math.max(1, share * (layout.contentWidth - 1) - CELL_CHROME_PT)
            )
          : null;
        const wordLimits = Array.from({ length: columnCount }, (_, column) =>
          textWidths
            ? {
                plain: maxWordLengthForColumn(textWidths[column], layout.fontSize),
                wide: maxWordLengthForColumn(textWidths[column], layout.fontSize, true)
              }
            : {
                plain: maxWordLength(columnCount, layout.fontSize, layout.contentWidth),
                wide: maxWordLength(columnCount, layout.fontSize, layout.contentWidth, true)
              }
        );
        const body = block.rows.map((row) => {
          const cells: Content[] = row.map((cell, column) => ({
            // Header text is bold (set on the cell below), so it is measured
            // as the wider face.
            text: fitCellText(
              runsToPdfText(cell.runs, images, layout.imageBox).map((part) =>
                cell.header ? ({ ...(part as object), bold: true } as Content) : part
              ),
              wordLimits[column].plain,
              wordLimits[column].wide
            ),
            bold: cell.header || undefined,
            fillColor: cell.header ? "#f0f0f0" : undefined,
            alignment: cell.align
          }));

          while (cells.length < columnCount) {
            cells.push({ text: "" });
          }

          return cells;
        });

        const headerRows = block.rows[0]?.[0]?.header ? 1 : 0;

        content.push({
          ...(layout.pageBreaks && isShortBlock(block) ? { unbreakable: true } : {}),
          table: {
            headerRows,
            ...(layout.pageBreaks && headerRows ? { keepWithHeaderRows: 1 } : {}),
            dontBreakRows:
              layout.pageBreaks &&
              rowsFitWhole(block.rows, layout.contentWidth, layout.fontSize, layout.lineHeight, layout.imageBox.height),
            // "auto" sizes a column to its content, for the "content" table
            // width; the other cases have their widths worked out above.
            widths: textWidths ?? Array(columnCount).fill("auto"),
            body
          },
          layout: {
            hLineColor: () => BORDER_COLOR,
            vLineColor: () => BORDER_COLOR
          },
          margin: [0, PDF_BLOCK_MARGIN.top, 0, PDF_BLOCK_MARGIN.bottom]
        });
        break;
      }
      case "hr":
        content.push({
          canvas: [
            { type: "line", x1: 0, y1: 0, x2: layout.contentWidth, y2: 0, lineWidth: 0.5, lineColor: BORDER_COLOR }
          ],
          margin: [0, PDF_HR_MARGIN, 0, PDF_HR_MARGIN]
        });
        break;
      case "pageBreak":
        // Carried by the next block's first element ("before") rather than
        // by an element of its own: an empty text still takes a line, and at
        // the end of a full page that line alone spills onto an empty page.
        breakBeforeNext = layout.pageBreaks;
        break;
    }

    finishBlock(blockIndex, content.slice(start));
  }

  return content;
}

// Page, type sizes and the context the block renderer works in, shared by
// the flow layout and the paged one so both set exactly the same thing.
function documentSetup(style: DocumentStyle, bodyFont: string) {
  const scale = getFontScale(style.fontSizePt);
  const sized = (points: number) => Math.round(points * scale * 100) / 100;
  const page = getPageLayout(style.pageSize, style.pageMargins);
  const lineHeight = sized(PDF_BODY_SIZE_PT) * PDF_LINE_HEIGHT * APP_FONTS[style.fontId].pdfLineHeight;
  // One line of room at the bottom of every page (the safety zone, see
  // pagePlan.ts); an image never gets taller than what is left.
  const capacity = page.contentHeightPt - lineHeight;
  const layout: PdfLayout = {
    tableWidth: style.tableWidth ?? "full",
    fontSize: sized(PDF_BODY_SIZE_PT),
    contentWidth: page.contentWidthPt,
    lineHeight,
    imageBox: { width: page.contentWidthPt, height: capacity - 2 * PDF_IMAGE_MARGIN },
    pageBreaks: true
  };
  const base: Omit<TDocumentDefinitions, "content"> = {
    pageOrientation: "portrait",
    // pdfmake's order: left, top, right, bottom.
    pageMargins: [page.margins.left, page.margins.top, page.margins.right, page.margins.bottom],
    defaultStyle: { font: bodyFont, fontSize: sized(PDF_BODY_SIZE_PT), lineHeight: PDF_LINE_HEIGHT },
    styles: {
      ...Object.fromEntries(
        PDF_HEADINGS.map((heading, index) => [
          `h${index + 1}`,
          {
            fontSize: sized(heading.sizePt),
            bold: true,
            margin: [0, heading.marginTop, 0, heading.marginBottom],
            ...(index === 5 ? { color: MUTED_COLOR } : {})
          }
        ])
      ),
      paragraph: { margin: [0, PDF_PARAGRAPH_MARGIN.top, 0, PDF_PARAGRAPH_MARGIN.bottom] },
      code: { fontSize: sized(PDF_CODE_SIZE_PT) }
    }
  };

  return { page, layout, capacity, base };
}

/**
 * The pdfmake document for a block list, with the body font already
 * registered under `bodyFont`, as it is rendered: pass it the planned blocks
 * (planPdfDocument) for pages that end where the page lines say.
 */
export function buildPdfDocumentDefinition(
  title: string,
  blocks: ExportBlock[],
  images: ExportImageMap,
  style: DocumentStyle,
  bodyFont: string
): TDocumentDefinitions {
  const { page, layout, base } = documentSetup(style, bodyFont);
  const content = blocksToPdfContent(blocks, images, layout, (blockIndex, items) =>
    // The block index travels in the id, which readPageMap reads back.
    items.forEach((item, part) => {
      if (typeof item === "object") {
        (item as { id?: string }).id = `${BLOCK_ID_PREFIX}${blockIndex}:${part}`;
      }
    })
  );

  return {
    ...base,
    info: { title },
    pageSize: { width: page.widthPt, height: page.heightPt },
    content
  };
}

const BLOCK_ID_PREFIX = "block:";

/**
 * Which page every block landed on, read from a document definition pdfmake
 * has laid out (it writes a position per line onto the nodes). Block indices
 * refer to the list given to buildPdfDocumentDefinition.
 */
export function readPageMap(definition: TDocumentDefinitions): PageMap {
  const byBlock = new Map<number, LaidOutBlock>();

  for (const item of definition.content as Content[]) {
    const node = item as { id?: string; positions?: { pageNumber: number }[] };
    const match = node.id?.startsWith(BLOCK_ID_PREFIX) ? /^(\d+):/.exec(node.id.slice(BLOCK_ID_PREFIX.length)) : null;

    if (!match) {
      continue;
    }

    const blockIndex = Number(match[1]);
    const entry = byBlock.get(blockIndex) ?? { blockIndex, lines: [] };
    entry.lines.push(...(node.positions ?? []).map((position) => position.pageNumber));
    byBlock.set(blockIndex, entry);
  }

  return buildPageMap([...byBlock.values()]);
}

// ---------------------------------------------------------------------------
// The flow: the document on one endless page, to plan the pages from
// ---------------------------------------------------------------------------

type Positioned = { positions?: Array<{ top: number }> };

/** What the flow layout needs to be read back after pdfmake has laid it out. */
export type FlowRecording = {
  entries: Array<{ blockIndex: number; block: ExportBlock; marker: Content; items: Content[]; mandatory: boolean }>;
  end: Content;
  marginTop: number;
  lineHeight: number;
  /** The text area less the safety zone. */
  capacity: number;
};

// A zero-height mark: pdfmake records where it sits, which is exactly where
// the content that follows begins, margins included.
function flowMarker(): Content {
  return { canvas: [{ type: "line", x1: 0, y1: 0, x2: 0, y2: 0, lineWidth: 0 }] };
}

/**
 * The blocks on a single page of endless height, with a marker in front of
 * every block. Manual page breaks are left out and remembered: on an endless
 * page they would start a second one.
 */
export function buildFlowDefinition(
  blocks: ExportBlock[],
  images: ExportImageMap,
  style: DocumentStyle,
  bodyFont: string
): { definition: TDocumentDefinitions; recording: FlowRecording } {
  const { page, layout, capacity, base } = documentSetup(style, bodyFont);
  const entries: FlowRecording["entries"] = [];
  let afterManualBreak = false;

  blocksToPdfContent(blocks, images, { ...layout, pageBreaks: false }, (blockIndex, items) => {
    const block = blocks[blockIndex];

    if (block.kind === "pageBreak") {
      afterManualBreak = entries.length > 0;
      return;
    }

    entries.push({ blockIndex, block, marker: flowMarker(), items, mandatory: afterManualBreak });
    afterManualBreak = false;
  });

  const end = flowMarker();

  return {
    definition: {
      ...base,
      pageSize: { width: page.widthPt, height: "auto" },
      content: [...entries.flatMap((entry) => [entry.marker, ...entry.items]), end]
    },
    recording: { entries, end, marginTop: page.margins.top, lineHeight: layout.lineHeight, capacity }
  };
}

function firstTop(node: unknown): number | undefined {
  if (!node || typeof node !== "object") {
    return undefined;
  }

  const candidate = node as Positioned & { stack?: unknown[]; columns?: unknown[] };
  const own = candidate.positions?.[0]?.top;

  if (own !== undefined) {
    return own;
  }

  for (const child of [...(candidate.stack ?? []), ...(candidate.columns ?? [])]) {
    const top = firstTop(child);

    if (top !== undefined) {
      return top;
    }
  }

  return undefined;
}

/** The candidates for a page break, read off a laid-out flow definition. */
export function readFlowLayout(recording: FlowRecording): FlowLayout {
  const y = (top: number) => top - recording.marginTop;
  const candidates: FlowCandidate[] = [];
  const reserve = recording.lineHeight;

  recording.entries.forEach((entry, position) => {
    const { blockIndex, block, items } = entry;
    const markerTop = (entry.marker as Positioned).positions?.[0]?.top;

    if (markerTop === undefined) {
      return;
    }

    // A page may begin with the block, except right after a heading: that
    // stays with what it introduces.
    const previous = recording.entries[position - 1];

    if (position > 0 && (entry.mandatory || previous.block.kind !== "heading")) {
      candidates.push({
        y: y(markerTop),
        blockIndex,
        inner: null,
        topExtra: 0,
        tailExtra: 0,
        ...(entry.mandatory ? { mandatory: true } : {})
      });
    }

    const [item] = items;

    if (items.length !== 1 || !item || typeof item !== "object") {
      return;
    }

    switch (block.kind) {
      case "paragraph": {
        const lines = ((item as Positioned).positions ?? []).map((line) => line.top);

        // Two lines stay on either page; a paragraph shorter than that moves whole.
        if ((item as { text?: unknown }).text === undefined || lines.length < SHORT_BLOCK_LINES) {
          return;
        }

        for (let line = MIN_LINES_AT_PAGE_EDGE; line <= lines.length - MIN_LINES_AT_PAGE_EDGE; line++) {
          candidates.push({
            y: y(lines[line]),
            blockIndex,
            inner: { kind: "paragraphLine", line, lines: lines.length },
            tailExtra: PDF_PARAGRAPH_MARGIN.bottom,
            // The second part's own margin, and a line in reserve: the cut is
            // made at a word estimated on the early side, which can push one
            // more line onto the new page.
            topExtra: PDF_PARAGRAPH_MARGIN.top + reserve
          });
        }
        return;
      }
      case "codeBlock": {
        const cell = (item as { table?: { body: Positioned[][] } }).table?.body[0]?.[0];
        const lines = (cell?.positions ?? []).map((line) => line.top);

        // Only where no line wraps, so a laid-out line is a line of the code.
        if (lines.length < SHORT_BLOCK_LINES || lines.length !== block.text.split("\n").length) {
          return;
        }

        for (let line = MIN_LINES_AT_PAGE_EDGE; line <= lines.length - MIN_LINES_AT_PAGE_EDGE; line++) {
          candidates.push({
            y: y(lines[line]),
            blockIndex,
            inner: { kind: "codeLine", line },
            tailExtra: PDF_CODE_INSET.vertical + PDF_BLOCK_MARGIN.bottom,
            topExtra: PDF_BLOCK_MARGIN.top + PDF_CODE_INSET.vertical
          });
        }
        return;
      }
      case "table": {
        const body = (item as { table?: { body: Positioned[][] } }).table?.body ?? [];

        if (body.length < SHORT_BLOCK_LINES) {
          return;
        }

        // A row begins one line and the cell padding above its text.
        const rowTops = body.map((row) => {
          const tops = row.map((cell) => cell.positions?.[0]?.top).filter((top): top is number => top !== undefined);
          return tops.length > 0 ? Math.min(...tops) - PDF_TABLE_CELL_PADDING.vertical - TABLE_LINE_WIDTH : undefined;
        });
        const hasHeader = block.rows[0]?.[0]?.header === true;
        const headerHeight = hasHeader && rowTops[0] !== undefined && rowTops[1] !== undefined ? rowTops[1] - rowTops[0] : 0;

        // Never after the header alone, and the new part repeats it.
        for (let row = hasHeader ? 2 : 1; row < body.length; row++) {
          const top = rowTops[row];

          if (top !== undefined) {
            candidates.push({
              y: y(top),
              blockIndex,
              inner: { kind: "tableRow", row },
              tailExtra: TABLE_LINE_WIDTH + PDF_BLOCK_MARGIN.bottom,
              topExtra: PDF_BLOCK_MARGIN.top + headerHeight
            });
          }
        }
        return;
      }
      case "list": {
        const listItems = ((item as { ul?: unknown[]; ol?: unknown[]; stack?: unknown[] }).ul ??
          (item as { ol?: unknown[] }).ol ??
          (item as { stack?: unknown[] }).stack ??
          []) as unknown[];

        if (listItems.length < SHORT_BLOCK_LINES) {
          return;
        }

        for (let index = MIN_LINES_AT_PAGE_EDGE; index <= listItems.length - MIN_LINES_AT_PAGE_EDGE; index++) {
          const top = firstTop(listItems[index]);

          if (top !== undefined) {
            candidates.push({
              y: y(top - PDF_PARAGRAPH_MARGIN.top),
              blockIndex,
              inner: { kind: "listItem", item: index },
              tailExtra: PDF_LIST_MARGIN.bottom,
              topExtra: PDF_LIST_MARGIN.top
            });
          }
        }
        return;
      }
      default:
        return;
    }
  });

  const endTop = (recording.end as Positioned).positions?.[0]?.top ?? recording.marginTop;

  return { candidates, end: y(endTop) };
}

/** The document cut where its pages will end, read from a laid-out flow. */
export function planFromFlow(blocks: ExportBlock[], recording: FlowRecording): PagedDocument {
  return applyPagePlan(blocks, planPages(readFlowLayout(recording), recording.capacity));
}

async function loadRegisteredPdfMake(style: DocumentStyle) {
  const pdfMake = await loadPdfMake();
  // Falls back to Roboto when the family cannot be embedded, so a font issue
  // never costs the user the export itself.
  const bodyFont = await registerPdfFont(
    pdfMake as unknown as Parameters<typeof registerPdfFont>[0],
    style.fontId
  );

  return { pdfMake, bodyFont };
}

/**
 * The blocks cut where the pages will end, with a hard page break in every
 * cut (pagePlan.ts): what the PDF renders, and the direct print too, so both
 * break exactly where the page lines are.
 */
export async function planPdfDocument(
  blocks: ExportBlock[],
  images: ExportImageMap,
  style: DocumentStyle = DEFAULT_DOCUMENT_STYLE
): Promise<PagedDocument> {
  const { pdfMake, bodyFont } = await loadRegisteredPdfMake(style);
  const { definition, recording } = buildFlowDefinition(blocks, images, style, bodyFont);

  await pdfMake.createPdf(definition).getBuffer();

  return planFromFlow(blocks, recording);
}

export async function renderPdfDocument(
  title: string,
  blocks: ExportBlock[],
  images: ExportImageMap,
  style: DocumentStyle = DEFAULT_DOCUMENT_STYLE
): Promise<Uint8Array> {
  const { pdfMake, bodyFont } = await loadRegisteredPdfMake(style);
  const flow = buildFlowDefinition(blocks, images, style, bodyFont);

  await pdfMake.createPdf(flow.definition).getBuffer();

  const paged = planFromFlow(blocks, flow.recording);
  const buffer = await pdfMake
    .createPdf(buildPdfDocumentDefinition(title, paged.blocks, images, style, bodyFont))
    .getBuffer();

  return new Uint8Array(buffer);
}

/**
 * Plans and lays the blocks out exactly as renderPdfDocument does and reports
 * where the pages break, without keeping the PDF: a planned break with the
 * exact place inside its block, a break pdfmake had to make on its own
 * (inside a block taller than a page) roughly. pdfmake has no layout-only
 * entry point; the rendering it does on top is a small share of the time.
 */
export async function layoutPdfPageMap(
  blocks: ExportBlock[],
  images: ExportImageMap,
  style: DocumentStyle = DEFAULT_DOCUMENT_STYLE
): Promise<PageMap> {
  const { pdfMake, bodyFont } = await loadRegisteredPdfMake(style);
  const flow = buildFlowDefinition(blocks, images, style, bodyFont);

  await pdfMake.createPdf(flow.definition).getBuffer();

  const paged = planFromFlow(blocks, flow.recording);
  const definition = buildPdfDocumentDefinition("", paged.blocks, images, style, bodyFont);

  await pdfMake.createPdf(definition).getBuffer();

  return pageMapToOrigins(readPageMap(definition), paged.origins);
}
