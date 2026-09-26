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
