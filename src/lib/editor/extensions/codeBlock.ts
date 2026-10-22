import { InputRule } from "@tiptap/core";
import { CodeBlockLowlight } from "@tiptap/extension-code-block-lowlight";
import type { Node as ProseMirrorNode, NodeType } from "@tiptap/pm/model";
import { Selection, TextSelection } from "@tiptap/pm/state";
import type { Transaction } from "@tiptap/pm/state";
import { ReactNodeViewRenderer } from "@tiptap/react";
import type MarkdownIt from "markdown-it";

import { CodeBlockView } from "@/components/CodeBlockView";
import { codeBlockLowlight } from "@/lib/codeLanguages";

const LIST_ITEM_TYPES = ["listItem", "taskItem"];

// The same patterns as TipTap's own input rules (```js or ~~~ plus a space).
const FENCE_INPUT_RULES = [/^```([a-z]+)?[\s\n]$/, /^~~~([a-z]+)?[\s\n]$/];

// Depth of the paragraph the selection sits in when that paragraph is the
// first block of a list item, otherwise -1. A list item has to start with a
// paragraph, so a code block can't take its place: TipTap's setNode then
// falls back to clearNodes, which lifts the line out of the list and splits
// the list around the new code block (issue #79).
function listLeadDepth(selection: Selection): number {
  const { $from, $to } = selection;
  const depth = $from.depth;

  if (!$from.sameParent($to) || $from.parent.type.name !== "paragraph" || depth < 2) {
    return -1;
  }

  if (!LIST_ITEM_TYPES.includes($from.node(depth - 1).type.name) || $from.index(depth - 1) !== 0) {
    return -1;
  }

  return depth;
}

// The line becomes a code block inside its own list item: an empty paragraph
// stays behind as the item's first line, the way Markdown writes a list item
// that holds nothing but a fenced block. The paragraph's text goes into the
// code block, like the toggle does everywhere else.
function codeBlockInListLead(tr: Transaction, depth: number, type: NodeType, attributes: Record<string, unknown>): void {
  const $from = tr.selection.$from;
  const start = $from.before(depth);
  const paragraph = $from.parent;

  tr.insert(start, paragraph.type.create());

  // The line is the item's second block now, where a code block may stand;
  // setBlockType turns hard breaks into newlines, and the selection follows
  // through the steps' mapping.
  const lineStart = start + 2;
  tr.setBlockType(lineStart, lineStart + paragraph.nodeSize, type, attributes);
}

// A paragraph with line breaks (Shift+Enter) is several lines to the reader
// but one block to the toggle, which used to turn all of it into code, the
// lines above the caret included. The paragraph is split at the breaks around
// the selected lines first: lines before stay text (in a list item they are
// its first line, so no empty marker line is left), the selected ones become
// the block, the lines after stay text below it.
function isolateSelectedLines(tr: Transaction): void {
  const { $from, $to } = tr.selection;

  if (!$from.sameParent($to)) {
    return;
  }

  const paragraph = $from.parent;
  const contentStart = $from.start();
  const breaks: number[] = [];

  paragraph.forEach((child, offset) => {
    if (child.type.name === "hardBreak") {
      breaks.push(offset);
    }
  });

  // The break that ends the line before the selection, and the one that ends
  // its last line. A caret right in front of a break belongs to that line.
  const before = breaks.filter((offset) => offset < $from.parentOffset).pop();
  const after = breaks.find((offset) => offset >= $to.parentOffset);

  if (before === undefined && after === undefined) {
    return;
  }

  const lineStart = before === undefined ? 0 : before + 1;
  const fromInLine = $from.parentOffset - lineStart;
  const toInLine = $to.parentOffset - lineStart;

  // Back to front, so the earlier position still holds.
  if (after !== undefined) {
    tr.delete(contentStart + after, contentStart + after + 1);
    tr.split(contentStart + after);
  }

  let lineContentStart = contentStart;

  if (before !== undefined) {
    tr.delete(contentStart + before, contentStart + before + 1);
    tr.split(contentStart + before);
    // The split closes one paragraph and opens the next.
    lineContentStart = contentStart + before + 2;
  }

  tr.setSelection(TextSelection.create(tr.doc, lineContentStart + fromInLine, lineContentStart + toInLine));
}

// The way back: a code block directly under an empty first line of a list
// item becomes that line again, so toggling twice leaves the item as it was.
function listLeadCodeBlockDepth(selection: Selection, type: NodeType): number {
  const { $from, $to } = selection;
  const depth = $from.depth;

  if (!$from.sameParent($to) || $from.parent.type !== type || depth < 2) {
    return -1;
  }

  const item = $from.node(depth - 1);

  if (!LIST_ITEM_TYPES.includes(item.type.name) || $from.index(depth - 1) !== 1) {
    return -1;
  }

  const lead = item.child(0);

  return lead.type.name === "paragraph" && lead.content.size === 0 ? depth : -1;
}

function paragraphFromListLeadCodeBlock(tr: Transaction, depth: number): void {
  const $from = tr.selection.$from;
  const start = $from.before(depth);
  const paragraph = tr.doc.type.schema.nodes.paragraph;

  // First the block becomes a paragraph (newlines turn into hard breaks), then
  // the empty line above it goes: the item starts with a paragraph throughout.
  tr.setBlockType(start, $from.after(depth), paragraph);
  tr.delete(start - 2, start);
}

type MarkdownState = {
  closed: ProseMirrorNode | null;
  inTightList: boolean;
  flushClose(size?: number): void;
  write(content?: string): void;
  text(text: string, escape?: boolean): void;
  ensureNewLine(): void;
  closeBlock(node: ProseMirrorNode): void;
};

// tiptap-markdown's fence, plus where it starts inside a list item. Behind an
// empty first line the fence goes on the marker's own line ("4. ```js"): the
// default blank line in between would end the item right there, since a list
// item can't begin with two blank lines, and the block would land outside the
// list on reopening. In a tight list the fence follows a written first line
// directly; the blank line would make the whole list loose.
function serializeCodeBlock(state: MarkdownState, node: ProseMirrorNode, parent: ProseMirrorNode, index: number): void {
  if (LIST_ITEM_TYPES.includes(parent.type.name) && index > 0 && state.closed) {
    const lead = parent.child(0);

    // A checklist item keeps its "- [ ]" line: a fence behind the checkbox
    // would hide it from the task list parser.
    if (index === 1 && parent.type.name === "listItem" && lead.type.name === "paragraph" && lead.content.size === 0) {
      state.closed = null;
    } else if (state.inTightList) {
      state.flushClose(1);
    }
  }

  state.write("```" + (node.attrs.language || "") + "\n");
  state.text(node.textContent, false);
  state.ensureNewLine();
  state.write("```");
  state.closeBlock(node);
}

// markdown-it renders an item that starts with a fence as <li><pre>, which
// ProseMirror's DOM parser can't fit into an item that has to begin with a
// paragraph: it closes the list before the block. The empty first line the
// editor keeps there goes back in. A list's tightness is read from the absence
// of <p> elements anywhere inside it, so every list is pinned before one is
// added, the outer ones of a nested list included.
function restoreListLeadParagraphs(element: HTMLElement): void {
  const leadBlocks = [...element.querySelectorAll("li > pre")].filter((pre) => {
    const item = pre.parentElement;

    // Text before the block ("4. Install:" plus a fence) is a first line
    // already.
    if (!item || item.firstElementChild !== pre) {
      return false;
    }

    const nodes = [...item.childNodes];

    return nodes.slice(0, nodes.indexOf(pre)).every((child) => !child.textContent?.trim());
  });

  if (leadBlocks.length === 0) {
    return;
  }

  for (const list of element.querySelectorAll("ul, ol")) {
    if (!list.hasAttribute("data-tight") && !list.querySelector("p")) {
      list.setAttribute("data-tight", "true");
    }
  }

  for (const pre of leadBlocks) {
    pre.before(element.ownerDocument.createElement("p"));
  }
}

// Highlighting is applied as ProseMirror decorations, so the document stays
// plain text — markdown serialization, undo history and the exporters (which
// read the code block's text content) are unaffected.
export const CodeBlock = CodeBlockLowlight.extend({
  addStorage() {
    return {
      ...this.parent?.(),
      markdown: {
        serialize: serializeCodeBlock,
        parse: {
          setup(markdownit: MarkdownIt) {
            markdownit.set({ langPrefix: "language-" });
          },
          updateDOM(element: HTMLElement) {
            // tiptap-markdown's own step: no trailing newline in the block.
            element.innerHTML = element.innerHTML.replace(/\n<\/code><\/pre>/g, "</code></pre>");
            restoreListLeadParagraphs(element);
          }
        }
      }
    };
  },

  addCommands() {
    const parent = this.parent?.();

    return {
      ...parent,
      toggleCodeBlock:
        (attributes) =>
        ({ state, dispatch, commands }) => {
          if (dispatch && state.selection.$from.parent.type.name === "paragraph") {
            isolateSelectedLines(state.tr);
          }

          // Reading state.tr is what brings state.selection and state.doc up
          // to date with the split above, for this code and for toggleNode.
          const { tr } = state;
          const leadDepth = listLeadDepth(state.selection);

          if (leadDepth !== -1) {
            if (dispatch) {
              codeBlockInListLead(tr, leadDepth, this.type, attributes ?? {});
            }

            return true;
          }

          const codeDepth = listLeadCodeBlockDepth(state.selection, this.type);

          if (codeDepth !== -1) {
            if (dispatch) {
              paragraphFromListLeadCodeBlock(tr, codeDepth);
            }

            return true;
          }

          return commands.toggleNode(this.name, "paragraph", attributes);
        }
    };
  },

  addKeyboardShortcuts() {
    const parent = this.parent?.() ?? {};

    return {
      ...parent,
      // TipTap only looks for a node right after the block inside the same
      // parent. A block that ends a list item has none there, so ArrowDown at
      // its end called exitCode and put a new empty line into the item,
      // instead of moving on to the next item below. The caret now goes to
      // whatever comes next in the document; a new line after the block only
      // appears where nothing follows at all (Enter three times still adds one
      // on purpose).
      ArrowDown: (props) => {
        const { state, view } = props.editor;
        const { $from, empty } = state.selection;
        const atEnd = empty && $from.parent.type === this.type && $from.parentOffset === $from.parent.content.size;
        const next = atEnd && this.options.exitOnArrowDown ? Selection.findFrom(state.doc.resolve($from.after()), 1) : null;

        if (!next) {
          return parent.ArrowDown?.(props) ?? false;
        }

        view.dispatch(state.tr.setSelection(next).scrollIntoView());

        return true;
      }
    };
  },

  addInputRules() {
    // Runs before TipTap's own rules, which silently do nothing on the first
    // line of a list item (its setBlockType can't apply there).
    const listRules = FENCE_INPUT_RULES.map(
      (find) =>
        new InputRule({
          find,
          handler: ({ state, range, match }) => {
            const depth = listLeadDepth(state.selection);

            if (depth === -1) {
              return null;
            }

            state.tr.delete(range.from, range.to);
            codeBlockInListLead(state.tr, depth, this.type, { language: match[1] });
          }
        })
    );

    return [...listRules, ...(this.parent?.() ?? [])];
  },

  addNodeView() {
    // selectedOnTextSelection: the badges only need to show while the caret
    // is actually inside this block, not only on a full node selection.
    const render = ReactNodeViewRenderer(CodeBlockView, { selectedOnTextSelection: true });

    return (props) => {
      const nodeView = render(props);

      // TipTap's default ignoreMutation has an Android/iOS branch that lets
      // childList mutations *outside* the contentDOM through as long as the
      // added nodes are contentEditable (meant for the virtual keyboard).
      // React mounts this view's wrapper and the contentDOM host after the
      // node view is created, so exactly such a mutation happens on every
      // (re)render. prosemirror-view then reads an added block element on
      // Android as an Enter key, the Enter re-renders the code block, and the
      // tab hangs in that loop. Only the contentDOM is ProseMirror's business
      // here; everything else is React's own rendering.
      nodeView.ignoreMutation = (mutation) => {
        if (mutation.type === "selection") {
          return false;
        }

        const contentDOM = nodeView.contentDOM;

        if (!contentDOM) {
          return true;
        }

        if (contentDOM === mutation.target && mutation.type === "attributes") {
          return true;
        }

        return !contentDOM.contains(mutation.target);
      };

      // React attaches the contentDOM only once the view has rendered, but
      // ProseMirror puts the browser's caret into it right away. For a block
      // just created around the caret (the toggle, a typed fence) that lands
      // in a detached element, and the browser leaves the caret in the line
      // next to the block: the next key typed went there instead of into the
      // code. One frame later the block is in place and the caret goes in.
      requestAnimationFrame(() => {
        // TipTap's view getter throws once the editor is gone.
        if (props.editor.isDestroyed) {
          return;
        }

        const { view } = props.editor;
        const pos = props.getPos();

        if (!view.hasFocus() || typeof pos !== "number" || !nodeView.contentDOM?.isConnected) {
          return;
        }

        const { from, to } = view.state.selection;

        if (from > pos && to < pos + view.state.doc.nodeAt(pos)!.nodeSize) {
          view.focus();
        }
      });

      return nodeView;
    };
  }
}).configure({ lowlight: codeBlockLowlight });
