/**
 * Line-based text diff over the raw markdown source, used by the version
 * diff dialog. Deliberately dependency-free: a Myers diff (O(ND)) is small
 * enough to own and gives the same line-granular result a code editor shows.
 */

export type DiffOpType = "equal" | "add" | "remove";

export type DiffOp = {
  type: DiffOpType;
  /** 0-based line number in the old text, null for added lines. */
  oldIndex: number | null;
  /** 0-based line number in the new text, null for removed lines. */
  newIndex: number | null;
  text: string;
};

/**
 * Myers builds a trace of one array per edit-script step, so pathological
 * inputs (two large, completely unrelated documents) would allocate O(D·N).
 * Beyond this many lines the diff degrades to "everything replaced", which
 * is still a truthful — just less granular — answer.
 */
const MAX_DIFF_LINES = 4000;

export function splitLines(text: string): string[] {
  if (text === "") {
    return [];
  }

  return text.replace(/\r\n/g, "\n").split("\n");
}

function replaceAllOp(
  oldLines: string[],
  newLines: string[],
  oldStart: number,
  newStart: number
): DiffOp[] {
  return [
    ...oldLines.map<DiffOp>((text, index) => ({
      type: "remove",
      oldIndex: oldStart + index,
      newIndex: null,
      text
    })),
    ...newLines.map<DiffOp>((text, index) => ({
      type: "add",
      oldIndex: null,
      newIndex: newStart + index,
      text
    }))
  ];
}

function backtrack(
  trace: Int32Array[],
  offset: number,
  oldLines: string[],
  newLines: string[],
  oldStart: number,
  newStart: number
): DiffOp[] {
  const reversedOps: DiffOp[] = [];
  let x = oldLines.length;
  let y = newLines.length;

  for (let depth = trace.length - 1; depth >= 0; depth -= 1) {
    const v = trace[depth];
    const k = x - y;
    const prevK =
      k === -depth || (k !== depth && v[offset + k - 1] < v[offset + k + 1]) ? k + 1 : k - 1;
    const prevX = v[offset + prevK];
    const prevY = prevX - prevK;

    while (x > prevX && y > prevY) {
      x -= 1;
      y -= 1;
      reversedOps.push({
        type: "equal",
        oldIndex: oldStart + x,
        newIndex: newStart + y,
        text: oldLines[x]
      });
    }

    if (depth === 0) {
      break;
    }

    if (x === prevX) {
      y -= 1;
      reversedOps.push({ type: "add", oldIndex: null, newIndex: newStart + y, text: newLines[y] });
    } else {
      x -= 1;
      reversedOps.push({ type: "remove", oldIndex: oldStart + x, newIndex: null, text: oldLines[x] });
    }

    x = prevX;
    y = prevY;
  }

  return reversedOps.reverse();
}

function myersDiff(
  oldLines: string[],
  newLines: string[],
  oldStart: number,
  newStart: number
): DiffOp[] {
  const n = oldLines.length;
  const m = newLines.length;

  if (n === 0 || m === 0) {
    return replaceAllOp(oldLines, newLines, oldStart, newStart);
  }

  const max = n + m;
  const offset = max;
  const v = new Int32Array(2 * max + 1);
  const trace: Int32Array[] = [];

  for (let d = 0; d <= max; d += 1) {
    trace.push(v.slice());

    for (let k = -d; k <= d; k += 2) {
      let x =
        k === -d || (k !== d && v[offset + k - 1] < v[offset + k + 1])
          ? v[offset + k + 1]
          : v[offset + k - 1] + 1;
      let y = x - k;

      while (x < n && y < m && oldLines[x] === newLines[y]) {
        x += 1;
        y += 1;
      }

      v[offset + k] = x;

      if (x >= n && y >= m) {
        return backtrack(trace, offset, oldLines, newLines, oldStart, newStart);
      }
    }
  }

  return replaceAllOp(oldLines, newLines, oldStart, newStart);
}

/**
 * Diffs two markdown documents line by line. Common head and tail are peeled
 * off first — for the typical "one paragraph changed" case that leaves Myers
 * with a handful of lines to work on.
 */
