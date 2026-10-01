import { diff3Merge } from "node-diff3";

/**
 * Three-way merge of a note, for a save that found someone else's version on
 * disk: `base` is the text both sides started from, `ours` what this editor
 * holds, `theirs` what is on disk now.
 *
 * Line by line, which is the unit Markdown is written in: a paragraph, a list
 * item, a table row. Two edits in different paragraphs merge silently; two
 * edits to the same line, or to lines directly next to each other, are a
 * conflict, as in git. Both sides making the very same change is not.
 */
export type MergeChunk =
  | { kind: "ok"; lines: string[] }
  | { kind: "conflict"; base: string[]; ours: string[]; theirs: string[] };

export type Merge3Result =
  | { clean: true; text: string }
  | {
      clean: false;
      /** Number of overlapping passages. */
      conflicts: number;
      chunks: MergeChunk[];
      /** The merge with this side's version at every conflict. */
      oursText: string;
      theirsText: string;
    };

const LINE_SEPARATOR = "\n";

function joinChunks(chunks: MergeChunk[], side: "ours" | "theirs"): string {
  const lines: string[] = [];

  for (const chunk of chunks) {
    lines.push(...(chunk.kind === "ok" ? chunk.lines : chunk[side]));
  }

  return lines.join(LINE_SEPARATOR);
}

export function merge3(base: string, ours: string, theirs: string): Merge3Result {
  // The cheap cases first; they are also the common ones (a save that only
  // lost a race against an identical write, or one side unchanged).
  if (ours === theirs || theirs === base) {
    return { clean: true, text: ours };
  }

  if (ours === base) {
    return { clean: true, text: theirs };
  }

  const regions = diff3Merge(
    ours.split(LINE_SEPARATOR),
    base.split(LINE_SEPARATOR),
    theirs.split(LINE_SEPARATOR),
    { excludeFalseConflicts: true }
  );

  const chunks: MergeChunk[] = regions.map((region) =>
    region.conflict
      ? { kind: "conflict", base: region.conflict.o, ours: region.conflict.a, theirs: region.conflict.b }
      : { kind: "ok", lines: region.ok ?? [] }
  );
  const conflicts = chunks.filter((chunk) => chunk.kind === "conflict").length;

  if (conflicts === 0) {
    return { clean: true, text: joinChunks(chunks, "ours") };
  }

  return {
    clean: false,
    conflicts,
    chunks,
    oursText: joinChunks(chunks, "ours"),
    theirsText: joinChunks(chunks, "theirs")
  };
}
