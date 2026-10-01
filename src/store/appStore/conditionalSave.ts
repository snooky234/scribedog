import i18n from "@/i18n";
import { readMarkdownFileVersion, writeMarkdownFileIfMatch } from "@/lib/fileSystem";
import { merge3 } from "@/lib/merge3";
import type { VersionedText } from "@/platform/types";

export type ConditionalSaveOutcome =
  | {
      kind: "written";
      /** What is on disk now: `ours`, or ours merged with someone else's write. */
      content: string;
      version: string;
      /** Someone else's changes were merged in, so the editor has to catch up. */
      merged: boolean;
    }
  | {
      kind: "conflict";
      theirs: VersionedText;
      conflicts: number;
      /** The merge with ours / theirs at every overlapping passage. */
      oursText: string;
      theirsText: string;
    };

export type ConditionalSaveOptions = {
  /** Keep ours over any version on disk; `onOverwrite` gets theirs first. */
  force?: boolean;
  onOverwrite?: (theirs: string) => Promise<void>;
};

/**
 * Enough for any honest race: each round only repeats because yet another
 * write landed between reading the other side's version and writing ours.
 */
const MAX_ATTEMPTS = 3;

/**
 * Writes a note that may have been changed by someone else since it was read.
 *
 * `base` is the text both sides started from, `expectedVersion` its version
 * token (null: the file did not exist; undefined: nobody recorded one, which
 * writes over whatever is there, as saves always did before versions).
 *
 * When the file moved on, the other side's write is merged in line by line:
 * changes at different places go through without asking, overlapping ones
 * come back as a conflict for the user. A file that disappeared meanwhile is
 * written again, since there is nothing left on disk to protect.
 */
export async function saveWithMerge(
  filePath: string,
  base: string,
  ours: string,
  expectedVersion: string | null | undefined,
  options: ConditionalSaveOptions = {}
): Promise<ConditionalSaveOutcome> {
  let currentBase = base;
  let content = ours;
  let expected = expectedVersion === undefined ? await readMarkdownFileVersion(filePath) : expectedVersion;
  let merged = false;

  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt += 1) {
    const result = await writeMarkdownFileIfMatch(filePath, content, expected);

    if (result.ok) {
      return { kind: "written", content, version: result.version, merged };
    }

    const theirs = result.current;

    if (theirs === null) {
      expected = null;
      continue;
    }

    if (options.force) {
      if (theirs.content !== content) {
        await options.onOverwrite?.(theirs.content);
      }

      expected = theirs.version;
      continue;
    }

    const merge = merge3(currentBase, content, theirs.content);

    if (!merge.clean) {
      return {
        kind: "conflict",
        theirs,
        conflicts: merge.conflicts,
        oursText: merge.oursText,
        theirsText: merge.theirsText
      };
    }

    // The merge already contains their write, so it is the base of whatever
    // lands next.
    merged = merged || merge.text !== content;
    currentBase = theirs.content;
    content = merge.text;
    expected = theirs.version;
  }

  throw new Error(i18n.t("store.fileSaveRaceError"));
}
