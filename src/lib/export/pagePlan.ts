import type { ExportBlock, ExportListItem, InlineRun } from "./markdownModel";

// Where the pages of the PDF export (and the direct print) end, decided up
// front and then enforced, so the page lines in the editor are exact by
// construction instead of a prediction.
//
// The document is first laid out once on a single endless page (the "flow",
// read in pdfExport.ts), which gives the exact height of everything. From it
// planPages picks, page by page, the latest point where a page may end and
// still leave one line of room at the bottom (the safety zone: Chromium sets
// text a line longer or shorter than pdfmake now and then, and the print has
// to fit too). applyPagePlan then cuts the document at exactly those points
// (a paragraph at a word, a table before a row, a list before an item at any
// depth, a code block before a line) and puts a hard page break into each cut. The PDF is
// rendered from that, and so is the print; nothing is written into the note.

/** A block shorter than this many lines (or rows) is never split. */
export const SHORT_BLOCK_LINES = 4;

/** At least this many lines of a split paragraph stay on either page. */
export const MIN_LINES_AT_PAGE_EDGE = 2;

/** Where inside a block a planned page begins. */
export type InnerBreak =
  /** Before visual line `line` of `lines` in the flow layout; resolved to a word by applyPagePlan. */
  | { kind: "paragraphLine"; line: number; lines: number }
  /** At character `offset` of the paragraph's text (runs joined, a break counts as one character). */
  | { kind: "paragraph"; offset: number }
  | { kind: "tableRow"; row: number }
  | ({ kind: "listItem" } & ListCut)
  | { kind: "codeLine"; line: number };

/**
 * Before item `item` of a list, or, with `within`, inside that item: before
 * an item of the nested list that is the item's child block `child`. So a
 * list with few main points and many sub-points can break between the
 * sub-points, not only as a whole.
 */
export type ListCut = { item: number; within?: ListCut & { child: number } };

/** A point where a page may begin, measured in the flow layout. */
export type FlowCandidate = {
  /** Height in the flow where the new page's content would start. */
  y: number;
  blockIndex: number;
  /** null: before the block. */
  inner: InnerBreak | null;
  /** Height the new page needs on top when it starts here (a repeated table header, the margin of a split part). */
  topExtra: number;
  /** Height the page before needs below its content when it ends here (the margin of a split part). */
  tailExtra: number;
  /** A manual page break: the page must end here. */
  mandatory?: boolean;
};

export type FlowLayout = {
  candidates: FlowCandidate[];
  /** Height of the whole document in the flow. */
  end: number;
};

export type PlannedBreak = FlowCandidate & {
  /** Nothing fit on the page in front of it; pdfmake breaks inside that stretch by itself. */
  overflow?: boolean;
};

/**
 * Picks the page breaks: for every page the latest candidate whose content
 * fits `capacity` (the text area less the safety zone). A stretch that fits
 * nowhere (an unsplittable block taller than a page) ends at the first
 * candidate after it and is marked as overflow.
 */
export function planPages(flow: FlowLayout, capacity: number): PlannedBreak[] {
  const candidates = [...flow.candidates].filter((candidate) => candidate.y > 0).sort((a, b) => a.y - b.y);
  const breaks: PlannedBreak[] = [];
  let start = 0;
  let startExtra = 0;

  for (;;) {
    const limit = start + capacity - startExtra;
    let best: FlowCandidate | null = null;

    for (const candidate of candidates) {
      if (candidate.y <= start) {
        continue;
      }

      if (candidate.y + candidate.tailExtra > limit) {
        break;
      }

      best = candidate;

      if (candidate.mandatory) {
        break;
      }
    }

    if (best?.mandatory || (best && flow.end > limit)) {
      breaks.push(best);
      start = best.y;
      startExtra = best.topExtra;
      continue;
    }

    if (flow.end <= limit) {
      return breaks;
    }

    const next = candidates.find((candidate) => candidate.y > start);

    if (!next) {
      return breaks;
    }

    breaks.push({ ...next, overflow: true });
    start = next.y;
    startExtra = next.topExtra;
  }
}

// ---------------------------------------------------------------------------
// Cutting the document
// ---------------------------------------------------------------------------

