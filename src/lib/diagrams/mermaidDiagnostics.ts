// The read-side half of the Mermaid checks, kept out of mermaidToolCheck.ts so
// that module stays pure and testable: this one is the wiring that pulls in the
// renderer, which only exists in a browser.

import { lineFixHint, repairMermaid } from "./mermaidRepair";
import { mermaidDiagnosticsNote, repairWrittenMermaid } from "./mermaidToolCheck";

/**
 * Validates through the real Mermaid parser, loaded on demand.
 *
 * Mermaid plus its grammars weigh several megabytes, so the import must stay
 * behind the fence check in mermaidDiagnosticsNote: a note without a ```mermaid
 * block returns before this is ever called, which is what keeps the cost on the
 * documents that actually carry diagrams.
 */
async function validate(source: string): Promise<string | null> {
  const { validateMermaid } = await import("@/lib/diagrams/mermaidRenderer");
  return validateMermaid(source);
}

/**
 * The diagnostics note for a text the model is about to read, or "" when there
 * is nothing to report.
 *
 * Returns "" rather than null so callers can append it unconditionally, and
 * swallows its own failures: a diagnostic that breaks get_document would turn a
 * cosmetic problem into a broken agent.
 */
export function mermaidNoteFor(markdown: string): Promise<string> {
  return mermaidDiagnosticsNote(markdown, validate)
    .then((note) => note ?? "")
    .catch(() => "");
}

/**
 * Tool arguments with every broken Mermaid diagram in them silently repaired,
 * plus how many were fixed.
 *
 * This runs *before* the tool, so the corrected diagram is what gets written.
 * Fixing it for the model rather than asking it to fix the text is deliberate:
 * the rule ("quote labels with punctuation") has been in the system prompt all
 * along and a small model still answered the parser with "this suggests a
 * limitation in the rendering engine". The repair is verified by re-parsing, so
 * it either produces a diagram Mermaid accepts or changes nothing at all.
 */
export function repairMermaidArgs(
  args: Record<string, unknown>
): Promise<{ args: Record<string, unknown>; repaired: number } | null> {
  return repairWrittenMermaid(args, (source) => repairMermaid(source, validate)).catch(() => null);
}

/**
 * Mermaid's message for a diagram, followed by the concrete line to change.
 *
 * The fallback for what repairMermaidArgs could not fix by itself. The parser's
 * own message points at a column and lists grammar token names ("Expecting
 * 'SQE', 'DOUBLECIRCLEEND', 'PE', ..."), which is what a small model reads as a
 * broken renderer rather than as its own typo; a finished replacement line is
 * something it can copy without understanding the grammar.
 */
export function explainMermaidError(source: string, message: string): string {
  return message + lineFixHint(source, message);
}
