import BaseHardBreak from "@tiptap/extension-hard-break";
import { Table as BaseTable, TableCell, TableHeader, TableRow } from "@tiptap/extension-table";
import type { Node as ProseMirrorNode } from "@tiptap/pm/model";
import type { EditorState } from "@tiptap/pm/state";
import type MarkdownIt from "markdown-it";

export { TableCell, TableHeader, TableRow };

// tiptap-markdown's own table serializer only handles the subset GFM can
// express: one header row, no spans, exactly one paragraph per cell. For
// anything else it falls back to the HTML node, and with `html: false` (which
// this editor needs — see extensions/index.ts) that fallback writes the
// literal placeholder "[table]" into the file. The editor kept showing the
// table, so the loss only surfaced after the file was reopened: a whole
// table of notes gone because one cell held a list (issue #56). The same
// fallback wrote "[hardBreak]" for Shift+Enter inside a cell.
//
// This serializer never falls back. Every cell is flattened into one GFM
// cell: blocks and hard breaks become "<br>", list items get a glyph ("•",
// "1)", "☐"/"☑") and their nesting an indent, spans are padded out, a
// missing header row is promoted. The file stays a table every Markdown tool
// can render, with the lists readable as text. The parse side turns "<br>"
// inside a cell back into a hard break (tableLineBreakMarkdownItPlugin) and
// the glyph lines back into lists (restoreCellLists), so bullet, numbered and
// checklists inside a cell survive the round trip. Other block structure
// (a second paragraph, a code block) comes back as lines of one paragraph.

type MarkdownSerializerState = {
  out: string;
  closed: ProseMirrorNode | null;
  inTable: boolean;
  write: (content?: string) => void;
  text: (text: string, escape?: boolean) => void;
  ensureNewLine: () => void;
  closeBlock: (node: ProseMirrorNode) => void;
  renderInline: (parent: ProseMirrorNode) => void;
  render: (node: ProseMirrorNode, parent: ProseMirrorNode, index: number) => void;
};

const CELL_LINE_BREAK = "<br>";
// Non-breaking spaces: ordinary ones would be collapsed when the cell text
// is parsed back into the editor.
const NESTING_INDENT = String.fromCharCode(0xa0).repeat(2);

/** True when the selection's head sits inside a table cell. */
export function isInTableCell(state: EditorState): boolean {
  const { $from } = state.selection;

  for (let depth = $from.depth; depth > 0; depth--) {
    const name = $from.node(depth).type.name;

    if (name === TableCell.name || name === TableHeader.name) {
      return true;
    }
  }

  return false;
}

const LIST_ITEM_TYPES = new Set(["listItem", "taskItem"]);

// The list items between the selection and its table cell, innermost first.
// Empty outside a cell and for a caret in a cell's plain paragraph.
function cellListItems(state: EditorState): ProseMirrorNode[] {
  const { $from } = state.selection;
  const items: ProseMirrorNode[] = [];

  for (let depth = $from.depth; depth > 0; depth--) {
    const node = $from.node(depth);
    const { name } = node.type;

    if (name === TableCell.name || name === TableHeader.name) {
      return items;
    }

    if (LIST_ITEM_TYPES.has(name)) {
      items.push(node);
    }
  }

  return [];
}

// Serializes `render()`'s output into a string instead of the document, so a
// cell's lines can be joined before they are written. Only used while the
// output does not end in a newline, otherwise `write()` would put the block
// delimiter (a blockquote's "> ") into the captured text.
function capture(state: MarkdownSerializerState, render: () => void): string {
  const start = state.out.length;
  const closed = state.closed;

  render();

  const captured = state.out.slice(start);
  state.out = state.out.slice(0, start);
  // A block serializer closes its block; flushed later, that would end the
  // row with a blank line.
  state.closed = closed;

  return captured;
}

function listMarker(list: ProseMirrorNode, index: number): string {
  if (list.type.name === "orderedList") {
    // "1)" rather than "1.": the latter would be escaped as "1\." once the
    // reopened cell text is saved again.
    return `${(list.attrs.start ?? 1) + index}) `;
  }

  return "• ";
}

function taskMarker(item: ProseMirrorNode): string {
  return item.attrs.checked ? "☑ " : "☐ ";
}

// A hard break inside a list item's text would put its second line at the
// indent of the list itself, and reading the file back would move that line
// out of the item. Every line after the first gets the item's indent.
function pushInline(lines: string[], firstPrefix: string, restPrefix: string, inline: string): void {
  inline.split(CELL_LINE_BREAK).forEach((part, index) => lines.push((index ? restPrefix : firstPrefix) + part));
}

