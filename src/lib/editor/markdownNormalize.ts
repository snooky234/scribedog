// AI-generated or otherwise re-serialized markdown occasionally escapes
// brackets as "\[ \]" instead of "[ ]". markdown-it-task-lists only recognizes
// the unescaped form and otherwise renders the brackets as plain text instead
// of a checkbox. The second step handles lines starting with "[ ]"/"\[ \]" and
// no list marker at all (e.g. stray duplicate lines) — without a list marker
// markdown-it-task-lists never recognizes a checkbox, so one is added here.
export function normalizeEscapedCheckboxes(markdown: string): string {
  const withUnescapedListItems = markdown.replace(
    /^(\s*(?:[-*+]|\d+[.)])\s+)\\\[([ xX]?)\\\]/gm,
    (_match, prefix: string, mark: string) => `${prefix}[${mark || " "}]`
  );

  return withUnescapedListItems.replace(
    /^(\s*)\\?\[([ xX]?)\\?\](?=\s)/gm,
    (_match, indent: string, mark: string) => `${indent}- [${mark || " "}]`
  );
}

/**
 * Undoes the double escaping some models apply to the text arguments of a tool
 * call: the content arrives as `Zeile eins\nZeile zwei` with a backslash and an
 * `n` where the line break belongs, and the note ends up showing those two
 * characters. JSON.parse cannot catch it — the payload is valid JSON, the model
 * escaped the string one time too many *inside* it.
 *
 * Only applied when several literal sequences outnumber the real line breaks.
 * That is the whole guard against wrecking legitimate text: a note documenting
 * `\n` in a code block has many real breaks and a handful of literals, while a
 * file the model escaped has almost none of the former and nothing but the
 * latter. A single literal is left alone either way — one `\n` in a sentence
 * about escape sequences is far likelier than a file that escaped exactly one
 * of its line breaks.
 */
export function decodeEscapedLineBreaks(text: string): string {
  const literalBreaks = text.match(/\\r\\n|\\n/g)?.length ?? 0;

  if (literalBreaks < 2) {
    return text;
  }

  const realBreaks = text.match(/\n/g)?.length ?? 0;

  if (realBreaks >= literalBreaks) {
    return text;
  }

  return text.replace(/\\r\\n/g, "\n").replace(/\\n/g, "\n").replace(/\\t/g, "\t");
}
