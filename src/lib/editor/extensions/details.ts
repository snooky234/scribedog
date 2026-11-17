import { Extension, mergeAttributes, Node } from "@tiptap/core";
import { Fragment, type Node as ProseMirrorNode, type ResolvedPos } from "@tiptap/pm/model";
import { Plugin, PluginKey, TextSelection, type EditorState, type Transaction } from "@tiptap/pm/state";
import { Decoration, DecorationSet, type EditorView } from "@tiptap/pm/view";
import type MarkdownIt from "markdown-it";
import type StateBlock from "markdown-it/lib/rules_block/state_block.mjs";
import type Token from "markdown-it/lib/token.mjs";

import i18n from "@/i18n";

// An expandable section: HTML's <details>/<summary>. The element itself is an
// open standard (HTML5) and CommonMark allows raw HTML, so GitHub, GitLab,
// VS Code, Obsidian and a plain browser all show it as a collapsible block
// without knowing anything about ScribeDog. On disk it is written in the one
// spelling that keeps the content readable as Markdown everywhere:
//
//   <details>
//   <summary>Title as plain text</summary>
//
//   Ordinary **Markdown**, lists, images ...
//
//   </details>
//
// The blank lines are what make the content Markdown: without them CommonMark
// keeps reading HTML and renders the inner Markdown as literal text. The
// summary stays plain text because Markdown inside <summary> is rendered by
// some tools and not by others.
//
// Reading is tolerant (missing blank lines, `open`, summary on the <details>
// line), but only as far as nothing gets lost: any other attribute, a tag
// inside the summary or a missing </details> leaves the lines alone, and they
// stay visible text exactly as before (the editor runs with `html: false`).
//
// The `open` attribute is the state a reader sees first and is part of the
// document. Expanding and collapsing in the editor is a view state of its own
// (detailsViewKey below): it neither marks the note as changed nor adds an
// undo step.

