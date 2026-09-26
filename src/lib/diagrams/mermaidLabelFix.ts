// Repairing the one mistake that breaks almost every model-written flowchart:
// a node label with parentheses, brackets or a pipe that was not put in quotes.
//
// Measured against Mermaid's own parser rather than guessed (see
// mermaidLabelFix.test.ts): A[Backen (45-55 Min.)] is a parse error in every
// node shape, and wrapping the label in double quotes fixes it in every one of
// them. The only label quotes cannot save is one that already contains a double
// quote, which is why that case is left alone below.
//
// This exists because telling a small model the rule does not work. The system
// prompt has carried "put labels with punctuation in double quotes" all along,
// and gemma-4-E4B still answered the parser's message with "this suggests a
// limitation in the rendering engine, rather than a syntax error on my part"
// and offered a plain list instead. A rule it cannot apply and a finished
// replacement it only has to copy are very different asks.

// The delimiters of every flowchart node shape, longest first so that [[ wins
// over [ and the label of A[[x]] is not read as "[x".
const NODE_SHAPES: readonly [string, string][] = [
  ["[[", "]]"],
  ["[(", ")]"],
  ["([", "])"],
  ["((", "))"],
  ["{{", "}}"],
  [">", "]"],
  ["[", "]"],
  ["(", ")"],
  ["{", "}"]
];

// A label Mermaid's grammar cannot read bare. Quotes, brackets and the pipe end
// a token early; @ starts the newer shape-and-metadata syntax.
const NEEDS_QUOTES = /[()[\]{}|@]/;

/** Is this label already wrapped in its own pair of double quotes? */
function isQuoted(label: string): boolean {
  const trimmed = label.trim();
  return trimmed.length >= 2 && trimmed.startsWith('"') && trimmed.endsWith('"');
}

/**
 * Whether wrapping this label in quotes is safe and worth doing.
 *
 * A label that already carries a double quote is refused: Mermaid has no escape
 * for one, so quoting it trades one parse error for another (measured). Leaving
 * it to the model is the honest outcome there.
 */
function shouldQuote(label: string): boolean {
  if (!label.trim() || isQuoted(label) || label.includes('"')) {
    return false;
  }

  return NEEDS_QUOTES.test(label);
}

// What separates two nodes on one line: an edge, in any of Mermaid's spellings.
// The label search stops here, so the second node of A[x (1)] --> B[y (2)] is
// not swallowed into the first one's label.
const EDGE = /-->|---|-\.-|==>|===|--[ox]|<--|~~~/;

/**
 * The index just past the node label that starts at `open`, or -1.
 *
 * Scans to the *last* closer before the next edge rather than the first one,
 * because the label we are here for contains brackets itself: in
 * A[Backen (45-55 Min.)] the first ")" is part of the text and only the final
 * "]" ends the node. Bounding the search at the edge is what keeps a line with
 * two broken nodes from collapsing into a single label.
 */
function findLabelEnd(line: string, start: number, close: string): number {
  const edge = EDGE.exec(line.slice(start));
  const limit = edge ? start + edge.index : line.length;
  const end = line.lastIndexOf(close, limit);

  return end > start ? end : -1;
}

/**
 * The same line with every unquoted node and edge label wrapped in quotes.
 *
 * Deliberately textual rather than a parse: the input is by definition a text
 * Mermaid just refused to parse, so there is no tree to walk.
 */
function quoteLabelsInLine(line: string): string {
  let result = "";
  let index = 0;

  while (index < line.length) {
    // An edge label, |like this|, which breaks on the same characters.
    if (line[index] === "|") {
      const end = line.indexOf("|", index + 1);

      if (end > index) {
        const label = line.slice(index + 1, end);
        result += shouldQuote(label) ? `|"${label}"|` : line.slice(index, end + 1);
        index = end + 1;
        continue;
      }
    }

    const shape = NODE_SHAPES.find((entry) => line.startsWith(entry[0], index));

    // A shape opener only starts a node when an identifier precedes it;
    // otherwise "(" is just a parenthesis in prose (a title, a comment).
    if (shape && /[\wÀ-￿]/.test(result.slice(-1))) {
      const [open, close] = shape;
      const end = findLabelEnd(line, index + open.length, close);

      if (end > 0) {
        const label = line.slice(index + open.length, end);

        if (shouldQuote(label)) {
          result += `${open}"${label}"${close}`;
          index = end + close.length;
          continue;
        }
      }
    }

    result += line[index];
    index += 1;
  }

  return result;
}

/**
 * The diagram with unquoted labels quoted, or null when nothing changed.
 *
 * Never used on its own: the caller re-parses the result and keeps it only if
 * it turned a broken diagram into a valid one (see repairMermaid). That check
 * is what makes a textual transformation safe to apply to a model's output.
 */
export function quoteMermaidLabels(source: string): string | null {
  const lines = source.split("\n");
  const fixed = lines.map((line) => (line.trim().startsWith("%%") ? line : quoteLabelsInLine(line)));
  const result = fixed.join("\n");

  return result === source ? null : result;
}

/** How a label should be written, for a message that tells a model what to change. */
export function suggestedLineFix(source: string, line: number): { before: string; after: string } | null {
  const lines = source.split("\n");
  const before = lines[line - 1];

  if (before === undefined) {
    return null;
  }

  const after = quoteLabelsInLine(before);
  return after === before ? null : { before: before.trim(), after: after.trim() };
}
