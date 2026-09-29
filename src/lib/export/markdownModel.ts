import MarkdownIt from "markdown-it";
import type Token from "markdown-it/lib/token.mjs";
import insPlugin from "markdown-it-ins";
import markPlugin from "markdown-it-mark";

import { calloutMarkdownItPlugin } from "@/lib/editor/extensions/callout";
import { pageBreakMarkdownItPlugin } from "@/lib/editor/extensions/pageBreak";
import { tableLineBreakMarkdownItPlugin } from "@/lib/editor/extensions/table";

// Shared intermediate representation for the PDF/DOCX/ODT exporters: markdown
// is parsed exactly once into these blocks; each output format only has to
// translate the structure instead of re-interpreting markdown-it tokens.

export type InlineStyle = {
  bold: boolean;
  italic: boolean;
  underline: boolean;
  highlight: boolean;
  strike: boolean;
  code: boolean;
  link: string | null;
};

export type InlineRun =
  | ({ kind: "text"; text: string } & InlineStyle)
  | { kind: "image"; src: string; alt: string; width: number | null }
  | { kind: "break" };

export type TableCell = {
  runs: InlineRun[];
  align: "left" | "center" | "right";
  header: boolean;
};

export type ExportListItem = {
  // null = regular list item, true/false = task list checkbox state.
  checked: boolean | null;
  children: ExportBlock[];
  // The rest of an item cut across pages (pagePlan.ts): drawn without its
  // own bullet, number or checkbox. Only the PDF and the print see it.
  continued?: boolean;
};

// Markdown itself never produces an alignment — it stays undefined for every
// parsed document, so normal exports are unaffected. The manuscript compiler
// sets it to centre the title page.
export type BlockAlign = "left" | "center" | "right";

export type ExportBlock =
  | { kind: "heading"; level: number; runs: InlineRun[]; align?: BlockAlign }
  | { kind: "paragraph"; runs: InlineRun[]; align?: BlockAlign }
  // language is the fence's info word ("mermaid", "ts"), empty for an
  // indented block. Only diagrams read it (diagramAssets.ts).
  | { kind: "codeBlock"; text: string; language?: string }
  | { kind: "blockquote"; children: ExportBlock[] }
  | { kind: "list"; ordered: boolean; start: number; items: ExportListItem[] }
  | {
      kind: "table";
      rows: TableCell[][];
      // A part of a table split across pages (pagePlan.ts): the whole
      // table's rows, which the column widths are measured from, so every
      // part keeps the same columns.
      columnSource?: TableCell[][];
    }
  | { kind: "hr" }
  // A manual page break in the note (the editor's pageBreak node, see
  // extensions/pageBreak.ts), or one the manuscript compiler inserts between
  // chapters (manuscript.ts). Only ever at the top level. Each paged format
  // turns it into its own hard page break; HTML/EPUB only break when printed.
  | { kind: "pageBreak" };

// Same underline mapping as the editor (Editor.tsx): "++text++" is parsed by
// markdown-it-ins; the exporters treat <ins> as underline. Likewise "==text=="
// is the editor's highlight (markdown-it-mark, <mark>).
export function createExportMarkdownIt(): MarkdownIt {
  const markdownIt = new MarkdownIt({ html: false, linkify: false, breaks: false });
  markdownIt.use(insPlugin);
  markdownIt.use(markPlugin);
  // Strips the `[!VARIANT]` admonition marker so callouts export as clean
  // blockquotes instead of showing the raw marker text.
  markdownIt.use(calloutMarkdownItPlugin);
  // The editor writes line breaks inside a table cell as "<br>" (table.ts).
  markdownIt.use(tableLineBreakMarkdownItPlugin);
  // The manual page break line; without the rule it exports as visible text.
  markdownIt.use(pageBreakMarkdownItPlugin);
  return markdownIt;
}

// Editor markdown can contain escaped checkboxes ("\[ \]"); mirror the
// normalization the editor applies so exports render the same checkboxes.
export function normalizeTaskListMarkdown(markdown: string): string {
  return markdown.replace(
    /^(\s*(?:[-*+]|\d+[.)])\s+)\\\[([ xX]?)\\\]/gm,
    (_match, prefix: string, mark: string) => `${prefix}[${mark || " "}]`
  );
}

const TASK_PREFIX_PATTERN = /^\[( |x|X)\]\s+/;

function emptyStyle(): InlineStyle {
  return { bold: false, italic: false, underline: false, highlight: false, strike: false, code: false, link: null };
}

