/**
 * Word count and reading-time estimate for the open document, computed from its
 * markdown so the numbers update while typing (no editor instance needed).
 */

/** Common estimate for prose read on screen. */
const WORDS_PER_MINUTE = 200;

/**
 * CJK scripts write without spaces between words, so whitespace splitting would
 * count a whole sentence as one word. Every ideograph/kana counts as one word
 * instead — the usual approximation, and close enough for a reading time.
 */
const CJK_PATTERN = /[぀-ヿ㐀-䶿一-鿿豈-﫿ｦ-ﾟ]/gu;

/** A token only counts as a word if it carries at least one letter or digit. */
const WORD_PATTERN = /[\p{L}\p{N}]/u;

/**
 * Strips the markdown scaffolding so syntax is not counted as text: `##`, list
 * bullets and emphasis markers are not words, and code is not prose — a fenced
 * block would otherwise dominate both the count and the reading time.
 */
function toPlainText(markdown: string): string {
  return markdown
    .replace(/```[\s\S]*?(?:```|$)/g, " ")
    .replace(/`[^`\n]*`/g, " ")
    .replace(/!\[[^\]]*\]\([^)]*\)/g, " ")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/^\s{0,3}#{1,6}\s+/gm, " ")
    .replace(/^\s{0,3}>+\s?/gm, " ")
    .replace(/^\s*(?:[-*+]|\d+[.)])\s+(?:\[[ xX]\]\s+)?/gm, " ")
    .replace(/^\s*(?:[-*_]\s*){3,}$/gm, " ")
    .replace(/[*_~]+/g, " ")
    .replace(/\|/g, " ");
}

export function countWords(markdown: string): number {
  const text = toPlainText(markdown);
  const cjkCount = text.match(CJK_PATTERN)?.length ?? 0;

  const latinWords = text
    .replace(CJK_PATTERN, " ")
    .split(/\s+/)
    .filter((token) => WORD_PATTERN.test(token)).length;

  return cjkCount + latinWords;
}

/**
 * Characters of the same plain text the word count is taken from — including
 * the spaces between words, but with runs of whitespace collapsed so a blank
 * line does not read as extra content. Counts code points, so an emoji or an
 * accented letter is one character rather than two.
 */
export function countCharacters(markdown: string): number {
  return Array.from(toPlainText(markdown).replace(/\s+/g, " ").trim()).length;
}

/** Whole minutes, and never 0 for a document that does have words. */
export function estimateReadingMinutes(wordCount: number): number {
  if (wordCount === 0) {
    return 0;
  }

  return Math.max(1, Math.round(wordCount / WORDS_PER_MINUTE));
}
