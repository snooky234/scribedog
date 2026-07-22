import {
  AlignmentType,
  BorderStyle,
  Document,
  ExternalHyperlink,
  HeadingLevel,
  ImageRun,
  LevelFormat,
  Packer,
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

import type { ExportBlock, InlineRun, TableCell as ModelTableCell } from "./markdownModel";
import { computeExportImageSize, type ExportImageMap } from "./imageAssets";

const ORDERED_LIST_REFERENCE = "scribedog-ordered";
// Match the sans-serif look of the editor / HTML export. Arial is the safest
// sans-serif present on Windows, macOS and most Linux setups; Word/LibreOffice
// would otherwise fall back to their serif or Calibri-Light defaults.
const BODY_FONT = "Arial";
const MONO_FONT = "Consolas";
const CODE_FILL = "F4F4F4";
const BORDER_COLOR = "C8C8C8";
const MUTED_COLOR = "666666";

// Heading sizes in half-points (docx unit), roughly matching the HTML export.
const HEADING_SIZES_HALF_PT = [40, 34, 28, 24, 22, 21];

// Word page content width in px at 96dpi (A4 minus 1" margins) — images are
// scaled down to fit.
const MAX_IMAGE_WIDTH_PX = 600;

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
        const size = computeExportImageSize(asset, run.width, MAX_IMAGE_WIDTH_PX);
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

type ListContext = {
  ordered: boolean;
  level: number;
};

function blocksToDocxElements(
  blocks: ExportBlock[],
  images: ExportImageMap,
  listContext: ListContext | null = null,
  inQuote = false
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
            children: runsToDocxChildren(block.runs, images)
          })
        );
        break;
      }
      case "paragraph":
        elements.push(
          new Paragraph({
            ...quoteOptions(),
            ...listParagraphOptions(),
            children: runsToDocxChildren(block.runs, images)
          })
        );
        break;
      case "codeBlock": {
        const lines = block.text.split("\n");
        elements.push(
          ...lines.map(
            (line, index) =>
              new Paragraph({
                children: [new TextRun({ text: line, font: MONO_FONT, size: 18 })],
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
        elements.push(...blocksToDocxElements(block.children, images, listContext, true));
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
                  ...runsToDocxChildren(firstRuns, images)
                ]
              })
            );

            const restBlocks = first?.kind === "paragraph" ? rest : item.children;
            elements.push(
              ...blocksToDocxElements(restBlocks, images, {
                ordered: false,
                level: Math.min((listContext?.level ?? -1) + 1, 8)
              })
            );
            continue;
          }

          const level = Math.min((listContext?.level ?? -1) + 1, 8);
          const [first, ...rest] = item.children;

          if (first?.kind === "paragraph") {
            elements.push(
              ...blocksToDocxElements([first], images, { ordered: block.ordered, level })
            );
            elements.push(...blocksToDocxElements(rest, images, { ordered: block.ordered, level }));
          } else {
            elements.push(
              ...blocksToDocxElements(item.children, images, { ordered: block.ordered, level })
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
            width: { size: 100, type: WidthType.PERCENTAGE },
            rows: block.rows.map(
              (row) =>
                new TableRow({
                  children: row.map((cell) => modelCellToDocxCell(cell, images))
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
    }
  }

  return elements;
}

function modelCellToDocxCell(cell: ModelTableCell, images: ExportImageMap): TableCell {
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
        children: runsToDocxChildren(cell.runs, images, cell.header)
      })
    ]
  });
}

export async function renderDocxDocument(
  title: string,
  blocks: ExportBlock[],
  images: ExportImageMap
): Promise<Uint8Array> {
  const document = new Document({
    title,
    styles: {
      // Body default: sans-serif everywhere unless a run overrides the font
      // (code runs / mono still opt into Consolas explicitly).
      default: {
        document: {
          run: { font: BODY_FONT, size: 22 },
          paragraph: { spacing: { after: 140, line: 276 } }
        }
      },
      // Word's built-in heading styles default to Calibri Light and accent
      // colors; pin them to the body font, bold, dark, and matched sizes so
      // headings read like the editor's.
      paragraphStyles: HEADING_SIZES_HALF_PT.map((size, index) => ({
        id: `Heading${index + 1}`,
        name: `Heading ${index + 1}`,
        basedOn: "Normal",
        next: "Normal",
        quickFormat: true,
        run: { font: BODY_FONT, size, bold: true, color: "1F2328" },
        paragraph: { spacing: { before: 280, after: 120 }, keepNext: true }
      }))
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
        children: blocksToDocxElements(blocks, images)
      }
    ]
  });

  const blob = await Packer.toBlob(document);

  return new Uint8Array(await blob.arrayBuffer());
}
