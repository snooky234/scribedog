import { Node } from "@tiptap/core";
import type { Node as ProseMirrorNode } from "@tiptap/pm/model";
import { TextSelection, type EditorState, type Transaction } from "@tiptap/pm/state";
import type MarkdownIt from "markdown-it";
import type StateBlock from "markdown-it/lib/rules_block/state_block.mjs";

import i18n from "@/i18n";

// A manual page break. On disk it is the line Typora and the browser print
// already agree on, so other tools show an empty line instead of foreign
// syntax (no "{.newpage}" attribute of our own, see GitHub #46):
//
//   <div style="page-break-after: always;"></div>
//
// The editor and the export parser both run with `html: false`, so raw HTML
// is text there. The line is recognized by a block rule of its own instead,
// only at the top level of the document: a page cannot break inside a list
// item or a quote in any of the paged formats, and a break there would be a
// promise the export cannot keep.

export const PAGE_BREAK_MARKDOWN = '<div style="page-break-after: always;"></div>';

// Anything that says "new page" in CSS: the old page-break-* properties and
// their break-* successors, before or after.
const PAGE_BREAK_STYLE_PATTERN =
  /(?:^|;)\s*(?:page-break-(?:after|before)\s*:\s*always|break-(?:after|before)\s*:\s*page)\s*(?=;|$)/i;

// The whole line, and nothing but an empty div on it: extra text before or
// after would be lost if it were read as a break.
const PAGE_BREAK_LINE_PATTERN = /^ {0,3}<div\s+style\s*=\s*(?:"([^"]*)"|'([^']*)')\s*>\s*<\/div>\s*$/i;

export function isPageBreakStyle(style: string): boolean {
  return PAGE_BREAK_STYLE_PATTERN.test(style.trim());
}

/** True for a Markdown line that is a page break in any of the accepted spellings. */
export function isPageBreakLine(line: string): boolean {
  const match = PAGE_BREAK_LINE_PATTERN.exec(line);

  return match !== null && isPageBreakStyle(match[1] ?? match[2] ?? "");
}

function pageBreakRule(state: StateBlock, startLine: number, _endLine: number, silent: boolean): boolean {
  // Lists and quotes parse their content with a parentType of their own.
  if (state.parentType !== "root") {
    return false;
  }

  // Indented four or more, the line is a code block.
  if (state.sCount[startLine] - state.blkIndent >= 4) {
    return false;
  }

  const line = state.src.slice(state.bMarks[startLine], state.eMarks[startLine]);

  if (!isPageBreakLine(line)) {
    return false;
  }

  if (silent) {
    return true;
  }

  state.line = startLine + 1;

  const token = state.push("page_break", "div", 0);
  token.block = true;
  token.map = [startLine, state.line];

  return true;
}

// Registered in the editor (through the node's parse setup) and in the export
// parser (createExportMarkdownIt), like the callout plugin. The rule emits a
// "page_break" token; the editor's HTML step turns it into the element the
// node's parseHTML picks up, the export model into a pageBreak block.
export function pageBreakMarkdownItPlugin(md: MarkdownIt): void {
  md.block.ruler.before("html_block", "page_break", pageBreakRule);
  md.renderer.rules.page_break = () => '<div data-page-break="true"></div>\n';
}

/**
 * Where a page break goes for the current selection, and whether the
 * paragraph under the cursor has to be split for it. Inside a list, a quote,
 * a callout, a table or a code block the break goes behind the whole
 * top-level block, since the paged formats cannot break inside them.
 */
