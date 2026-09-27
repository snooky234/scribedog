import {
  AlignmentType,
  BorderStyle,
  Document,
  ExternalHyperlink,
  HeadingLevel,
  ImageRun,
  LevelFormat,
  Packer,
  PageBreak,
  Paragraph,
  ShadingType,
  Table,
  TableCell,
  TableRow,
  TextRun,
  WidthType,
  type IParagraphOptions,
  type ParagraphChild
} from "docx";

import {
  DEFAULT_DOCUMENT_STYLE,
  getFontScale,
  getReferencedFontName,
  type DocumentStyle,
  type TableWidth
} from "@/lib/fonts";
import { getPageLayout, ptToPx, ptToTwips } from "@/lib/pageSetup";

import type {
  BlockAlign,
  ExportBlock,
  InlineRun,
  TableCell as ModelTableCell
} from "./markdownModel";
import { computeExportImageSize, type ExportImageMap } from "./imageAssets";

const ORDERED_LIST_REFERENCE = "scribedog-ordered";
// DOCX references a font by name rather than embedding it, so the reader
// substitutes when the family is missing. The system default resolves to Arial
// — the safest sans-serif across Windows, macOS and most Linux setups; Word
// and LibreOffice would otherwise fall back to their serif or Calibri-Light
// defaults.
const MONO_FONT = "Consolas";
const CODE_FILL = "F4F4F4";
const BORDER_COLOR = "C8C8C8";
const MUTED_COLOR = "666666";

// Heading sizes in half-points (docx unit), roughly matching the HTML export.
const HEADING_SIZES_HALF_PT = [40, 34, 28, 24, 22, 21];

// What the block renderer needs from the document style, handed down through
// nested quotes and lists.
type DocxLayout = {
  tableWidth: TableWidth;
  // Width between the page margins in px at 96dpi; images are scaled down to it.
  maxImageWidthPx: number;
};

const HEADING_BY_LEVEL = [
  HeadingLevel.HEADING_1,
  HeadingLevel.HEADING_2,
  HeadingLevel.HEADING_3,
  HeadingLevel.HEADING_4,
  HeadingLevel.HEADING_5,
  HeadingLevel.HEADING_6
] as const;

function runsToDocxChildren(
  runs: InlineRun[],
  images: ExportImageMap,
  maxImageWidthPx: number,
  forceBold = false
): ParagraphChild[] {
  const children: ParagraphChild[] = [];

  for (const run of runs) {
    if (run.kind === "break") {
      children.push(new TextRun({ break: 1 }));
      continue;
    }

    if (run.kind === "image") {
      const asset = images.get(run.src);

      if (asset) {
        const size = computeExportImageSize(asset, run.width, maxImageWidthPx);
        children.push(
          new ImageRun({
            type: "png",
            data: asset.pngBytes,
            transformation: {
              width: Math.round(size.width),
              height: Math.round(size.height)
            }
          })
        );
      } else if (run.alt) {
        children.push(new TextRun({ text: run.alt, italics: true, color: MUTED_COLOR }));
      }

      continue;
    }

    const textRun = new TextRun({
      text: run.text,
      bold: run.bold || forceBold,
      italics: run.italic,
      underline: run.underline ? {} : undefined,
      highlight: run.highlight ? "yellow" : undefined,
      strike: run.strike,
      font: run.code ? MONO_FONT : undefined,
      shading: run.code ? { type: ShadingType.CLEAR, fill: CODE_FILL } : undefined,
      style: run.link ? "Hyperlink" : undefined
    });

    if (run.link) {
      children.push(new ExternalHyperlink({ children: [textRun], link: run.link }));
    } else {
      children.push(textRun);
    }
  }

  return children;
}

function docxAlignment(align: BlockAlign | undefined): (typeof AlignmentType)[keyof typeof AlignmentType] | undefined {
  if (align === "center") {
    return AlignmentType.CENTER;
  }

  if (align === "right") {
    return AlignmentType.RIGHT;
  }

  return undefined;
}

type ListContext = {
  ordered: boolean;
  level: number;
};