// Flattens one block of a cell into lines of inline markdown. Lists keep
// their nesting as indentation; everything else contributes its text.
function flattenBlock(
  state: MarkdownSerializerState,
  node: ProseMirrorNode,
  parent: ProseMirrorNode,
  index: number,
  indent: string,
  lines: string[]
): void {
  const { name } = node.type;

  if (node.isTextblock) {
    if (name === "codeBlock") {
      for (const line of node.textContent.split("\n")) {
        lines.push(indent + capture(state, () => state.text(line)));
      }

      return;
    }

    pushInline(lines, indent, indent, capture(state, () => state.renderInline(node)));
    return;
  }

  if (name === "bulletList" || name === "orderedList" || name === "taskList") {
    node.forEach((item, _offset, index) => {
      const marker = name === "taskList" ? taskMarker(item) : listMarker(node, index);
      flattenListItem(state, item, indent + marker, indent + NESTING_INDENT, lines);
    });

    return;
  }

  if (node.isLeaf) {
    lines.push(indent + capture(state, () => state.render(node, parent, index)).trim());
    return;
  }

  node.forEach((child, _offset, childIndex) => flattenBlock(state, child, node, childIndex, indent, lines));
}

function flattenListItem(
  state: MarkdownSerializerState,
  item: ProseMirrorNode,
  firstLinePrefix: string,
  nestedIndent: string,
  lines: string[]
): void {
  const first = item.firstChild;

  if (!first) {
    lines.push(firstLinePrefix.trimEnd());
    return;
  }

  if (first.isTextblock) {
    pushInline(lines, firstLinePrefix, nestedIndent, capture(state, () => state.renderInline(first)));
  } else {
    lines.push(firstLinePrefix.trimEnd());
    flattenBlock(state, first, item, 0, nestedIndent, lines);
  }

  item.forEach((child, _offset, index) => {
    if (index > 0) {
      flattenBlock(state, child, item, index, nestedIndent, lines);
    }
  });
}

// One GFM cell: lines joined with "<br>", pipes escaped so they can't end
// the cell, and no stray newline (a serializer of a nested node may add
// one) since a newline ends the row.
function serializeCell(state: MarkdownSerializerState, cell: ProseMirrorNode): string {
  const lines: string[] = [];

  cell.forEach((block, _offset, index) => flattenBlock(state, block, cell, index, "", lines));

  return lines
    .join(CELL_LINE_BREAK)
    .replace(/\n/g, CELL_LINE_BREAK)
    .replace(/\|/g, "\\|")
    .trim();
}

function serializeTable(state: MarkdownSerializerState, table: ProseMirrorNode): void {
  state.inTable = true;

  table.forEach((row, _offset, rowIndex) => {
    let columns = 0;

    state.write("| ");

    row.forEach((cell, _cellOffset, cellIndex) => {
      if (cellIndex) {
        state.write(" | ");
      }

      state.write(serializeCell(state, cell));

      // A merged cell still occupies its columns: padding them keeps every
      // row the same width, which is what a Markdown table needs.
      const colspan = Math.max(1, Number(cell.attrs.colspan) || 1);

      for (let span = 1; span < colspan; span++) {
        state.write(" | ");
      }

      columns += colspan;
    });

    state.write(" |");
    state.ensureNewLine();

    // GFM requires a header row; the first row becomes it whatever its
    // cells were.
    if (rowIndex === 0) {
      const delimiterRow = Array.from({ length: Math.max(1, columns) }, () => "---").join(" | ");
      state.write(`| ${delimiterRow} |`);
      state.ensureNewLine();
    }
  });

  state.closeBlock(table);
  state.inTable = false;
}

// markdown-it/@types/markdown-it don't export the Token type from the package
// root, so it's derived from a signature that uses it.
type MarkdownItToken = Parameters<MarkdownIt["renderer"]["renderToken"]>[0][number];
type TokenConstructor = new (type: string, tag: string, nesting: 0 | 1 | -1) => MarkdownItToken;

const LINE_BREAK_PATTERN = /<br\s*\/?>/i;
const LINE_BREAK_SPLIT_PATTERN = /(<br\s*\/?>)/i;