const OPEN_LINE_PATTERN = /^<details(\s+open(?:\s*=\s*(?:"(?:open)?"|'(?:open)?'|open))?)?\s*>(.*)$/i;
const NESTED_OPEN_PATTERN = /^<details(?:\s[^>]*)?>/i;
const CLOSE_LINE_PATTERN = /^<\/details\s*>$/i;
const SUMMARY_PATTERN = /^<summary>(.*)<\/summary>$/i;
// Anything that starts a tag or a comment. Kept as text it would be shown to
// the user as markup, and dropped it would lose formatting on save.
const TAG_PATTERN = /<[A-Za-z/!?]/;
const ENTITY_PATTERN = /&(?:#\d+|#x[0-9a-f]+|[a-z][a-z0-9]*);/gi;

function lineText(state: StateBlock, line: number): string {
  return state.src.slice(state.bMarks[line] + state.tShift[line], state.eMarks[line]).trim();
}

/** Summary text as the document holds it: entities decoded, whitespace collapsed. */
export function decodeSummary(raw: string, md: MarkdownIt): string {
  return raw
    .replace(ENTITY_PATTERN, (entity) => md.utils.unescapeAll(entity))
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Summary text as it is written: only what HTML would otherwise read as
 * markup is escaped, so "Q&A" or "a < b" stay as typed.
 */
export function encodeSummary(text: string): string {
  return text
    .replace(/\s+/g, " ")
    .trim()
    .replace(/&(?=#?[a-z0-9]+;)/gi, "&amp;")
    .replace(/<(?=[A-Za-z/!?])/g, "&lt;");
}

function detailsRule(state: StateBlock, startLine: number, endLine: number, silent: boolean): boolean {
  // Indented four or more, the line is a code block.
  if (state.sCount[startLine] - state.blkIndent >= 4) {
    return false;
  }

  const open = OPEN_LINE_PATTERN.exec(lineText(state, startLine));

  if (!open) {
    return false;
  }

  const rest = open[2].trim();
  let summary: string | null = null;
  let contentStart = startLine + 1;

  if (rest) {
    const sameLine = SUMMARY_PATTERN.exec(rest);

    if (!sameLine) {
      return false;
    }

    summary = sameLine[1];
  } else if (contentStart < endLine && state.sCount[contentStart] >= state.blkIndent) {
    const nextLine = SUMMARY_PATTERN.exec(lineText(state, contentStart));

    if (nextLine) {
      summary = nextLine[1];
      contentStart += 1;
    }
  }

  if (summary !== null && TAG_PATTERN.test(summary)) {
    return false;
  }

  // The matching </details>, counting nested ones. A line indented less than
  // the surrounding container ends the search: the block would cross out of
  // its list item.
  let depth = 1;
  let closeLine = -1;

  for (let line = contentStart; line < endLine; line++) {
    const text = lineText(state, line);

    if (text && state.sCount[line] < state.blkIndent) {
      break;
    }

    if (CLOSE_LINE_PATTERN.test(text)) {
      depth -= 1;

      if (depth === 0) {
        closeLine = line;
        break;
      }
    } else if (NESTED_OPEN_PATTERN.test(text)) {
      depth += 1;
    }
  }

  if (closeLine === -1) {
    return false;
  }

  if (silent) {
    return true;
  }

  const openToken = state.push("details_open", "div", 1);
  openToken.block = true;
  openToken.map = [startLine, closeLine + 1];
  openToken.meta = { open: open[1] !== undefined };

  const summaryToken = state.push("details_summary", "div", 0);
  summaryToken.block = true;
  summaryToken.content = decodeSummary(summary ?? "", state.md);

  const oldParentType = state.parentType;
  const oldLineMax = state.lineMax;

  // Not "root": a manual page break inside is text, as it is in a list or a
  // quote (pageBreak.ts), since no paged format can break inside the block.
  state.parentType = "details" as typeof state.parentType;
  state.lineMax = closeLine;
  state.md.block.tokenize(state, contentStart, closeLine);
  state.parentType = oldParentType;
  state.lineMax = oldLineMax;

  const closeToken = state.push("details_close", "div", -1);
  closeToken.block = true;

  state.line = closeLine + 1;

  return true;
}

// Registered in the editor (through the node's parse setup) and in the export
// parser (createExportMarkdownIt). The tokens are details_open (meta.open),
// details_summary (content = decoded text), the content, details_close.
export function detailsMarkdownItPlugin(md: MarkdownIt): void {
  md.block.ruler.before("html_block", "details", detailsRule, {
    // Like an HTML block, it may start right below a paragraph line.
    alt: ["paragraph", "reference", "blockquote", "list"]
  });
  md.core.ruler.after("block", "details_loose_lists", (state) => {
    looseListsAroundDetails(state.tokens);
  });
  md.renderer.rules.details_open = (tokens, index) =>
    `<div data-details=""${tokens[index].meta?.open ? ' data-open="true"' : ""}>\n`;
  md.renderer.rules.details_summary = (tokens, index) =>
    `<div data-details-summary="">${md.utils.escapeHtml(tokens[index].content)}</div>\n`;
  md.renderer.rules.details_close = () => "</div>\n";
}

// A list that holds a section is a loose list: the section needs blank lines
// around its content, and in CommonMark blank lines between the blocks of an
// item make the whole list loose. markdown-it still reads such a list as
// tight when the source had no blank line between the items, and the editor
// would then save it differently the second time. Showing the item paragraphs
// (which is all "tight" means to markdown-it) gives the editor a loose list
// from the start.
function looseListsAroundDetails(tokens: Token[]): void {
  const open: number[] = [];
  const done = new Set<number>();

  for (let index = 0; index < tokens.length; index++) {
    const token = tokens[index];

    if (token.type === "bullet_list_open" || token.type === "ordered_list_open") {
      open.push(index);
    } else if (token.type === "bullet_list_close" || token.type === "ordered_list_close") {
      open.pop();
    } else if (token.type === "details_open") {
      for (const listIndex of open) {
        if (done.has(listIndex)) {
          continue;
        }

        done.add(listIndex);
        const level = tokens[listIndex].level + 2;

        for (let inner = listIndex + 1; inner < tokens.length; inner++) {
          const candidate = tokens[inner];

          if (candidate.level === tokens[listIndex].level && candidate.nesting === -1) {
            break;
          }

          if (candidate.level === level && (candidate.type === "paragraph_open" || candidate.type === "paragraph_close")) {
            candidate.hidden = false;
          }
        }
      }
    }
  }
}

// The same in the editor, for a section that comes into a list later
// (inserted, pasted, accepted from the assistant): every list around it
// becomes loose in the same transaction.
function looseListsPlugin(): Plugin {
  return new Plugin({
    appendTransaction(transactions, _oldState, newState) {
      if (!transactions.some((tr) => tr.docChanged)) {
        return null;
      }

      let tr: Transaction | null = null;

      newState.doc.descendants((node, pos) => {
        if (node.type.name !== "details") {
          return !node.isTextblock;
        }

        const $pos = newState.doc.resolve(pos);

        for (let depth = $pos.depth; depth > 0; depth--) {
          const ancestor = $pos.node(depth);

          if (LIST_TYPES.has(ancestor.type.name) && ancestor.attrs.tight === true) {
            tr ??= newState.tr;
            tr.setNodeAttribute($pos.before(depth), "tight", false);
          }
        }

        return true;
      });

      return tr;
    }
  });
}

// ---------------------------------------------------------------------------
// View state: which sections are collapsed in the editor.

type DetailsMeta = { toggle: number } | { expand: number };

export const detailsViewKey = new PluginKey<DecorationSet>("detailsView");

type MarkerSpec = { details: true; collapsed: boolean };

function markerAt(set: DecorationSet, pos: number): Decoration | undefined {
  return set.find(pos, pos + 1, (spec) => (spec as Partial<MarkerSpec>).details === true).find((d) => d.from === pos);
}

function isCollapsed(set: DecorationSet, pos: number): boolean {
  return Boolean((markerAt(set, pos)?.spec as MarkerSpec | undefined)?.collapsed);
}

function buildMarkers(doc: ProseMirrorNode, previous: DecorationSet | null, override?: Map<number, boolean>) {
  const decorations: Decoration[] = [];

  doc.descendants((node, pos) => {
    if (node.type.name === "details") {
      const known = previous ? markerAt(previous, pos) : undefined;
      const knownSpec = known && known.to === pos + node.nodeSize ? (known.spec as MarkerSpec) : undefined;
      // A section the editor has not seen yet (the note was just opened,
      // pasted, accepted from the assistant) starts the way a reader sees it.
      const collapsed = override?.get(pos) ?? knownSpec?.collapsed ?? !node.attrs.open;
      const spec: MarkerSpec = { details: true, collapsed };

      decorations.push(
        Decoration.node(pos, pos + node.nodeSize, collapsed ? { class: "details-block--collapsed" } : {}, spec)
      );

      const summary = node.firstChild;

      if (summary && summary.content.size === 0) {
        decorations.push(
          Decoration.node(pos + 1, pos + 1 + summary.nodeSize, {
            class: "details-block__summary--empty",
            "data-placeholder": i18n.t("editor.detailsSummaryPlaceholder")
          })
        );
      }
    }

    return !node.isTextblock;
  });

  return DecorationSet.create(doc, decorations);
}

/** Depth of the innermost details section around $pos, or null. */
function detailsDepth($pos: ResolvedPos): number | null {
  for (let depth = $pos.depth; depth > 0; depth--) {
    if ($pos.node(depth).type.name === "details") {
      return depth;
    }
  }

  return null;
}

/**
 * The collapsed sections the head of the selection sits in, below their
 * summary. Search, the outline and the arrow keys all move the selection;
 * where they land has to be visible.
 */
function collapsedAroundHead(state: { selection: { $head: ResolvedPos } }, set: DecorationSet): number[] {
  const { $head } = state.selection;
  const found: number[] = [];

  for (let depth = $head.depth; depth > 0; depth--) {
    if ($head.node(depth).type.name === "details" && $head.index(depth) > 0) {
      const pos = $head.before(depth);

      if (isCollapsed(set, pos)) {
        found.push(pos);
      }
    }
  }

  return found;
}

function detailsViewPlugin(): Plugin<DecorationSet> {
  return new Plugin<DecorationSet>({
    key: detailsViewKey,
    state: {
      init: (_config, state) => buildMarkers(state.doc, null),
      apply(tr, set) {
        const meta = tr.getMeta(detailsViewKey) as DetailsMeta | undefined;
        let next = tr.docChanged ? buildMarkers(tr.doc, set.map(tr.mapping, tr.doc)) : set;
        const overrides = new Map<number, boolean>();

        if (meta && "toggle" in meta) {
          overrides.set(meta.toggle, !isCollapsed(next, meta.toggle));
        } else if (meta && "expand" in meta) {
          overrides.set(meta.expand, false);
        }

        if (tr.selectionSet && !(meta && "toggle" in meta)) {
          for (const pos of collapsedAroundHead(tr, next)) {
            overrides.set(pos, false);
          }
        }

        if (overrides.size > 0) {
          next = buildMarkers(tr.doc, next, overrides);
        }

        return next;
      }
    },
    props: {
      decorations: (state) => detailsViewKey.getState(state)
    }
  });
}

/**
 * Expands or collapses the section at `pos` without touching the document. A
 * selection inside the content moves to the end of the summary first, or it
 * would sit in hidden text (and expand the section again right away).
 */
export function toggleDetailsView(view: EditorView, pos: number): void {
  const { state } = view;
  const node = state.doc.nodeAt(pos);
  const set = detailsViewKey.getState(state);

  if (!node || node.type.name !== "details" || !set) {
    return;
  }

  const tr = state.tr.setMeta(detailsViewKey, { toggle: pos } satisfies DetailsMeta);

  if (!isCollapsed(set, pos)) {
    const contentStart = pos + 1 + node.child(0).nodeSize;
    const end = pos + node.nodeSize;
    const inside = (at: number) => at > contentStart && at < end;

    if (inside(state.selection.head) || inside(state.selection.anchor)) {
      tr.setSelection(TextSelection.create(tr.doc, contentStart - 1));
    }
  }

  view.dispatch(tr);
}

// ---------------------------------------------------------------------------
// Nodes.

type MarkdownSerializerState = {
  inTightList: boolean;
  write: (content: string) => void;
  ensureNewLine: () => void;
  closeBlock: (node: ProseMirrorNode) => void;
  renderContent: (node: ProseMirrorNode) => void;
};

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    details: {
      setDetails: () => ReturnType;
      unsetDetails: () => ReturnType;
      setDetailsOpenByDefault: (open: boolean) => ReturnType;
    };
  }
}

const CHEVRON_SVG =
  '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m9 18 6-6-6-6"/></svg>';

const TABLE_CELL_TYPES = new Set(["tableCell", "tableHeader"]);
const LIST_TYPES = new Set(["bulletList", "orderedList", "taskList"]);

function insideTable($pos: ResolvedPos): boolean {
  for (let depth = $pos.depth; depth > 0; depth--) {
    if (TABLE_CELL_TYPES.has($pos.node(depth).type.name)) {
      return true;
    }
  }

  return false;
}

export const DetailsSummary = Node.create({
  name: "detailsSummary",
  content: "text*",
  marks: "",
  defining: true,
  selectable: false,

  parseHTML() {
    return [{ tag: "div[data-details-summary]" }, { tag: "summary" }];
  },

  renderHTML({ HTMLAttributes }) {
    return ["div", mergeAttributes(HTMLAttributes, { "data-details-summary": "", class: "details-block__summary" }), 0];
  },

  addStorage() {
    return {
      markdown: {
        serialize(state: MarkdownSerializerState, node: ProseMirrorNode) {
          const text = encodeSummary(node.textContent);

          // No title, no line: a browser then shows its own "Details".
          if (text) {
            state.write(`<summary>${text}</summary>`);
          }

          // The blank line after it is what makes the content Markdown.
          state.closeBlock(node);
        },
        parse: {
          // handled by the details node's markdown-it rule
        }
      }
    };
  }
});

export const Details = Node.create({
  name: "details",
  group: "block",
  content: "detailsSummary block+",
  defining: true,

  addAttributes() {
    return {
      open: {
        default: false,
        parseHTML: (element) =>
          element.tagName.toLowerCase() === "details"
            ? element.hasAttribute("open")
            : element.getAttribute("data-open") === "true",
        renderHTML: (attributes) => (attributes.open ? { "data-open": "true" } : {})
      }
    };
  },

  parseHTML() {
    return [{ tag: "div[data-details]" }, { tag: "details" }];
  },

  renderHTML({ HTMLAttributes }) {
    return ["div", mergeAttributes(HTMLAttributes, { "data-details": "", class: "details-block" }), 0];
  },

  addNodeView() {
    return ({ editor, getPos, decorations }) => {
      const dom = document.createElement("div");
      dom.className = "details-block";
      dom.setAttribute("data-details", "");

      const toggle = document.createElement("button");
      toggle.type = "button";
      toggle.className = "details-block__toggle";
      toggle.contentEditable = "false";
      toggle.innerHTML = CHEVRON_SVG;

      const body = document.createElement("div");
      body.className = "details-block__body";

      dom.append(toggle, body);

      let collapsed = false;

      const syncToggle = () => {
        const label = i18n.t(collapsed ? "editor.detailsExpand" : "editor.detailsCollapse");
        toggle.setAttribute("aria-expanded", String(!collapsed));
        toggle.setAttribute("aria-label", label);
        toggle.title = label;
      };

      const readDecorations = (decos: readonly Decoration[]) => {
        collapsed = decos.some((decoration) => (decoration.spec as Partial<MarkerSpec>).collapsed === true);
        syncToggle();
      };

      readDecorations(decorations as readonly Decoration[]);
      i18n.on("languageChanged", syncToggle);

      toggle.addEventListener("mousedown", (event) => {
        // Keeps the caret (and the focus) where it was.
        event.preventDefault();
      });
      toggle.addEventListener("click", (event) => {
        event.preventDefault();
        const pos = typeof getPos === "function" ? getPos() : undefined;

        if (typeof pos === "number") {
          toggleDetailsView(editor.view, pos);
        }
      });

      return {
        dom,
        contentDOM: body,
        update: (node, decos) => {
          if (node.type.name !== "details") {
            return false;
          }

          readDecorations(decos as readonly Decoration[]);
          return true;
        },
        stopEvent: (event) => toggle.contains(event.target as globalThis.Node),
        ignoreMutation: (mutation) =>
          mutation.type !== "selection" && !body.contains(mutation.target as globalThis.Node),
        destroy: () => {
          i18n.off("languageChanged", syncToggle);
        }
      };
    };
  },

  addCommands() {
    return {
      setDetails:
        () =>
        ({ state, tr, dispatch }) => {
          const summaryType = state.schema.nodes.detailsSummary;
          const { $from, $to } = tr.selection;

          if (!summaryType || insideTable($from)) {
            return false;
          }

          const finish = (pos: number) => {
            tr.setSelection(TextSelection.create(tr.doc, pos + 2));
            tr.setMeta(detailsViewKey, { expand: pos } satisfies DetailsMeta);
            tr.scrollIntoView();
          };

          // Wraps the selected blocks; the summary starts empty and gets the
          // caret.
          const range = $from.blockRange($to);

          if (range) {
            const content = Fragment.from(summaryType.create()).append(
              tr.doc.slice(range.start, range.end).content
            );

            if (
              this.type.validContent(content) &&
              range.parent.canReplaceWith(range.startIndex, range.endIndex, this.type)
            ) {
              if (dispatch) {
                tr.replaceWith(range.start, range.end, this.type.create({ open: false }, content));
                finish(range.start);
              }

              return true;
            }
          }

          // Selected list items: the list is split around them, and they move
          // into the section as a list of their own, at the same place.
          if (!tr.selection.empty) {
            const listRange = $from.blockRange($to, (node) => LIST_TYPES.has(node.type.name));

            if (listRange && listRange.depth > 0) {
              const list = listRange.parent;
              const listPos = $from.before(listRange.depth);
              const container = $from.node(listRange.depth - 1);
              const at = $from.index(listRange.depth - 1);
              const items: ProseMirrorNode[] = [];
              list.forEach((item) => items.push(item));

              const firstNumber = typeof list.attrs.start === "number" ? list.attrs.start : null;
              const part = (from: number, to: number) =>
                list.type.create(
                  firstNumber === null ? list.attrs : { ...list.attrs, start: firstNumber + from },
                  items.slice(from, to)
                );
              const { startIndex, endIndex } = listRange;
              const details = this.type.create(
                { open: false },
                Fragment.from([summaryType.create(), part(startIndex, endIndex)])
              );
              const before = startIndex > 0 ? part(0, startIndex) : null;
              const after = endIndex < items.length ? part(endIndex, items.length) : null;
              const replacement = Fragment.from([before, details, after].filter((node) => node !== null));

              if (container.canReplace(at, at + 1, replacement)) {
                if (dispatch) {
                  tr.replaceWith(listPos, listPos + list.nodeSize, replacement);
                  finish(listPos + (before?.nodeSize ?? 0));
                }

                return true;
              }
            }
          }

          // The first paragraph of a list item cannot be wrapped (the item
          // needs it as its lead block): an empty section goes right below it.
          if (!$from.parent.isTextblock || $from.depth < 1) {
            return false;
          }

          const container = $from.node(-1);
          const index = $from.index(-1) + 1;

          if (!container.canReplaceWith(index, index, this.type)) {
            return false;
          }

          const details = this.type.createAndFill();

          if (!details) {
            return false;
          }

          if (dispatch) {
            const insertPos = $from.after();
            tr.insert(insertPos, details);
            finish(insertPos);
          }

          return true;
        },
      unsetDetails:
        () =>
        ({ state, tr, dispatch }) => {
          const { $from } = tr.selection;
          const depth = detailsDepth($from);

          if (depth === null) {
            return false;
          }

          const node = $from.node(depth);
          const pos = $from.before(depth);
          const blocks: ProseMirrorNode[] = [];
          const title = node.child(0).textContent.trim();

          if (title) {
            blocks.push(state.schema.nodes.paragraph.create(null, state.schema.text(title)));
          }

          node.forEach((child, _offset, index) => {
            const isLoneEmptyParagraph =
              node.childCount === 2 && child.type.name === "paragraph" && child.content.size === 0;

            if (index > 0 && !(title && isLoneEmptyParagraph)) {
              blocks.push(child);
            }
          });

          const parent = $from.node(depth - 1);
          const at = $from.index(depth - 1);

          if (!parent.canReplace(at, at + 1, Fragment.from(blocks))) {
            return false;
          }

          if (dispatch) {
            tr.replaceWith(pos, pos + node.nodeSize, blocks);
            tr.setSelection(TextSelection.near(tr.doc.resolve(Math.min(pos + 1, tr.doc.content.size))));
            tr.scrollIntoView();
          }

          return true;
        },
      setDetailsOpenByDefault:
        (open) =>
        ({ tr, dispatch }) => {
          const { $from } = tr.selection;
          const depth = detailsDepth($from);

          if (depth === null) {
            return false;
          }

          if (dispatch) {
            // Only the stored start state changes; what the editor shows
            // right now stays as it is.
            tr.setNodeAttribute($from.before(depth), "open", open);
          }

          return true;
        }
    };
  },

  addKeyboardShortcuts() {
    const inSummary = (state: EditorState) => {
      const { selection } = state;
      return selection.empty && selection.$from.parent.type.name === "detailsSummary" ? selection.$from : null;
    };

    return {
      // The summary is a single line: Enter starts a new line at the top of
      // the content, or goes to the empty one that is already there.
      Enter: ({ editor }) => {
        const { state } = editor;
        const $from = inSummary(state);

        if ($from) {
          const contentStart = $from.after();
          const first = state.doc.nodeAt(contentStart);
          const tr = state.tr;

          if (!(first?.type.name === "paragraph" && first.content.size === 0)) {
            tr.insert(contentStart, state.schema.nodes.paragraph.create());
          }

          tr.setSelection(TextSelection.create(tr.doc, contentStart + 1));
          editor.view.dispatch(tr.scrollIntoView());
          return true;
        }

        return leaveDetailsOnEmptyLastLine(editor.state, (tr) => editor.view.dispatch(tr));
      },
      Backspace: ({ editor }) => {
        const { state } = editor;
        const $summary = inSummary(state);

        if ($summary && $summary.parentOffset === 0) {
          // An empty section goes away again on Backspace; with a title the
          // key does nothing here instead of merging the title into the
          // block above.
          return $summary.parent.content.size === 0 ? editor.commands.unsetDetails() : true;
        }

        const { selection } = state;
        const { $from } = selection;

        // At the start of the first content block: back into the summary
        // rather than joining the two.
        if (
          selection.empty &&
          $from.parentOffset === 0 &&
          $from.depth >= 2 &&
          $from.node(-1).type.name === "details" &&
          $from.index(-1) === 1
        ) {
          const summaryEnd = $from.before() - 1;
          editor.view.dispatch(state.tr.setSelection(TextSelection.create(state.doc, summaryEnd)));
          return true;
        }

        return false;
      }
    };
  },

  addProseMirrorPlugins() {
    return [detailsViewPlugin(), looseListsPlugin()];
  },

  addStorage() {
    return {
      markdown: {
        serialize(state: MarkdownSerializerState, node: ProseMirrorNode) {
          state.write(node.attrs.open ? "<details open>" : "<details>");
          state.ensureNewLine();
          // The blank lines inside are what make the content Markdown, even
          // where the surrounding list is still marked tight.
          const tight = state.inTightList;
          state.inTightList = false;
          state.renderContent(node);
          state.inTightList = tight;
          state.write("</details>");
          state.closeBlock(node);
        },
        parse: {
          setup(markdownit: MarkdownIt) {
            markdownit.use(detailsMarkdownItPlugin);
          }
        }
      }
    };
  }
});

/**
 * Enter on an empty last line of a section's content leaves the section: the
 * line moves behind it. Only when the section keeps content of its own.
 */
function leaveDetailsOnEmptyLastLine(state: EditorState, dispatch: (tr: Transaction) => void): boolean {
  const { selection } = state;
  const { $from } = selection;

  if (!selection.empty || $from.depth < 2 || $from.parent.type.name !== "paragraph" || $from.parent.content.size > 0) {
    return false;
  }

  const details = $from.node(-1);

  if (details.type.name !== "details" || $from.index(-1) !== details.childCount - 1 || details.childCount <= 2) {
    return false;
  }

  const paragraphStart = $from.before();
  const detailsEnd = $from.after(-1);
  const tr = state.tr.delete(paragraphStart, $from.after());
  const insertAt = tr.mapping.map(detailsEnd);

  tr.insert(insertAt, state.schema.nodes.paragraph.create());
  tr.setSelection(TextSelection.create(tr.doc, insertAt + 1));
  dispatch(tr.scrollIntoView());

  return true;
}

// Both nodes as one extension, for the extension list.
export const DetailsExtensions = Extension.create({
  name: "detailsExtensions",
  addExtensions() {
    return [Details, DetailsSummary];
  }
});
