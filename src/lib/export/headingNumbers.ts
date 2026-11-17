import {
  computeHeadingNumbers,
  findUnnumberedMarker,
  type HeadingNumberingSettings
} from "@/lib/editor/headingNumbers";

import type { ExportBlock, InlineRun } from "./markdownModel";

// Puts the automatic heading numbers into the shared block model, one step
// before any format renders it: the number becomes a plain text run at the
// front of the heading and the `{-}` marker leaves the title. Every exporter
// and the print path then carry the numbers without knowing the rules, and a
// document exports the way the editor showed it: with the scope on "outline"
// the numbers stay out of the export too, while the marker still leaves the
// title since it was understood as a marker, not as part of it.

type HeadingBlock = Extract<ExportBlock, { kind: "heading" }>;

function runsText(runs: InlineRun[]): string {
  return runs.map((run) => (run.kind === "text" ? run.text : "")).join("");
}

// Drops the text from `cut` onwards across the text runs, leaving inline
// nodes (an image, a break) where they are; the last kept text run loses its
// trailing whitespace so the title ends cleanly.
function cutRunsAt(runs: InlineRun[], cut: number): InlineRun[] {
  const kept: InlineRun[] = [];
  let offset = 0;

  for (const run of runs) {
    if (run.kind !== "text") {
      kept.push(run);
      continue;
    }

    const start = offset;
    offset += run.text.length;

    if (start >= cut) {
      continue;
    }

    kept.push(offset > cut ? { ...run, text: run.text.slice(0, cut - start) } : run);
  }

  for (let i = kept.length - 1; i >= 0; i -= 1) {
    const run = kept[i];

    if (run.kind === "text") {
      kept[i] = { ...run, text: run.text.replace(/\s+$/, "") };
      break;
    }
  }

  return kept;
}

function numberRun(number: string): InlineRun {
  return {
    kind: "text",
    text: `${number} `,
    bold: false,
    italic: false,
    underline: false,
    highlight: false,
    strike: false,
    code: false,
    link: null
  };
}

function collectHeadingBlocks(blocks: ExportBlock[], into: HeadingBlock[]): void {
  for (const block of blocks) {
    switch (block.kind) {
      case "heading":
        into.push(block);
        break;
      case "details":
      case "blockquote":
        collectHeadingBlocks(block.children, into);
        break;
      case "list":
        for (const item of block.items) {
          collectHeadingBlocks(item.children, into);
        }
        break;
      default:
        break;
    }
  }
}

function rewriteBlocks(blocks: ExportBlock[], replacements: Map<HeadingBlock, HeadingBlock>): ExportBlock[] {
  return blocks.map((block): ExportBlock => {
    switch (block.kind) {
      case "heading":
        return replacements.get(block) ?? block;
      case "details":
      case "blockquote":
        return { ...block, children: rewriteBlocks(block.children, replacements) };
      case "list":
        return {
          ...block,
          items: block.items.map((item) => ({ ...item, children: rewriteBlocks(item.children, replacements) }))
        };
      default:
        return block;
    }
  });
}

/**
 * The block list with heading numbers written in and the `{-}` / `{.unlisted}`
 * markers taken out. Headings are visited in document order across nested
 * blocks — the same walk collectHeadings does over the editor document, so
 * the export agrees with the editor. The numbers follow the setting; removing
 * the marker does not, since it is the editor's syntax either way and must
 * never be read as part of a title by whoever gets the PDF.
 */
export function numberExportBlocks(blocks: ExportBlock[], settings: HeadingNumberingSettings | undefined): ExportBlock[] {
  const headings: HeadingBlock[] = [];
  collectHeadingBlocks(blocks, headings);

  if (headings.length === 0) {
    return blocks;
  }

  const titles = headings.map((heading) => ({ level: heading.level, title: runsText(heading.runs).trim() }));
  const numbers =
    settings?.enabled && settings.scope === "everywhere" ? computeHeadingNumbers(titles, settings) : null;
  const replacements = new Map<HeadingBlock, HeadingBlock>();

  headings.forEach((heading, index) => {
    const markerStart = findUnnumberedMarker(runsText(heading.runs));
    let runs = markerStart === -1 ? heading.runs : cutRunsAt(heading.runs, markerStart);
    const number = numbers?.[index] ?? null;

    if (number !== null) {
      runs = [numberRun(number), ...runs];
    }

    if (runs !== heading.runs) {
      replacements.set(heading, { ...heading, runs });
    }
  });

  return replacements.size === 0 ? blocks : rewriteBlocks(blocks, replacements);
}

/**
 * Numbers several block lists as one document — a manuscript's chapters,
 * which EPUB renders separately but which share one sequence. Each list keeps
 * its block count, so the result splits back exactly where it was joined.
 */
export function numberExportBlockLists(
  lists: ExportBlock[][],
  settings: HeadingNumberingSettings | undefined
): ExportBlock[][] {
  const numbered = numberExportBlocks(lists.flat(), settings);
  let offset = 0;

  return lists.map((list) => {
    const slice = numbered.slice(offset, offset + list.length);
    offset += list.length;
    return slice;
  });
}