function blocksToDocxElements(
  blocks: ExportBlock[],
  images: ExportImageMap,
  listContext: ListContext | null,
  inQuote: boolean,
  layout: DocxLayout
): Array<Paragraph | Table> {
  const elements: Array<Paragraph | Table> = [];

  const quoteOptions = (): Partial<IParagraphOptions> =>
    inQuote
      ? {
          indent: { left: 360 },
          border: { left: { style: BorderStyle.SINGLE, size: 18, color: BORDER_COLOR, space: 8 } }
        }
      : {};

  const listParagraphOptions = (): Partial<IParagraphOptions> => {
    if (!listContext) {
      return {};
    }

    return listContext.ordered
      ? { numbering: { reference: ORDERED_LIST_REFERENCE, level: listContext.level } }
      : { bullet: { level: listContext.level } };
  };

  for (const block of blocks) {
    switch (block.kind) {
      case "heading": {
        const level = Math.min(Math.max(block.level, 1), 6);
        elements.push(
          new Paragraph({
            heading: HEADING_BY_LEVEL[level - 1],
            alignment: docxAlignment(block.align),
            children: runsToDocxChildren(block.runs, images, layout.maxImageWidthPx)
          })
        );
        break;
      }
      case "paragraph":
        elements.push(
          new Paragraph({
            ...quoteOptions(),
            ...listParagraphOptions(),
            alignment: docxAlignment(block.align),
            children: runsToDocxChildren(block.runs, images, layout.maxImageWidthPx)
          })
        );
        break;
      case "codeBlock": {
        const lines = block.text.split("\n");
        elements.push(
          ...lines.map(
            (line, index) =>
              new Paragraph({
                // Font and size live in the CodeBlock style so they scale with
                // the document text size instead of being pinned here.
                style: "CodeBlock",
                children: [new TextRun({ text: line })],
                shading: { type: ShadingType.CLEAR, fill: CODE_FILL },
                spacing: {
                  before: index === 0 ? 120 : 0,
                  after: index === lines.length - 1 ? 120 : 0
                }
              })
          )
        );
        break;
      }
      case "blockquote":
        elements.push(...blocksToDocxElements(block.children, images, listContext, true, layout));
        break;
      case "list": {
        for (const item of block.items) {
          if (item.checked !== null) {
            // Task item: checkbox glyph instead of a numbered/bulleted marker.
            const [first, ...rest] = item.children;
            const firstRuns = first?.kind === "paragraph" ? first.runs : [];
            elements.push(
              new Paragraph({
                indent: { left: 360 * ((listContext?.level ?? 0) + 1) },
                children: [
                  new TextRun({ text: item.checked ? "☑ " : "☐ " }),
                  ...runsToDocxChildren(firstRuns, images, layout.maxImageWidthPx)
                ]
              })
            );

            const restBlocks = first?.kind === "paragraph" ? rest : item.children;
            elements.push(
              ...blocksToDocxElements(
                restBlocks,
                images,
                { ordered: false, level: Math.min((listContext?.level ?? -1) + 1, 8) },
                false,
                layout
              )
            );
            continue;
          }

          const level = Math.min((listContext?.level ?? -1) + 1, 8);
          const [first, ...rest] = item.children;

          if (first?.kind === "paragraph") {
            elements.push(
              ...blocksToDocxElements([first], images, { ordered: block.ordered, level }, false, layout)
            );
            elements.push(
              ...blocksToDocxElements(rest, images, { ordered: block.ordered, level }, false, layout)
            );
          } else {
            elements.push(
              ...blocksToDocxElements(
                item.children,
                images,
                { ordered: block.ordered, level },
                false,
                layout
              )
            );
          }
        }
        break;
      }
      case "table": {
        if (block.rows.length === 0) {
          break;
        }

        elements.push(
          new Table({
            // AUTO lets Word size the table to its contents; a percentage
            // stretches it across the text width, as the editor setting does.
            width:
              layout.tableWidth === "content"
                ? { size: 0, type: WidthType.AUTO }
                : { size: 100, type: WidthType.PERCENTAGE },
            rows: block.rows.map(
              (row) =>
                new TableRow({
                  children: row.map((cell) => modelCellToDocxCell(cell, images, layout.maxImageWidthPx))
                })
            )
          })
        );
        // Word renders consecutive content flush against tables; add spacing.
        elements.push(new Paragraph({ spacing: { after: 0 }, children: [] }));
        break;
      }
      case "hr":
        elements.push(
          new Paragraph({
            border: {
              bottom: { style: BorderStyle.SINGLE, size: 6, color: BORDER_COLOR }
            },
            spacing: { before: 160, after: 160 },
            children: []
          })
        );
        break;
      case "pageBreak":
        elements.push(new Paragraph({ children: [new PageBreak()] }));
        break;
    }
  }

  return elements;
}

