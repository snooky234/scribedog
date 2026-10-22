import type MarkdownIt from "markdown-it";

import { splitTrailingReminder, type Reminder } from "./reminderMarker";

// markdown-it/@types/markdown-it don't export the Token type from the package
// root, so it's derived from a signature that uses it.
type MarkdownItToken = Parameters<MarkdownIt["renderer"]["renderToken"]>[0][number];
type CoreState = { tokens: MarkdownItToken[] };

/** The attribute the editor's paragraph and heading read their reminder from. */
export const REMINDER_DATA_ATTRIBUTE = "data-reminder";

const BLOCK_OPEN_TYPES = new Set(["paragraph_open", "heading_open"]);
const LIST_OPEN_TYPES = new Set(["bullet_list_open", "ordered_list_open"]);

/** The reminder the rule below attached to a paragraph_open/heading_open token. */
export function getTokenReminder(token: MarkdownItToken): Reminder | null {
  return (token.meta as { reminder?: Reminder } | null)?.reminder ?? null;
}

/**
 * Takes the marker off every paragraph and heading that ends in one, before
 * the inline parser sees the text. Runs before "inline" rather than on the
 * parsed children: the marker's note may contain characters ("*", "_", "[")
 * that the inline rules would otherwise turn into marks across the comment.
 * With `html: false` the comment would otherwise stay visible text. Table cells
 * are not blocks of their own in markdown-it and keep their text as it is.
 */
function stripReminders(state: CoreState, onFound: (tokens: MarkdownItToken[], index: number) => void): void {
  const { tokens } = state;

  for (let i = 1; i < tokens.length; i++) {
    const inline = tokens[i];
    const open = tokens[i - 1];

    if (inline.type !== "inline" || !BLOCK_OPEN_TYPES.has(open.type)) {
      continue;
    }

    const { text, reminder } = splitTrailingReminder(inline.content);

    if (!reminder) {
      continue;
    }

    inline.content = text;
    open.meta = { ...(open.meta ?? {}), reminder };
    onFound(tokens, i - 1);
  }
}

/**
 * Editor variant: the reminder goes onto the rendered <p>/<h*> as an
 * attribute the node's parseHTML reads. A paragraph of a tight list is
 * hidden (the item renders as "<li>text</li>") and would lose the attribute,
 * so it is rendered after all; the list then says it is tight itself, since
 * tiptap-markdown otherwise takes a <p> inside it for a loose list and writes
 * a blank line between the items on the next save.
 */
export function reminderMarkdownItPlugin(md: MarkdownIt): void {
  md.core.ruler.before("inline", "scribedog_reminder", (state) => {
    const { tokens } = state as unknown as CoreState;
    // Tightness has to be read before any paragraph is shown: markdown-it
    // marks a tight list only by hiding its items' paragraphs.
    const tightLists = tokens.filter((token, index) => LIST_OPEN_TYPES.has(token.type) && isTightList(tokens, index));
    let shownParagraph = false;

    stripReminders(state as unknown as CoreState, (_tokens, openIndex) => {
      const open = tokens[openIndex];
      open.attrSet(REMINDER_DATA_ATTRIBUTE, JSON.stringify(getTokenReminder(open)));

      if (!open.hidden) {
        return;
      }

      open.hidden = false;
      shownParagraph = true;

      const close = tokens[openIndex + 2];

      if (close && (close.type === "paragraph_close" || close.type === "heading_close")) {
        close.hidden = false;
      }
    });

    // tiptap-markdown reads any <p> inside a list, nested lists included, as
    // "loose"; every tight list says so itself once one paragraph is shown.
    if (shownParagraph) {
      tightLists.forEach((list) => list.attrSet("data-tight", "true"));
    }
  });
}

function isTightList(tokens: MarkdownItToken[], openIndex: number): boolean {
  const level = tokens[openIndex].level;

  for (let i = openIndex + 1; i < tokens.length && tokens[i].level > level; i++) {
    if (tokens[i].type === "paragraph_open" && tokens[i].level === level + 2) {
      return tokens[i].hidden;
    }
  }

  return false;
}

/**
 * Export and index variant: the marker comes off the text and is kept on the
 * token's meta (getTokenReminder), nothing else changes. The exported
 * document never shows it.
 */
export function reminderStripMarkdownItPlugin(md: MarkdownIt): void {
  md.core.ruler.before("inline", "scribedog_reminder", (state) => {
    stripReminders(state as unknown as CoreState, () => undefined);
  });
}
