// Pure helpers around ```mermaid fences. The diagram itself is stored as an
// ordinary fenced code block, so a note stays plain Markdown that GitHub,
// GitLab or Obsidian render the same way.

export const MERMAID_LANGUAGE = "mermaid";

export function isMermaidLanguage(language: string | null | undefined): boolean {
  return (language ?? "").trim().toLowerCase() === MERMAID_LANGUAGE;
}

const FENCE_OPEN = /^( {0,3})(`{3,}|~{3,})[ \t]*([^\s`]*)[^\n`]*$/;

/**
 * Every *closed* ```mermaid fence in a Markdown text, in document order.
 *
 * An unclosed fence is skipped on purpose: an edit tool's new_text is often a
 * fragment of a larger block, and judging half a diagram would only produce a
 * false syntax warning.
 */
export function extractMermaidSources(markdown: string): string[] {
  const lines = markdown.replace(/\r\n?/g, "\n").split("\n");
  const sources: string[] = [];
  let index = 0;

  while (index < lines.length) {
    const open = FENCE_OPEN.exec(lines[index]);

    if (!open) {
      index += 1;
      continue;
    }

    const fence = open[2];
    const closing = new RegExp(`^ {0,3}${fence[0] === "`" ? "`" : "~"}{${fence.length},}[ \\t]*$`);
    let end = index + 1;

    while (end < lines.length && !closing.test(lines[end])) {
      end += 1;
    }

    if (end >= lines.length) {
      break;
    }

    if (isMermaidLanguage(open[3])) {
      sources.push(lines.slice(index + 1, end).join("\n"));
    }

    index = end + 1;
  }

  return sources;
}