/** Where a block of the planned document came from. */
export type PagedOrigin = {
  blockIndex: number;
  /** For the second and later parts of a split block: where the part begins. */
  part: Exclude<InnerBreak, { kind: "paragraphLine" }> | null;
};

export type PagedDocument = {
  blocks: ExportBlock[];
  /** One entry per block of `blocks`; page breaks point at the block they precede. */
  origins: PagedOrigin[];
};

const OBJECT_CHAR = "￼";

function runText(run: InlineRun): string {
  return run.kind === "text" ? run.text : run.kind === "break" ? "\n" : OBJECT_CHAR;
}

/** The paragraph's text as the offsets of a paragraph break count it. */
export function paragraphText(runs: InlineRun[]): string {
  return runs.map(runText).join("");
}

/**
 * The character where a paragraph laid out in `lines` lines should be cut so
 * the new page begins about at line `line`: the start of a word, estimated on
 * the safe side (earlier rather than later), so the first part never needs
 * more lines than were planned for it. -1 when there is no word to cut at.
 */
export function paragraphCutOffset(runs: InlineRun[], line: number, lines: number): number {
  const text = paragraphText(runs);
  const perLine = text.length / Math.max(1, lines);
  const estimate = Math.floor((line - 0.5) * perLine);

  for (let index = Math.min(estimate, text.length - 1); index > 0; index--) {
    if (/\s/.test(text[index - 1]) && !/\s/.test(text[index])) {
      return index;
    }
  }

  return -1;
}

/** Splits runs at a character offset, dropping the whitespace at the cut. */
export function splitRuns(runs: InlineRun[], offset: number): [InlineRun[], InlineRun[]] {
  const before: InlineRun[] = [];
  const after: InlineRun[] = [];
  let position = 0;

  for (const run of runs) {
    const length = runText(run).length;

    if (position + length <= offset) {
      before.push(run);
    } else if (position >= offset) {
      after.push(run);
    } else if (run.kind === "text") {
      before.push({ ...run, text: run.text.slice(0, offset - position) });
      after.push({ ...run, text: run.text.slice(offset - position) });
    } else {
      after.push(run);
    }

    position += length;
  }

  const trimEnd = (list: InlineRun[]) => {
    const last = list[list.length - 1];

    if (last?.kind === "text") {
      const text = last.text.replace(/\s+$/, "");
      list.splice(list.length - 1, 1, ...(text ? [{ ...last, text }] : []));
    }
  };
  const trimStart = (list: InlineRun[]) => {
    const first = list[0];

    if (first?.kind === "text") {
      const text = first.text.replace(/^\s+/, "");
      list.splice(0, 1, ...(text ? [{ ...first, text }] : []));
    }
  };

  trimEnd(before);
  trimStart(after);

  return [before, after];
}

type ResolvedInner = Exclude<InnerBreak, { kind: "paragraphLine" }>;

function resolveInner(block: ExportBlock, inner: InnerBreak): ResolvedInner | null {
  if (inner.kind !== "paragraphLine") {
    return inner;
  }

  if (block.kind !== "paragraph") {
    return null;
  }

  const offset = paragraphCutOffset(block.runs, inner.line, inner.lines);

  return offset > 0 ? { kind: "paragraph", offset } : null;
}

function splitBlock(block: ExportBlock, cuts: ResolvedInner[]): ExportBlock[] {
  switch (block.kind) {
    case "paragraph": {
      const parts: ExportBlock[] = [];
      let rest = block.runs;
      let consumed = 0;

      for (const cut of cuts) {
        if (cut.kind !== "paragraph") {
          continue;
        }

        const [before, after] = splitRuns(rest, cut.offset - consumed);
        consumed = cut.offset;
        rest = after;
        // Offsets refer to the whole paragraph; what is left starts at the cut.
        parts.push({ ...block, runs: before });
      }

      parts.push({ ...block, runs: rest });
      return parts;
    }
    case "table": {
      const header = block.rows[0]?.[0]?.header ? [block.rows[0]] : [];
      const rows = cuts.flatMap((cut) => (cut.kind === "tableRow" ? [cut.row] : []));
      const bounds = [0, ...rows, block.rows.length];
      const columnSource = block.columnSource ?? block.rows;

      return bounds.slice(0, -1).map((from, index) => ({
        ...block,
        // Every part but the first repeats the header, as pdfmake does
        // within one table, and all parts keep the whole table's columns.
        rows: [...(index > 0 ? header : []), ...block.rows.slice(from, bounds[index + 1])],
        columnSource
      }));
    }
    case "list": {
      const parts: ExportBlock[] = [];
      let rest: ListBlock = block;

      // From the last cut back: what is left in front of a cut is untouched,
      // so the indices of the earlier cuts still hold in it.
      for (const cut of [...cuts].reverse()) {
        if (cut.kind !== "listItem") {
          continue;
        }

        const [before, after] = splitList(rest, cut);
        parts.unshift(after);
        rest = before;
      }

      parts.unshift(rest);
      return parts;
    }
    case "codeBlock": {
      const lines = block.text.split("\n");
      const cutLines = cuts.flatMap((cut) => (cut.kind === "codeLine" ? [cut.line] : []));
      const bounds = [0, ...cutLines, lines.length];

      return bounds.slice(0, -1).map((from, index) => ({
        ...block,
        text: lines.slice(from, bounds[index + 1]).join("\n")
      }));
    }
    default:
      return [block];
  }
}