// Turns a literal "<br>" inside a table cell into a hard break. With
// `html: false` markdown-it keeps the tag as text, so the line breaks the
// serializer writes would come back as "<br>" on screen. A "<br>" the user
// typed into a cell is written as "&lt;br&gt;" by the text serializer and
// stays text, so the two can't be confused. Exported for the export
// pipeline, which parses the same files with its own markdown-it.
export function tableLineBreakMarkdownItPlugin(md: MarkdownIt): void {
  md.core.ruler.after("inline", "scribedog_table_line_break", (state) => {
    let tableDepth = 0;

    for (const token of state.tokens) {
      if (token.type === "table_open") {
        tableDepth += 1;
      } else if (token.type === "table_close") {
        tableDepth -= 1;
      }

      if (tableDepth === 0 || token.type !== "inline" || !token.children) {
        continue;
      }

      if (!token.children.some((child) => child.type === "text" && LINE_BREAK_PATTERN.test(child.content))) {
        continue;
      }

      token.children = token.children.flatMap((child) =>
        child.type === "text" ? splitLineBreaks(child, state.Token as TokenConstructor) : [child]
      );
    }
  });
}

function splitLineBreaks(text: MarkdownItToken, Token: TokenConstructor): MarkdownItToken[] {
  const parts = text.content.split(LINE_BREAK_SPLIT_PATTERN);

  return parts.flatMap((part, index) => {
    if (index % 2 === 1) {
      return [new Token("hardbreak", "br", 0)];
    }

    if (!part) {
      return [];
    }

    const token = new Token("text", "", 0);
    token.content = part;
    token.level = text.level;

    return [token];
  });
}

// The parse half of the list round trip. markdown-it renders a cell as inline
// HTML, one line per "<br>"; this rebuilds the lists the serializer flattened
// from the glyph at the start of each line and the indent in front of it. It
// runs on the DOM tiptap-markdown hands to ProseMirror, so the lists arrive
// as ordinary <ul>/<ol>/taskList markup. A cell without a glyph line is left
// exactly as markdown-it rendered it.

type CellListKind = "bullet" | "ordered" | "task";

type CellLine = {
  nodes: Node[];
  indent: number;
  // Characters to drop from the first text node: the newline the renderer puts
  // after a "<br>", and the glyph of a list line.
  prefix: number;
  marker: { kind: CellListKind; start: number; checked: boolean } | null;
};

const LINE_MARKER_PATTERN = new RegExp(`^((?:${NESTING_INDENT})*)(?:(•)|(☐)|(☑)|(\\d+)\\))(?: |$)`);
const LINE_INDENT_PATTERN = new RegExp(`^(?:${NESTING_INDENT})*`);

function splitCellLines(cell: Element): CellLine[] {
  const lines: CellLine[] = [];
  let nodes: Node[] = [];

  for (const child of Array.from(cell.childNodes)) {
    if (child.nodeName === "BR") {
      lines.push(readLine(nodes));
      nodes = [];
    } else {
      nodes.push(child);
    }
  }

  lines.push(readLine(nodes));

  return lines;
}

function readLine(nodes: Node[]): CellLine {
  const first = nodes[0];

  if (!first || first.nodeType !== first.TEXT_NODE) {
    return { nodes, indent: 0, prefix: 0, marker: null };
  }

  // Ordinary whitespace only: the indent is made of non-breaking spaces.
  const content = first.textContent ?? "";
  const whitespace = /^[ \t\r\n]*/.exec(content)![0].length;
  const text = content.slice(whitespace);
  const match = LINE_MARKER_PATTERN.exec(text);

  if (!match) {
    const indent = LINE_INDENT_PATTERN.exec(text)![0].length / NESTING_INDENT.length;

    return { nodes, indent, prefix: whitespace, marker: null };
  }

  const [, indent, , unchecked, checked, number] = match;
  const kind: CellListKind = number ? "ordered" : unchecked || checked ? "task" : "bullet";

  return {
    nodes,
    indent: indent.length / NESTING_INDENT.length,
    prefix: whitespace + match[0].length,
    marker: { kind, start: number ? Number(number) : 1, checked: Boolean(checked) }
  };
}

function dropPrefix(line: CellLine, length: number): void {
  const first = line.nodes[0];

  if (first && length > 0) {
    first.textContent = (first.textContent ?? "").slice(length);
  }
}

function createList(document: Document, kind: CellListKind, start: number): HTMLElement {
  if (kind === "ordered") {
    const list = document.createElement("ol");

    if (start !== 1) {
      list.setAttribute("start", String(start));
    }

    return list;
  }

  const list = document.createElement("ul");

  if (kind === "task") {
    list.setAttribute("data-type", "taskList");
  }

  return list;
}