function modelCellToDocxCell(cell: ModelTableCell, images: ExportImageMap, maxImageWidthPx: number): TableCell {
  return new TableCell({
    shading: cell.header ? { type: ShadingType.CLEAR, fill: "F0F0F0" } : undefined,
    margins: { top: 60, bottom: 60, left: 100, right: 100 },
    children: [
      new Paragraph({
        alignment:
          cell.align === "center"
            ? AlignmentType.CENTER
            : cell.align === "right"
              ? AlignmentType.RIGHT
              : AlignmentType.LEFT,
        children: runsToDocxChildren(cell.runs, images, maxImageWidthPx, cell.header)
      })
    ]
  });
}

export async function renderDocxDocument(
  title: string,
  blocks: ExportBlock[],
  images: ExportImageMap,
  style: DocumentStyle = DEFAULT_DOCUMENT_STYLE
): Promise<Uint8Array> {
  const bodyFont = getReferencedFontName(style.fontId);
  const scale = getFontScale(style.fontSizePt);
  // docx sizes are in half-points and must stay whole numbers.
  const halfPoints = (value: number) => Math.round(value * scale);
  const page = getPageLayout(style.pageSize, style.pageMargins);
  const layout: DocxLayout = {
    tableWidth: style.tableWidth ?? "full",
    maxImageWidthPx: Math.floor(ptToPx(page.contentWidthPt))
  };

  const document = new Document({
    title,
    styles: {
      // Body default: the chosen family everywhere unless a run overrides the
      // font (code runs / mono still opt into Consolas explicitly).
      default: {
        document: {
          run: { font: bodyFont, size: halfPoints(22) },
          paragraph: { spacing: { after: 140, line: 276 } }
        }
      },
      // Word's built-in heading styles default to Calibri Light and accent
      // colors; pin them to the body font, bold, dark, and matched sizes so
      // headings read like the editor's.
      paragraphStyles: [
        ...HEADING_SIZES_HALF_PT.map((size, index) => ({
          id: `Heading${index + 1}`,
          name: `Heading ${index + 1}`,
          basedOn: "Normal",
          next: "Normal",
          quickFormat: true,
          run: { font: bodyFont, size: halfPoints(size), bold: true, color: "1F2328" },
          paragraph: { spacing: { before: 280, after: 120 }, keepNext: true }
        })),
        {
          id: "CodeBlock",
          name: "Code Block",
          basedOn: "Normal",
          next: "Normal",
          quickFormat: false,
          run: { font: MONO_FONT, size: halfPoints(18) }
        }
      ]
    },
    numbering: {
      config: [
        {
          reference: ORDERED_LIST_REFERENCE,
          levels: Array.from({ length: 9 }, (_unused, level) => ({
            level,
            format: LevelFormat.DECIMAL,
            text: `%${level + 1}.`,
            style: {
              paragraph: { indent: { left: 720 * (level + 1), hanging: 360 } }
            }
          }))
        }
      ]
    },
    sections: [
      {
        // Set explicitly: the library's default is A4 with Word's margins,
        // whatever the user chose.
        properties: {
          page: {
            size: { width: ptToTwips(page.widthPt), height: ptToTwips(page.heightPt) },
            margin: {
              top: ptToTwips(page.margins.top),
              right: ptToTwips(page.margins.right),
              bottom: ptToTwips(page.margins.bottom),
              left: ptToTwips(page.margins.left)
            }
          }
        },
        children: blocksToDocxElements(blocks, images, null, false, layout)
      }
    ]
  });

  const blob = await Packer.toBlob(document);

  return new Uint8Array(await blob.arrayBuffer());
}
