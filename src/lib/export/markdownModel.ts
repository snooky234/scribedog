import MarkdownIt from "markdown-it";
import type Token from "markdown-it/lib/token.mjs";
import insPlugin from "markdown-it-ins";

import { calloutMarkdownItPlugin } from "@/lib/editor/extensions/callout";

// Shared intermediate representation for the PDF/DOCX/ODT exporters: markdown
// is parsed exactly once into these blocks; each output format only has to
// translate the structure instead of re-interpreting markdown-it tokens.

export type InlineStyle = {
  bold: boolean;
  italic: boolean;
  underline: boolean;
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
};

export type ExportBlock =
  | { kind: "heading"; level: number; runs: InlineRun[] }
  | { kind: "paragraph"; runs: InlineRun[] }
  | { kind: "codeBlock"; text: string }
  | { kind: "blockquote"; children: ExportBlock[] }
  | { kind: "list"; ordered: boolean; start: number; items: ExportListItem[] }
  | { kind: "table"; rows: TableCell[][] }
  | { kind: "hr" };

// Same underline mapping as the editor (Editor.tsx): "++text++" is parsed by
// markdown-it-ins; the exporters treat <ins> as underline.
export function createExportMarkdownIt(): MarkdownIt {
  const markdownIt = new MarkdownIt({ html: false, linkify: false, breaks: false });
  markdownIt.use(insPlugin);
  // Strips the `[!VARIANT]` admonition marker so callouts export as clean
  // blockquotes instead of showing the raw marker text.
  markdownIt.use(calloutMarkdownItPlugin);
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
  return { bold: false, italic: false, underline: false, strike: false, code: false, link: null };
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
      case "link_open":
        styleStack.push({ ...currentStyle(), link: token.attrGet("href") ?? null });
        break;
      case "strong_close":
      case "em_close":
      case "s_close":
      case "ins_close":
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
      case "code_block":
        blocks.push({ kind: "codeBlock", text: token.content.replace(/\n$/, "") });
        break;
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
      default:
        break;
    }
  }

  return blocks;
}

export function parseMarkdownToBlocks(markdown: string): ExportBlock[] {
  const markdownIt = createExportMarkdownIt();
  const tokens = markdownIt.parse(normalizeTaskListMarkdown(markdown), {});

  return parseBlocks({ tokens, index: 0 }, null);
}
