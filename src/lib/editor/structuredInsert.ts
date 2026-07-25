import { createNodeFromContent } from "@tiptap/core";
import { Fragment, type Node as ProseMirrorNode, type ResolvedPos } from "@tiptap/pm/model";
import type { Editor } from "@tiptap/react";

// Applying a Markdown proposal to a *range inside a block* is where the chat
// agent's edits used to fall apart, and neither failure was the model's fault:
//
//  - A table row on its own ("| Lisa | … |") is not a table. Markdown needs the
//    header and delimiter lines, so markdown-it parses a lone row as a
//    paragraph — which then landed as literal pipe text inside a table cell.
//  - A list of "- [ ] …" items parses into a whole <ul>. Inserted at a range
//    that sits inside an existing list item's paragraph, that <ul> becomes a
//    *nested* list under an emptied item instead of new sibling items.
//
// Both are fixed here rather than by prompting: the proposal is completed
// against the structure it targets (missing table head rebuilt from the target
// table), and the replaced range is widened from "some text inside a block" to
// the rows / items / blocks the proposal actually means to replace.

const LIST_ITEM_TYPES = ["listItem", "taskItem"];
const LIST_TYPES = ["bulletList", "orderedList", "taskList"];

// A GFM delimiter row: "|---|:--:|", "--- | ---", … Its presence is what makes
// markdown-it treat the surrounding pipe lines as a table at all.
const TABLE_DELIMITER_LINE = /^\s*\|?\s*:?-+:?\s*(?:\|\s*:?-+:?\s*)*\|?\s*$/;
const TABLE_ROW_LINE = /^\s*\|.*\|\s*$/;

type MarkdownParserStorage = {
  markdown?: { parser?: { parse: (content: string, options?: { inline?: boolean }) => string } };
};

type Ancestor = { node: ProseMirrorNode; depth: number; before: number; after: number };

/** The nearest ancestor of `$pos` with one of the given node type names. */
function findAncestor($pos: ResolvedPos, typeNames: readonly string[]): Ancestor | null {
  for (let depth = $pos.depth; depth > 0; depth -= 1) {
    const node = $pos.node(depth);

    if (typeNames.includes(node.type.name)) {
      return { node, depth, before: $pos.before(depth), after: $pos.after(depth) };
    }
  }

  return null;
}

/**
 * Markdown → editor nodes, in *block* mode. tiptap-markdown's own
 * insertContentAt parses with `inline: true`, which is right for a plain
 * sentence but is exactly what flattens a proposed list or table into the
 * surrounding paragraph.
 */
function parseMarkdownBlocks(editor: Editor, markdown: string): Fragment | null {
  const parser = (editor.storage as MarkdownParserStorage).markdown?.parser;

  if (!parser) {
    return null;
  }

  try {
    const parsed = createNodeFromContent(parser.parse(markdown), editor.schema, {
      parseOptions: { preserveWhitespace: false }
    });
    const fragment = parsed instanceof Fragment ? parsed : Fragment.from(parsed);

    return fragment.childCount > 0 ? fragment : null;
  } catch {
    return null;
  }
}

function findNodeOfType(fragment: Fragment, typeName: string): ProseMirrorNode | null {
  for (let index = 0; index < fragment.childCount; index += 1) {
    const child = fragment.child(index);

    if (child.type.name === typeName) {
      return child;
    }
  }

  return null;
}

/** Cell text as it has to appear between pipes — a literal "|" would split it. */
function toCellMarkdown(cell: ProseMirrorNode): string {
  return cell.textContent.replace(/\|/g, "\\|").trim();
}

/**
 * Turns a bare row fragment into a parseable table by prefixing the target
 * table's own header and a delimiter row. Returns the rows to skip afterwards
 * (the synthesized header) alongside the completed Markdown. Null when the
 * proposal isn't row-shaped, or already carries its own header.
 */
export function completeTableRowMarkdown(
  markdown: string,
  headerCells: readonly string[]
): { markdown: string; skipRows: number } | null {
  const lines = markdown.split("\n").filter((line) => line.trim().length > 0);

  if (lines.length === 0 || !lines.every((line) => TABLE_ROW_LINE.test(line))) {
    return null;
  }

  // Already a complete table — parse it as it stands.
  if (lines.some((line) => TABLE_DELIMITER_LINE.test(line))) {
    return { markdown: lines.join("\n"), skipRows: 0 };
  }

  if (headerCells.length === 0) {
    return null;
  }

  const header = `| ${headerCells.join(" | ")} |`;
  const delimiter = `| ${headerCells.map(() => "---").join(" | ")} |`;

  return { markdown: [header, delimiter, ...lines].join("\n"), skipRows: 1 };
}

function completeTableMarkdown(
  markdown: string,
  table: ProseMirrorNode
): { markdown: string; skipRows: number } | null {
  const headerRow = table.firstChild;

  if (!headerRow) {
    return null;
  }

  const headerCells: string[] = [];
  headerRow.forEach((cell) => headerCells.push(toCellMarkdown(cell)));

  return completeTableRowMarkdown(markdown, headerCells);
}

/**
 * The proposal as Markdown that renders on its own — used for the preview
 * widget, which has no idea what the proposal targets. Only table rows need
 * this; every other construct is already self-contained.
 */
