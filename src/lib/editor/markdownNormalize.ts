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
