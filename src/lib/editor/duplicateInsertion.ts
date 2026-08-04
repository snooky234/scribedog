import type { Node as ProseMirrorNode } from "@tiptap/pm/model";

import { findTextRange } from "@/lib/editor/textSearch";

// Telling an insertion that is really a *revision* apart from one that adds.
//
// The distinction exists because of what the two tools do: replace_passage
// swaps a passage, while insert_at_cursor only ever adds. A model asked to work
// a revision into a document reaches for insert_at_cursor with after_text
// pointing at the very line it is rewriting — the call shape the anchor invites
// — and the document ends up with the old line and the new one under each
// other. In a poem or a list that reads as the app duplicating the user's work.
//
// Two answers here, for two situations:
//
//  - rewrittenAnchorRange: the insertion is anchored, and what it inserts is
//    the anchored passage rewritten. The intent is unambiguous, so the caller
//    turns it into a replacement of that passage instead of bouncing it back.
//    This is the case the bug actually took.
//  - isDuplicateInsertion: no anchor to reason from, and every line of the
//    insertion is already in the document. Nothing here can tell *what* it was
//    meant to replace, so this one refuses and names replace_passage.
//
// Rule 6 of AGENT_INSTRUCTION already tells the model not to duplicate, and the
// insert_at_cursor description repeats it. That was never going to be enough:
// the same class of mistake for images is enforced rather than prompted
// (duplicatedImageSources), and this is the text half of the same problem.

// Lines that carry no content of their own. Matching them against the document
// would say nothing — a "---" or a bare "#" occurs in most notes.
const STRUCTURAL_LINE = /^\s*(?:[-*_=]{3,}|#{1,6}|>|\d{1,9}[.)]|[-*+]|\|[\s|:-]*\|?)\s*$/;

// Below this, a line is too short for its presence in the document to mean
// anything: "Ja.", "Fazit", a single list marker with one word. Mirrors
// FUZZY_MIN_LENGTH in textSearch.ts, where the same reasoning applies to
// approximate matching.
const MIN_SIGNIFICANT_LINE_CHARS = 24;

/**
 * The range an anchored insertion is really rewriting, or null when it adds
 * something new.
 *
 * The test is one lookup: search the inserted text through the document
 * starting at the anchor. If it matches a range that begins inside the anchor
 * passage itself, then what is being "inserted after" the anchor *is* the
 * anchor — rewritten. The match is the tolerant one, so a line the model
 * re-emitted with a comma instead of a full stop, or a stanza with one word
 * changed, still resolves to the passage it replaces.
 *
 * A genuine insertion never trips this: text that adds something does not match
 * the passage it is placed after, and a repeated refrain matches somewhere
 * *later* in the document rather than at the anchor.
 *
 * The result is a proposal like any other — the user sees the old passage
 * tinted red with the new one under it and decides. That is the same safety net
 * replace_passage has always had, which is why resolving this in favour of a
 * replacement is safe even when the match is generous.
 */
export function rewrittenAnchorRange(
  doc: ProseMirrorNode,
  anchorRange: { from: number; to: number },
  markdown: string
): { from: number; to: number } | null {
  if (!markdown.trim()) {
    return null;
  }

  const match = findTextRange(doc, anchorRange.from, doc.content.size, markdown);

  if (!match) {
    return null;
  }

  // Has to *start* in the anchor: a match further down the document is the
  // model legitimately repeating a passage somewhere else.
  if (match.from < anchorRange.from || match.from >= Math.max(anchorRange.to, anchorRange.from + 1)) {
    return null;
  }

  return snapToPunctuation(doc, match);
}

// Punctuation a match may end just short of. The approximate pass in
// findTextRange aligns on the characters that *matched*, so a line re-emitted
// with a comma where the document has a full stop comes back one character
// short — and replacing that range would leave the old full stop stranded
// behind the new wording. Harmless for a lookup, wrong for a replacement.
const TRAILING_PUNCTUATION = ".,;:!?…\"'»”’)]}";
const LEADING_PUNCTUATION = "\"'«“‘([{";

/** One character of document text at `pos`, or "" past the end / at a boundary. */
function charAt(doc: ProseMirrorNode, pos: number): string {
  if (pos < 0 || pos >= doc.content.size) {
    return "";
  }

  // The separator makes a block boundary read as "\n" rather than as the first
  // character of the next block, so the walk stops there instead of running on.
  return doc.textBetween(pos, pos + 1, "\n");
}

/**
 * `String.includes("")` is true for every string, and charAt answers "" past
 * the end of the document — so the membership test has to require a character
 * first, or the walk below never terminates.
 */
function isOneOf(char: string, set: string): boolean {
  return char.length === 1 && set.includes(char);
}

function snapToPunctuation(
  doc: ProseMirrorNode,
  range: { from: number; to: number }
): { from: number; to: number } {
  let { from, to } = range;

  while (isOneOf(charAt(doc, to), TRAILING_PUNCTUATION)) {
    to += 1;
  }

  while (from > 0 && isOneOf(charAt(doc, from - 1), LEADING_PUNCTUATION)) {
    from -= 1;
  }

  return { from, to };
}

/**
 * Whether every line of a proposed insertion is already in the document.
 *
 * Line by line rather than as one blob, because that is what separates the two
 * cases that matter: a stanza the model re-emitted with one word changed has
 * every line in the document already (and belongs in replace_passage), while a
 * genuinely new stanza that happens to repeat a refrain line does not — one new
 * line is enough to let the insertion through.
 *
 * The lookup is findTextRange's tolerant one, so a line the model re-emitted
 * with a comma instead of a full stop still counts as present. That is the
 * common shape of this bug: the model "fixes" a line's punctuation and inserts
 * the fixed copy underneath the original.
 */
export function isDuplicateInsertion(doc: ProseMirrorNode, markdown: string): boolean {
  const lines = markdown
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !STRUCTURAL_LINE.test(line));

  if (lines.length === 0) {
    return false;
  }

  // A short insertion is left alone entirely: refusing "Ja." because the word
  // appears somewhere in the document would block ordinary work, and a line
  // that short cannot be the re-emitted passage this guard is about.
  if (lines.join(" ").length < MIN_SIGNIFICANT_LINE_CHARS) {
    return false;
  }

  return lines.every((line) => findTextRange(doc, 0, doc.content.size, line) !== null);
}
