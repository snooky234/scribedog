import type { Node as ProseMirrorNode } from "@tiptap/pm/model";

import { buildDiffHunks, diffLines } from "@/lib/textDiff";
import { findTextRange } from "@/lib/editor/textSearch";

/**
 * Turns a staged file change into the same red/green review the chat agent
 * produces for the open document (see src/lib/aiSuggestionWidget.ts).
 *
 * The staged entry describes a whole file, not a passage — so the diff is cut
 * into hunks and each hunk is located in the document by its text. One context
 * line per side is what makes a pure insertion locatable at all: without it a
 * hunk that only adds lines has nothing to anchor to.
 *
 * Hunks that cannot be found (the file changed outside the app since the agent
 * read it) are counted rather than guessed at — the bar says how many were
 * skipped, which is the honest answer.
 */
export type StagedPreviewSuggestion = { from: number; to: number; replacement: string };

export type StagedPreviewResult = {
  suggestions: StagedPreviewSuggestion[];
  /** Hunks whose original text is no longer in the document. */
  missing: number;
};

function hunkText(ops: { type: string; text: string }[], side: "old" | "new"): string {
  return ops
    .filter((op) => op.type === "equal" || (side === "old" ? op.type === "remove" : op.type === "add"))
    .map((op) => op.text)
    .join("\n");
}

export function buildStagedPreview(
  doc: ProseMirrorNode,
  baseContent: string,
  content: string
): StagedPreviewResult {
  // A file the agent proposes into existence has no "before": nothing to tint
  // red, the whole document is one green block.
  //
  // A collapsed position *inside* the first block, not the range 0…size that
  // spans the empty paragraph: an inline decoration reaching across a block's
  // boundaries is dropped by prosemirror-view, and the review then renders
  // nothing at all. This is the same position insert_at_cursor lands on in an
  // empty note, which is the path that has always worked.
  if (!baseContent.trim()) {
    const insertAt = Math.min(1, doc.content.size);

    return {
      suggestions: content.trim() ? [{ from: insertAt, to: insertAt, replacement: content }] : [],
      missing: 0
    };
  }

  const hunks = buildDiffHunks(diffLines(baseContent, content), 1);
  const suggestions: StagedPreviewSuggestion[] = [];
  let missing = 0;
  // Each hunk is searched only after the previous one's end, so a repeated
  // passage cannot pull two hunks onto the same spot.
  let searchFrom = 0;

  for (const hunk of hunks) {
    const oldText = hunkText(hunk.ops, "old");
    const newText = hunkText(hunk.ops, "new");

    if (oldText === newText) {
      continue;
    }

    const found = oldText.trim()
      ? findTextRange(doc, searchFrom, doc.content.size, oldText)
      : null;

    if (!found) {
      missing += 1;
      continue;
    }

    searchFrom = found.to;
    suggestions.push({ from: found.from, to: found.to, replacement: newText });
  }

  return { suggestions, missing };
}