function insertPageBreakTransaction(state: EditorState, tr: Transaction): Transaction | null {
  const type = state.schema.nodes.pageBreak;

  if (!type) {
    return null;
  }

  const { selection } = state;
  const { $from } = selection;

  // A top-level node selection (an image, a table, another page break).
  if ($from.depth === 0) {
    return placeAfter(tr.insert(selection.to, type.create()), selection.to);
  }

  const topLevel = $from.node(1);
  const inTopLevelTextblock = $from.depth === 1 && topLevel.isTextblock;

  if (inTopLevelTextblock && topLevel.type.name === "paragraph") {
    tr.deleteSelection();

    const $cursor = tr.doc.resolve(tr.mapping.map(selection.from));
    const paragraph = $cursor.parent;

    // An empty paragraph turns into the break.
    if (paragraph.content.size === 0) {
      const start = $cursor.before(1);
      tr.replaceWith(start, $cursor.after(1), type.create());
      return placeAfter(tr, start);
    }

    if ($cursor.parentOffset === 0) {
      const start = $cursor.before(1);
      tr.insert(start, type.create());
      return placeAfter(tr, start);
    }

    if ($cursor.parentOffset === paragraph.content.size) {
      const end = $cursor.after(1);
      tr.insert(end, type.create());
      return placeAfter(tr, end);
    }

    // Mid-paragraph: split it and put the break between the halves.
    tr.split($cursor.pos);
    const between = tr.mapping.map($cursor.pos) - 1;
    tr.insert(between, type.create());
    return placeAfter(tr, between);
  }

  // A heading keeps its text; the break goes in front of it when the cursor
  // is at its start, as it would for a paragraph.
  if (inTopLevelTextblock && selection.empty && $from.parentOffset === 0 && topLevel.content.size > 0) {
    const start = $from.before(1);
    tr.insert(start, type.create());
    return placeAfter(tr, start);
  }

  const end = $from.after(1);
  tr.insert(end, type.create());
  return placeAfter(tr, end);
}

// Puts the cursor into the block after the break that was inserted at
// `breakPos`, adding an empty paragraph when the break ended the document:
// the next thing typed belongs on the new page.
function placeAfter(tr: Transaction, breakPos: number): Transaction {
  const afterBreak = breakPos + tr.doc.nodeAt(breakPos)!.nodeSize;
  const next = tr.doc.nodeAt(afterBreak);

  if (!next) {
    tr.insert(afterBreak, tr.doc.type.schema.nodes.paragraph.create());
  }

  const target = tr.doc.nodeAt(afterBreak);

  if (target?.isTextblock) {
    tr.setSelection(TextSelection.create(tr.doc, afterBreak + 1));
  } else {
    tr.setSelection(TextSelection.near(tr.doc.resolve(afterBreak)));
  }

  return tr.scrollIntoView();
}

type MarkdownSerializerState = {
  write: (content: string) => void;
  closeBlock: (node: ProseMirrorNode) => void;
};

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    pageBreak: {
      setPageBreak: () => ReturnType;
    };
  }
}

export const PageBreak = Node.create({
  name: "pageBreak",
  group: "block",
  atom: true,
  selectable: true,
  draggable: true,

  parseHTML() {
    return [
      { tag: "div[data-page-break]" },
      // HTML pasted from a browser page or another editor.
      {
        tag: "div",
        getAttrs: (element) => (isPageBreakStyle(element.getAttribute("style") ?? "") ? null : false)
      }
    ];
  },

  renderHTML() {
    // The style travels with a copy, so pasting into a word processor keeps
    // the break too.
    return ["div", { "data-page-break": "true", class: "page-break", style: "page-break-after: always;" }];
  },

  addNodeView() {
    return () => {
      const dom = document.createElement("div");
      dom.className = "page-break-node";
      dom.contentEditable = "false";
      dom.setAttribute("data-page-break", "true");

      const label = document.createElement("span");
      label.className = "page-break-node__label";
      dom.appendChild(label);

      const updateLabel = () => {
        label.textContent = i18n.t("editor.pageBreak");
      };
      updateLabel();
      i18n.on("languageChanged", updateLabel);

      return {
        dom,
        ignoreMutation: () => true,
        destroy: () => {
          i18n.off("languageChanged", updateLabel);
        }
      };
    };
  },

  addCommands() {
    return {
      setPageBreak:
        () =>
        ({ state, tr, dispatch }) => {
          if (!dispatch) {
            return Boolean(state.schema.nodes.pageBreak);
          }

          return insertPageBreakTransaction(state, tr) !== null;
        }
    };
  },

  addStorage() {
    return {
      markdown: {
        serialize(state: MarkdownSerializerState, node: ProseMirrorNode) {
          state.write(PAGE_BREAK_MARKDOWN);
          state.closeBlock(node);
        },
        parse: {
          setup(markdownit: MarkdownIt) {
            markdownit.use(pageBreakMarkdownItPlugin);
          }
        }
      }
    };
  }
});
