import type { ExportImageMap } from "./imageAssets";
import type { ExportBlock, InlineRun } from "./markdownModel";
import { SHORT_BLOCK_LINES } from "./pagePlan";

// Blocks that a page must not split, decided from the document alone: the
// page plan (pagePlan.ts) never cuts inside them, and the PDF and the print
// mark them unbreakable as well.

/** A paragraph that holds nothing but images (that could be loaded). */
export function isImageOnlyParagraph(runs: InlineRun[], images: ExportImageMap): boolean {
  return runs.length > 0 && runs.every((run) => run.kind === "image" && images.has(run.src));
}

/**
 * Markdown has no caption. The convention ScribeDog reads as one: a
 * paragraph written entirely in italics, directly under a paragraph that
 * holds only an image, e.g. `*Figure 1: The harbour at dawn*`.
 */
export function isImageCaption(block: ExportBlock | undefined): boolean {
  if (!block || block.kind !== "paragraph") {
    return false;
  }

  const texts = block.runs.filter((run) => run.kind === "text");

  return (
    texts.length > 0 &&
    block.runs.every((run) => run.kind === "text") &&
    texts.some((run) => run.kind === "text" && run.text.trim() !== "") &&
    texts.every((run) => run.kind === "text" && (run.italic || run.text.trim() === ""))
  );
}

/** The caption that belongs to the image paragraph at `index`, if there is one. */
export function captionAfter(blocks: ExportBlock[], index: number, images: ExportImageMap): ExportBlock | null {
  const block = blocks[index];
  const next = blocks[index + 1];

  return block?.kind === "paragraph" && isImageOnlyParagraph(block.runs, images) && isImageCaption(next)
    ? (next ?? null)
    : null;
}

/** A code block or table too short to be worth splitting across pages. */
export function isShortBlock(block: ExportBlock): boolean {
  if (block.kind === "codeBlock") {
    return block.text.split("\n").length < SHORT_BLOCK_LINES;
  }

  if (block.kind === "table") {
    return block.rows.length < SHORT_BLOCK_LINES;
  }

  return false;
}