export function diffLines(oldText: string, newText: string): DiffOp[] {
  const oldLines = splitLines(oldText);
  const newLines = splitLines(newText);

  let prefixLength = 0;

  while (
    prefixLength < oldLines.length &&
    prefixLength < newLines.length &&
    oldLines[prefixLength] === newLines[prefixLength]
  ) {
    prefixLength += 1;
  }

  let suffixLength = 0;

  while (
    suffixLength < oldLines.length - prefixLength &&
    suffixLength < newLines.length - prefixLength &&
    oldLines[oldLines.length - 1 - suffixLength] === newLines[newLines.length - 1 - suffixLength]
  ) {
    suffixLength += 1;
  }

  const oldMiddle = oldLines.slice(prefixLength, oldLines.length - suffixLength);
  const newMiddle = newLines.slice(prefixLength, newLines.length - suffixLength);

  const middleOps =
    oldMiddle.length + newMiddle.length > MAX_DIFF_LINES
      ? replaceAllOp(oldMiddle, newMiddle, prefixLength, prefixLength)
      : myersDiff(oldMiddle, newMiddle, prefixLength, prefixLength);

  const prefixOps = oldLines.slice(0, prefixLength).map<DiffOp>((text, index) => ({
    type: "equal",
    oldIndex: index,
    newIndex: index,
    text
  }));

  const suffixOps = oldLines.slice(oldLines.length - suffixLength).map<DiffOp>((text, index) => ({
    type: "equal",
    oldIndex: oldLines.length - suffixLength + index,
    newIndex: newLines.length - suffixLength + index,
    text
  }));

  return [...prefixOps, ...middleOps, ...suffixOps];
}

export function hasChanges(ops: DiffOp[]): boolean {
  return ops.some((op) => op.type !== "equal");
}

export type DiffHunk = {
  /** Number of unchanged lines skipped between the previous hunk and this one. */
  skippedLines: number;
  ops: DiffOp[];
};

/**
 * Groups the flat op list into hunks of changed lines plus `contextLines` of
 * surrounding context; everything in between is reported as a skip count so
 * the dialog can collapse it.
 */
export function buildDiffHunks(ops: DiffOp[], contextLines = 3): DiffHunk[] {
  const keep = new Array<boolean>(ops.length).fill(false);
  let hasAnyChange = false;

  ops.forEach((op, index) => {
    if (op.type === "equal") {
      return;
    }

    hasAnyChange = true;

    for (
      let neighbor = Math.max(0, index - contextLines);
      neighbor <= Math.min(ops.length - 1, index + contextLines);
      neighbor += 1
    ) {
      keep[neighbor] = true;
    }
  });

  if (!hasAnyChange) {
    return [];
  }

  const hunks: DiffHunk[] = [];
  let isInsideHunk = false;
  let skipped = 0;

  for (let index = 0; index < ops.length; index += 1) {
    if (!keep[index]) {
      skipped += 1;
      isInsideHunk = false;
      continue;
    }

    if (!isInsideHunk) {
      hunks.push({ skippedLines: skipped, ops: [] });
      isInsideHunk = true;
      skipped = 0;
    }

    hunks[hunks.length - 1].ops.push(ops[index]);
  }

  return hunks;
}

export type SideBySideRow = {
  type: DiffOpType | "replace";
  left: { lineNumber: number; text: string } | null;
  right: { lineNumber: number; text: string } | null;
};

/**
 * Turns a hunk's ops into split-pane rows: a run of removed lines is paired
 * up with the run of added lines that follows it, so a rewritten paragraph
 * lines up left-to-right instead of stacking.
 */
export function toSideBySideRows(ops: DiffOp[]): SideBySideRow[] {
  const rows: SideBySideRow[] = [];
  let index = 0;

  while (index < ops.length) {
    const op = ops[index];

    if (op.type === "equal") {
      rows.push({
        type: "equal",
        left: { lineNumber: (op.oldIndex ?? 0) + 1, text: op.text },
        right: { lineNumber: (op.newIndex ?? 0) + 1, text: op.text }
      });
      index += 1;
      continue;
    }

    const removed: DiffOp[] = [];
    const added: DiffOp[] = [];

    while (index < ops.length && ops[index].type === "remove") {
      removed.push(ops[index]);
      index += 1;
    }

    while (index < ops.length && ops[index].type === "add") {
      added.push(ops[index]);
      index += 1;
    }

    const pairCount = Math.max(removed.length, added.length);

    for (let pair = 0; pair < pairCount; pair += 1) {
      const removedOp = removed[pair];
      const addedOp = added[pair];

      rows.push({
        type: removedOp && addedOp ? "replace" : removedOp ? "remove" : "add",
        left: removedOp ? { lineNumber: (removedOp.oldIndex ?? 0) + 1, text: removedOp.text } : null,
        right: addedOp ? { lineNumber: (addedOp.newIndex ?? 0) + 1, text: addedOp.text } : null
      });
    }
  }

  return rows;
}

export function countDiffStats(ops: DiffOp[]): { added: number; removed: number } {
  let added = 0;
  let removed = 0;

  for (const op of ops) {
    if (op.type === "add") {
      added += 1;
    } else if (op.type === "remove") {
      removed += 1;
    }
  }

  return { added, removed };
}
