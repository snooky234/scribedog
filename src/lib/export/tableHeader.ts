import type { ExportBlock } from "./markdownModel";

/**
 * The blocks with the header flag taken off every table cell, for the setting
 * that shows the first row like any other (useEditorSettingsStore
 * .plainTableHeader). Done on the block list rather than in each format: a
 * row that is no longer a header loses its bold and fill everywhere at once,
 * and the formats also stop treating it as a header that repeats on every
 * page, which a table the user wants to look plain should not do either.
 * The Markdown file is not touched, only what is rendered from it. Runs
 * before the page plan, so no block carries a `columnSource` yet.
 */
export function plainTableHeaders(blocks: ExportBlock[], plain: boolean | undefined): ExportBlock[] {
  return plain ? blocks.map(stripHeader) : blocks;
}

function stripHeader(block: ExportBlock): ExportBlock {
  switch (block.kind) {
    case "table":
      return block.rows.some((row) => row.some((cell) => cell.header))
        ? { ...block, rows: block.rows.map((row) => row.map((cell) => ({ ...cell, header: false }))) }
        : block;
    case "blockquote":
      return { ...block, children: block.children.map(stripHeader) };
    case "list":
      return {
        ...block,
        items: block.items.map((item) => ({ ...item, children: item.children.map(stripHeader) }))
      };
    default:
      return block;
  }
}