function restoreCellLists(cell: Element): void {
  const lines = splitCellLines(cell);

  if (!lines.some((line) => line.marker)) {
    return;
  }

  const document = cell.ownerDocument;
  const blocks = document.createDocumentFragment();
  const open: { kind: CellListKind; indent: number; list: HTMLElement; item: HTMLElement | null }[] = [];
  // Consecutive lines that land in the same place are one paragraph with
  // hard breaks, which is what the editor makes of Enter in a cell.
  let paragraph: { target: Node; element: HTMLElement } | null = null;

  for (const line of lines) {
    const { marker, indent } = line;

    if (marker) {
      while (open.length) {
        const top = open[open.length - 1];

        if (top.indent > indent || (top.indent === indent && top.kind !== marker.kind)) {
          open.pop();
        } else {
          break;
        }
      }

      let top = open[open.length - 1];

      if (!top || top.indent < indent) {
        const list = createList(document, marker.kind, marker.start);
        (top?.item ?? blocks).appendChild(list);
        top = { kind: marker.kind, indent, list, item: null };
        open.push(top);
      }

      const item = document.createElement("li");

      if (marker.kind === "task") {
        item.setAttribute("data-type", "taskItem");
        item.setAttribute("data-checked", String(marker.checked));
      }

      dropPrefix(line, line.prefix);

      const element = document.createElement("p");
      element.append(...line.nodes);
      item.appendChild(element);
      top.list.appendChild(item);
      top.item = item;
      paragraph = { target: item, element };

      continue;
    }

    // A line without a glyph continues the item one level above its indent,
    // or is a paragraph of the cell itself.
    while (open.length && open[open.length - 1].indent >= indent) {
      open.pop();
    }

    const target = open[open.length - 1]?.item ?? blocks;

    // The indent belongs to the list; a cell paragraph keeps its text.
    dropPrefix(line, line.prefix + (target === blocks ? 0 : indent * NESTING_INDENT.length));

    if (paragraph?.target === target) {
      paragraph.element.append(document.createElement("br"), ...line.nodes);
    } else {
      const element = document.createElement("p");
      element.append(...line.nodes);
      target.appendChild(element);
      paragraph = { target, element };
    }
  }

  cell.replaceChildren(blocks);
}

export const Table = BaseTable.extend({
  // Enter inside a cell inserts a line break instead of a second
  // paragraph: that is what the file can hold, and what the user gets back
  // after reopening the note. Inside a list in a cell Enter starts the next
  // item and Tab indents it, as everywhere else; Tab on an item that can't
  // be indented, and Shift+Tab on a top-level item, still move between
  // cells. The other stock table shortcuts stay.
  addKeyboardShortcuts() {
    const parent = this.parent?.() ?? {};

    return {
      ...parent,
      Enter: () => {
        const { state } = this.editor;

        return isInTableCell(state) && cellListItems(state).length === 0 && this.editor.commands.setHardBreak();
      },
      Tab: (props) => {
        const [item] = cellListItems(this.editor.state);

        if (item && this.editor.commands.sinkListItem(item.type.name)) {
          return true;
        }

        return parent.Tab?.(props) ?? false;
      },
      "Shift-Tab": (props) => {
        const items = cellListItems(this.editor.state);

        if (items.length > 1 && this.editor.commands.liftListItem(items[0].type.name)) {
          return true;
        }

        return parent["Shift-Tab"]?.(props) ?? false;
      }
    };
  },

  addStorage() {
    return {
      markdown: {
        serialize: serializeTable,
        parse: {
          setup(markdownit: MarkdownIt) {
            markdownit.use(tableLineBreakMarkdownItPlugin);
          },
          updateDOM(element: HTMLElement) {
            element.querySelectorAll("td, th").forEach(restoreCellLists);
          }
        }
      }
    };
  }
});

// tiptap-markdown's hard break serializer takes the same HTML fallback inside
// a table, writing "[hardBreak]" into the cell; here it becomes the "<br>"
// the table serializer joins lines with. Outside a table it is the usual
// backslash line break. Trailing hard breaks are dropped like the stock
// serializer does, since they have no visible effect.
export const HardBreak = BaseHardBreak.extend({
  addStorage() {
    return {
      markdown: {
        serialize(state: MarkdownSerializerState, node: ProseMirrorNode, parent: ProseMirrorNode, index: number) {
          for (let i = index + 1; i < parent.childCount; i++) {
            if (parent.child(i).type !== node.type) {
              state.write(state.inTable ? CELL_LINE_BREAK : "\\\n");
              return;
            }
          }
        },
        parse: {
          // handled by markdown-it
        }
      }
    };
  }
});
