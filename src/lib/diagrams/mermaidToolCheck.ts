import { extractMermaidSources } from "./mermaidBlocks";

// The argument names under which the writing tools carry Markdown: write_file
// (content), edit_file/replace_passage/replace_selection (new_text),
// insert_at_cursor (text) and multi_edit (edits[].new_text).
const TEXT_KEYS = ["content", "new_text", "text"] as const;

export function collectWrittenMarkdown(args: Record<string, unknown>): string[] {
  const texts: string[] = [];

  for (const key of TEXT_KEYS) {
    if (typeof args[key] === "string") {
      texts.push(args[key]);
    }
  }

  if (Array.isArray(args.edits)) {
    for (const edit of args.edits) {
      if (edit && typeof edit === "object" && typeof (edit as Record<string, unknown>).new_text === "string") {
        texts.push((edit as Record<string, string>).new_text);
      }
    }
  }

  return texts;
}

type Validate = (source: string) => Promise<string | null>;

/**
 * A note to append to a successful tool result when a Mermaid diagram in the
 * written text does not parse, or null when there is nothing to say.
 *
 * The change is proposed anyway: refusing it would send a weak model into a
 * retry loop on the whole text, while a precise parser message lets it fix
 * the one line, and the user sees the same message under the block.
 */
export async function mermaidSyntaxNote(
  args: Record<string, unknown>,
  decode: (text: string) => string,
  validate: Validate
): Promise<string | null> {
  const sources = collectWrittenMarkdown(args).flatMap((text) => extractMermaidSources(decode(text)));

  if (sources.length === 0) {
    return null;
  }

  const problems: string[] = [];

  for (const [index, source] of sources.entries()) {
    const error = await validate(source);

    if (error) {
      problems.push(`Diagram ${index + 1} of ${sources.length}: ${error}`);
    }
  }

  if (problems.length === 0) {
    return null;
  }

  return (
    "Warning: the proposal contains a Mermaid diagram that does not parse and will show as an error " +
    "instead of a drawing.\n" +
    problems.join("\n") +
    "\nFix it by proposing the corrected diagram. Keep labels with spaces or punctuation in quotes " +
    '(A["Label (note)"]) and use only standard Mermaid syntax.'
  );
}

/**
 * A note naming every Mermaid diagram in a text the model is *reading* that
 * does not parse, or null when they all do (and null when there are none, which
 * costs nothing: extractMermaidSources finds no fence without loading Mermaid).
 *
 * The counterpart to mermaidSyntaxNote, and the reason it is not the same
 * function: that one judges text the model just wrote and tells it to fix its
 * own slip, while this one describes what the *user* is looking at. A diagram
 * typed by hand, imported, or left behind by an earlier session renders as a red
 * error box in the editor (see useMermaidDiagram in CodeBlockView) and that box
 * exists only in React state — no amount of reading the Markdown reveals it.
 * Without this note the model is the only participant in the conversation who
 * cannot see the error the user is asking about.
 */
export async function mermaidDiagnosticsNote(
  markdown: string,
  validate: Validate
): Promise<string | null> {
  const sources = extractMermaidSources(markdown);

  if (sources.length === 0) {
    return null;
  }

  const problems: string[] = [];

  for (const [index, source] of sources.entries()) {
    const error = await validate(source);

    if (error) {
      problems.push(`Diagram ${index + 1} of ${sources.length}: ${error}`);
    }
  }

  if (problems.length === 0) {
    return null;
  }

  return (
    "\n\n[Note: the text above contains a Mermaid diagram that does not parse. The user sees a red error " +
    "box in place of the drawing, which is NOT visible in the Markdown itself — this note is how you see " +
    "it.\n" +
    problems.join("\n") +
    "\nIf the user is asking about a broken diagram, this is it. Fix it by proposing the corrected " +
    'diagram. Keep labels with spaces or punctuation in quotes (A["Label (note)"]) and use only standard ' +
    "Mermaid syntax.]"
  );
}

type Repair = (source: string) => Promise<string | null>;

/**
 * Rewrites the ```mermaid blocks of a Markdown text through `repair`, and
 * reports how many blocks changed.
 *
 * Only closed fences are touched, for the same reason extractMermaidSources
 * skips open ones: an edit tool's new_text is often a fragment, and repairing
 * half a diagram would corrupt the other half.
 */
export async function repairMermaidBlocks(
  markdown: string,
  repair: Repair
): Promise<{ text: string; repaired: number }> {
  const sources = extractMermaidSources(markdown);

  if (sources.length === 0) {
    return { text: markdown, repaired: 0 };
  }

  let text = markdown;
  let repaired = 0;

  for (const source of sources) {
    const fixed = await repair(source);

    if (fixed !== null && fixed !== source) {
      // Replacing the block body rather than rebuilding the document keeps the
      // fence, its indentation and everything around it exactly as written.
      text = text.replace(source, fixed);
      repaired += 1;
    }
  }

  return { text, repaired };
}

/**
 * The same tool arguments with every Mermaid diagram in them repaired, or null
 * when nothing needed fixing.
 *
 * Mirrors collectWrittenMarkdown: the keys it reads are the keys this writes.
 */
export async function repairWrittenMermaid(
  args: Record<string, unknown>,
  repair: Repair
): Promise<{ args: Record<string, unknown>; repaired: number } | null> {
  const next = { ...args };
  let repaired = 0;

  for (const key of TEXT_KEYS) {
    const value = next[key];

    if (typeof value === "string") {
      const result = await repairMermaidBlocks(value, repair);

      if (result.repaired > 0) {
        next[key] = result.text;
        repaired += result.repaired;
      }
    }
  }

  if (Array.isArray(next.edits)) {
    const edits = [...next.edits];
    let changed = false;

    for (const [index, edit] of edits.entries()) {
      if (!edit || typeof edit !== "object") {
        continue;
      }

      const value = (edit as Record<string, unknown>).new_text;

      if (typeof value !== "string") {
        continue;
      }

      const result = await repairMermaidBlocks(value, repair);

      if (result.repaired > 0) {
        edits[index] = { ...(edit as object), new_text: result.text };
        repaired += result.repaired;
        changed = true;
      }
    }

    if (changed) {
      next.edits = edits;
    }
  }

  return repaired > 0 ? { args: next, repaired } : null;
}