type ListBlock = Extract<ExportBlock, { kind: "list" }>;

/**
 * A list cut in two. Cut inside an item, the item's rest opens the second
 * part as a continuation: no bullet, number or checkbox of its own, since it
 * is still the same point (it keeps its number, so the next item's is right).
 */
function splitList(list: ListBlock, cut: ListCut): [ListBlock, ListBlock] {
  const item = list.items[cut.item];
  const nested = cut.within && item?.children[cut.within.child];

  if (!cut.within || !item || nested?.kind !== "list") {
    return [
      { ...list, items: list.items.slice(0, cut.item) },
      { ...list, start: list.start + cut.item, items: list.items.slice(cut.item) }
    ];
  }

  const { child } = cut.within;
  const [nestedBefore, nestedAfter] = splitList(nested, cut.within);
  const head: ExportListItem = { ...item, children: [...item.children.slice(0, child), nestedBefore] };
  const continuation: ExportListItem = {
    ...item,
    children: [nestedAfter, ...item.children.slice(child + 1)],
    continued: true
  };

  return [
    { ...list, items: [...list.items.slice(0, cut.item), head] },
    { ...list, start: list.start + cut.item, items: [continuation, ...list.items.slice(cut.item + 1)] }
  ];
}

/**
 * The document cut at the planned breaks, with a hard page break in every
 * cut, and where each resulting block came from. A manual break needs no
 * cut: its page break block is still in the document.
 */
export function applyPagePlan(blocks: ExportBlock[], breaks: PlannedBreak[]): PagedDocument {
  const beforeBlock = new Set<number>();
  const cutsByBlock = new Map<number, ResolvedInner[]>();

  for (const plannedBreak of breaks) {
    if (plannedBreak.mandatory) {
      continue;
    }

    if (!plannedBreak.inner) {
      beforeBlock.add(plannedBreak.blockIndex);
      continue;
    }

    const resolved = resolveInner(blocks[plannedBreak.blockIndex], plannedBreak.inner);

    if (resolved) {
      cutsByBlock.set(plannedBreak.blockIndex, [...(cutsByBlock.get(plannedBreak.blockIndex) ?? []), resolved]);
    } else {
      // No word to cut at: the page begins with the whole paragraph instead.
      beforeBlock.add(plannedBreak.blockIndex);
    }
  }

  const paged: ExportBlock[] = [];
  const origins: PagedOrigin[] = [];

  blocks.forEach((block, blockIndex) => {
    if (beforeBlock.has(blockIndex) && paged.length > 0 && paged[paged.length - 1].kind !== "pageBreak") {
      paged.push({ kind: "pageBreak" });
      origins.push({ blockIndex, part: null });
    }

    const cuts = cutsByBlock.get(blockIndex) ?? [];
    const parts = cuts.length > 0 ? splitBlock(block, cuts) : [block];

    parts.forEach((part, index) => {
      if (index > 0) {
        paged.push({ kind: "pageBreak" });
        origins.push({ blockIndex, part: cuts[index - 1] });
      }

      paged.push(part);
      origins.push({ blockIndex, part: index > 0 ? cuts[index - 1] : null });
    });
  });

  return { blocks: paged, origins };
}