function parseInlineTokens(tokens: Token[]): InlineRun[] {
  const runs: InlineRun[] = [];
  const styleStack: InlineStyle[] = [emptyStyle()];

  const currentStyle = () => styleStack[styleStack.length - 1];

  for (const token of tokens) {
    switch (token.type) {
      case "text":
        if (token.content) {
          runs.push({ kind: "text", text: token.content, ...currentStyle() });
        }
        break;
      case "code_inline":
        runs.push({ kind: "text", text: token.content, ...currentStyle(), code: true });
        break;
      case "softbreak":
        runs.push({ kind: "text", text: " ", ...currentStyle() });
        break;
      case "hardbreak":
        runs.push({ kind: "break" });
        break;
      case "strong_open":
        styleStack.push({ ...currentStyle(), bold: true });
        break;
      case "em_open":
        styleStack.push({ ...currentStyle(), italic: true });
        break;
      case "s_open":
        styleStack.push({ ...currentStyle(), strike: true });
        break;
      case "ins_open":
        styleStack.push({ ...currentStyle(), underline: true });
        break;
      case "mark_open":
        styleStack.push({ ...currentStyle(), highlight: true });
        break;
      case "link_open":
        styleStack.push({ ...currentStyle(), link: token.attrGet("href") ?? null });
        break;
      case "strong_close":
      case "em_close":
      case "s_close":
      case "ins_close":
      case "mark_close":
      case "link_close":
        if (styleStack.length > 1) {
          styleStack.pop();
        }
        break;
      case "image": {
        // The editor stores a drag-resized display width in the image title
        // (`![alt](src "width=300")`, see Editor.tsx) — CommonMark has no
        // native image-width syntax.
        const widthMatch = /^width=(\d+)$/.exec(token.attrGet("title") ?? "");

        runs.push({
          kind: "image",
          src: token.attrGet("src") ?? "",
          alt: token.content ?? "",
          width: widthMatch ? Number(widthMatch[1]) : null
        });
        break;
      }
      default:
        // html_inline etc. — render raw content as plain text if present.
        if (token.content) {
          runs.push({ kind: "text", text: token.content, ...currentStyle() });
        }
        break;
    }
  }

  return runs;
}

// Detects a leading "[ ] " / "[x] " in the first text run of a list item and
// strips it, returning the checkbox state (the editor's task list syntax).
function extractTaskState(children: ExportBlock[]): boolean | null {
  const firstBlock = children[0];

  if (!firstBlock || firstBlock.kind !== "paragraph") {
    return null;
  }

  const firstRun = firstBlock.runs[0];

  if (!firstRun || firstRun.kind !== "text" || firstRun.code) {
    return null;
  }

  const match = TASK_PREFIX_PATTERN.exec(firstRun.text);

  if (!match) {
    return null;
  }

  const remainder = firstRun.text.slice(match[0].length);

  if (remainder) {
    firstBlock.runs[0] = { ...firstRun, text: remainder };
  } else {
    firstBlock.runs.shift();
  }

  return match[1].toLowerCase() === "x";
}

type ParserState = {
  tokens: Token[];
  index: number;
};