export function completeMarkdownForContext(editor: Editor, pos: number, markdown: string): string {
  if (editor.isDestroyed || !markdown.trim()) {
    return markdown;
  }

  try {
    const $from = editor.state.doc.resolve(Math.min(pos, editor.state.doc.content.size));
    const table = findAncestor($from, ["table"]);

    if (!table) {
      return markdown;
    }

    return completeTableMarkdown(markdown, table.node)?.markdown ?? markdown;
  } catch {
    return markdown;
  }
}

type InsertPlan = { from: number; to: number; content: Fragment | string };

/** Rows of the parsed table, re-typed as body cells and minus the synthetic head. */
function planTableInsert(
  editor: Editor,
  $from: ResolvedPos,
  $to: ResolvedPos,
  markdown: string
): InsertPlan | null {
  const table = findAncestor($from, ["table"]);
  const rowFrom = findAncestor($from, ["tableRow"]);
  const rowTo = findAncestor($to, ["tableRow"]);

  if (!table || !rowFrom || !rowTo) {
    return null;
  }

  const completed = completeTableMarkdown(markdown, table.node);

  if (!completed) {
    return null;
  }

  const parsedTable = findNodeOfType(parseMarkdownBlocks(editor, completed.markdown) ?? Fragment.empty, "table");

  if (!parsedTable || parsedTable.childCount <= completed.skipRows) {
    return null;
  }

  const rows: ProseMirrorNode[] = [];
  parsedTable.forEach((row, _offset, index) => {
    if (index >= completed.skipRows) {
      rows.push(row);
    }
  });

  return { from: rowFrom.before, to: Math.max(rowFrom.before, rowTo.after), content: Fragment.from(rows) };
}

/**
 * List items as *siblings* of the targeted item. When the proposal's list type
 * differs from the target's (a model answering a task list with plain "-"
 * bullets is the common case), the items are re-created in the target's type
 * so they stay part of the same list instead of opening a nested one.
 */
function planListInsert($from: ResolvedPos, $to: ResolvedPos, fragment: Fragment): InsertPlan | null {
  const list = fragment.firstChild;

  if (fragment.childCount !== 1 || !list || !LIST_TYPES.includes(list.type.name) || list.childCount === 0) {
    return null;
  }

  const itemFrom = findAncestor($from, LIST_ITEM_TYPES);
  const itemTo = findAncestor($to, LIST_ITEM_TYPES);

  if (!itemFrom || !itemTo) {
    return null;
  }

  const targetItemType = itemFrom.node.type;
  const items: ProseMirrorNode[] = [];

  try {
    list.forEach((item) => {
      items.push(
        item.type === targetItemType ? item : targetItemType.create(null, item.content, item.marks)
      );
    });
  } catch {
    // The proposed items don't fit the target list's item type — fall through
    // to the block-level plan, which replaces the whole item instead.
    return null;
  }

  return { from: itemFrom.before, to: Math.max(itemFrom.before, itemTo.after), content: Fragment.from(items) };
}

/**
 * Whole blocks instead of a text range — only when the range already covers its
 * blocks completely, so a proposal for a few words inside a sentence still gets
 * inserted inline.
 */
function planBlockInsert($from: ResolvedPos, $to: ResolvedPos, fragment: Fragment): InsertPlan | null {
  // A position *between* blocks — where an anchored insertion lands (see
  // insertAnchor.ts) — has no inline context to merge into, so the proposal
  // goes in as the blocks it describes. Without this the inline fallback would
  // flatten a multi-paragraph answer into a single paragraph.
  if ($from.depth === 0 && $to.depth === 0) {
    return { from: $from.pos, to: Math.max($from.pos, $to.pos), content: fragment };
  }

  const isSingleTextblock = fragment.childCount === 1 && fragment.child(0).isTextblock;

  if (isSingleTextblock || $from.depth === 0 || $to.depth === 0) {
    return null;
  }

  const coversWholeBlocks =
    $from.parentOffset === 0 && $to.parentOffset === $to.parent.content.size;

  if (!coversWholeBlocks) {
    return null;
  }

  const blockFrom = $from.before($from.depth);

  return { from: blockFrom, to: Math.max(blockFrom, $to.after($to.depth)), content: fragment };
}

/**
 * Replaces [from, to] with a Markdown proposal, widening the range and
 * completing the Markdown so table rows, list items and multi-block answers
 * land as the structure they describe. Falls back to tiptap-markdown's inline
 * insert for everything else — a rewritten phrase inside a sentence.
 */
export function insertMarkdownStructured(editor: Editor, from: number, to: number, markdown: string): void {
  if (editor.isDestroyed) {
    return;
  }

  const plan = planMarkdownInsert(editor, from, to, markdown);

  editor
    .chain()
    .focus()
    .insertContentAt({ from: plan.from, to: plan.to }, plan.content)
    .run();
}

function planMarkdownInsert(editor: Editor, from: number, to: number, markdown: string): InsertPlan {
  const inline: InsertPlan = { from, to, content: markdown };

  try {
    const doc = editor.state.doc;
    const $from = doc.resolve(Math.min(from, doc.content.size));
    const $to = doc.resolve(Math.min(Math.max(to, from), doc.content.size));

    const tablePlan = planTableInsert(editor, $from, $to, markdown);

    if (tablePlan) {
      return tablePlan;
    }

    const fragment = parseMarkdownBlocks(editor, markdown);

    if (!fragment) {
      return inline;
    }

    return planListInsert($from, $to, fragment) ?? planBlockInsert($from, $to, fragment) ?? inline;
  } catch {
    return inline;
  }
}
