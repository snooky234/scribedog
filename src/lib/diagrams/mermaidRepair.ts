// Turning the label fix into something safe to apply: quote, re-parse, and keep
// the result only when it actually made the diagram valid.

import { quoteMermaidLabels, suggestedLineFix } from "./mermaidLabelFix";

type Validate = (source: string) => Promise<string | null>;

/** The line number in Mermaid's "Parse error on line 8:" message, or null. */
export function parseErrorLine(message: string): number | null {
  const match = /Parse error on line (\d+)/.exec(message);
  return match ? Number(match[1]) : null;
}

/**
 * A repaired version of a diagram that does not parse, or null.
 *
 * The re-parse is the whole safety argument. quoteMermaidLabels is a textual
 * transformation over input that is by definition malformed, so it can be
 * wrong; this function only ever hands back a source Mermaid itself accepts,
 * and only when the original was rejected. A diagram that was already valid is
 * never touched, so nothing can be "fixed" into a different drawing.
 */
export async function repairMermaid(source: string, validate: Validate): Promise<string | null> {
  if ((await validate(source)) === null) {
    return null;
  }

  const candidate = quoteMermaidLabels(source);

  if (candidate === null) {
    return null;
  }

  return (await validate(candidate)) === null ? candidate : null;
}

/**
 * The "change this line into that one" hint for a diagram we could not repair
 * outright, or "" when we have nothing concrete to offer.
 *
 * The fallback for what repairMermaid refuses. A model that cannot derive the
 * fix from `Expecting 'SQE', 'DOUBLECIRCLEEND', 'PE', ...` can still copy a
 * finished line, which is the difference between a correction and a retry loop.
 */
export function lineFixHint(source: string, errorMessage: string): string {
  const line = parseErrorLine(errorMessage);
  const fix = line === null ? null : suggestedLineFix(source, line);

  if (!fix) {
    return "";
  }

  return `\nReplace this line:\n  ${fix.before}\nwith:\n  ${fix.after}`;
}