function parseBlocks(state: ParserState, closeTokenType: string | null): ExportBlock[] {
  const blocks: ExportBlock[] = [];

  while (state.index < state.tokens.length) {
    const token = state.tokens[state.index];

    if (closeTokenType && token.type === closeTokenType) {
      state.index += 1;
      return blocks;
    }

    state.index += 1;

    switch (token.type) {
      case "heading_open": {
        const inline = state.tokens[state.index];
        state.index += 2; // skip inline + heading_close
        blocks.push({
          kind: "heading",
          level: Number(token.tag.slice(1)) || 1,
          runs: inline?.type === "inline" ? parseInlineTokens(inline.children ?? []) : []
        });
        break;
      }
      case "paragraph_open": {
        const inline = state.tokens[state.index];
        state.index += 2; // skip inline + paragraph_close
        blocks.push({
          kind: "paragraph",
          runs: inline?.type === "inline" ? parseInlineTokens(inline.children ?? []) : []
        });
        break;
      }
      case "fence":
      case "code_block": {
        const language = token.info.trim().split(/\s+/)[0] ?? "";
        blocks.push({
          kind: "codeBlock",
          text: token.content.replace(/\n$/, ""),
          ...(language ? { language } : {})
        });
        break;
      }
      case "blockquote_open":
        blocks.push({ kind: "blockquote", children: parseBlocks(state, "blockquote_close") });
        break;
      case "bullet_list_open":
      case "ordered_list_open": {
        const ordered = token.type === "ordered_list_open";
        const closeType = ordered ? "ordered_list_close" : "bullet_list_close";
        const start = ordered ? Number(token.attrGet("start") ?? "1") || 1 : 1;
        const items: ExportListItem[] = [];

        while (state.index < state.tokens.length && state.tokens[state.index].type !== closeType) {
          if (state.tokens[state.index].type === "list_item_open") {
            state.index += 1;
            const children = parseBlocks(state, "list_item_close");
            items.push({ checked: extractTaskState(children), children });
          } else {
            state.index += 1;
          }
        }

        state.index += 1; // skip list close token
        blocks.push({ kind: "list", ordered, start, items });
        break;
      }
      case "table_open": {
        const rows: TableCell[][] = [];
        let currentRow: TableCell[] | null = null;
        let inHeader = false;

        while (state.index < state.tokens.length && state.tokens[state.index].type !== "table_close") {
          const tableToken = state.tokens[state.index];
          state.index += 1;

          if (tableToken.type === "thead_open") {
            inHeader = true;
          } else if (tableToken.type === "thead_close") {
            inHeader = false;
          } else if (tableToken.type === "tr_open") {
            currentRow = [];
          } else if (tableToken.type === "tr_close") {
            if (currentRow) {
              rows.push(currentRow);
            }
            currentRow = null;
          } else if (tableToken.type === "th_open" || tableToken.type === "td_open") {
            const style = tableToken.attrGet("style") ?? "";
            const align = style.includes("center") ? "center" : style.includes("right") ? "right" : "left";
            const inline = state.tokens[state.index];
            state.index += 2; // skip inline + cell close
            currentRow?.push({
              runs: inline?.type === "inline" ? parseInlineTokens(inline.children ?? []) : [],
              align,
              header: inHeader || tableToken.type === "th_open"
            });
          }
        }

        state.index += 1; // skip table_close
        blocks.push({ kind: "table", rows });
        break;
      }
      case "hr":
        blocks.push({ kind: "hr" });
        break;
      case "page_break":
        blocks.push({ kind: "pageBreak" });
        break;
      default:
        break;
    }
  }

  return blocks;
}

export function parseMarkdownToBlocks(markdown: string): ExportBlock[] {
  return parseMarkdownToBlocksWithLines(markdown).blocks;
}

// The tokens that open a top-level block in parseBlocks, one block each.
const BLOCK_START_TOKENS = new Set([
  "heading_open",
  "paragraph_open",
  "fence",
  "code_block",
  "blockquote_open",
  "bullet_list_open",
  "ordered_list_open",
  "table_open",
  "hr",
  "page_break"
]);

/**
 * The blocks plus the line of the markdown each top-level block starts on
 * (0-based), which is how the editor's page lines find the node a block came
 * from.
 */
export function parseMarkdownToBlocksWithLines(markdown: string): { blocks: ExportBlock[]; lines: number[] } {
  const markdownIt = createExportMarkdownIt();
  const tokens = markdownIt.parse(normalizeTaskListMarkdown(markdown), {});
  const lines = tokens
    .filter((token) => token.level === 0 && BLOCK_START_TOKENS.has(token.type))
    .map((token) => token.map?.[0] ?? -1);

  return { blocks: parseBlocks({ tokens, index: 0 }, null), lines };
}

/**
 * Drops the page breaks that would only produce an empty page: at the start
 * and end of the document, and every one directly after another. Applied to
 * the final block list rather than per note: a manuscript chapter that opens
 * with a manual break and the chapter break in front of it collapse into one,
 * and with chapter breaks switched off, that chapter still starts a new page.
 */
export function normalizePageBreaks(blocks: ExportBlock[]): ExportBlock[] {
  const keep = pageBreakKeepMask(blocks);

  return blocks.filter((_, index) => keep[index]);
}

/** Which blocks normalizePageBreaks keeps, by index. */
export function pageBreakKeepMask(blocks: ExportBlock[]): boolean[] {
  const keep = blocks.map(() => true);
  let previousKept: ExportBlock | null = null;

  blocks.forEach((block, index) => {
    if (block.kind === "pageBreak" && (previousKept === null || previousKept.kind === "pageBreak")) {
      keep[index] = false;
    } else {
      previousKept = block;
    }
  });

  for (let index = blocks.length - 1; index >= 0; index--) {
    if (!keep[index]) {
      continue;
    }

    if (blocks[index].kind !== "pageBreak") {
      break;
    }

    keep[index] = false;
  }

  return keep;
}
