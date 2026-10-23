import MarkdownIt from "markdown-it";

import { getTokenReminder, reminderStripMarkdownItPlugin } from "./reminderMarkdownIt";
import type { Reminder } from "./reminderMarker";
import { dueToDate, isValidDue } from "./reminderMarker";

/** One reminder found in a note, as the tree's bell lists it. */
export type NoteReminder = Reminder & {
  /** The block's text, without list or checkbox markers. */
  text: string;
  /** For a checklist item whether it is ticked; null for any other block. */
  checked: boolean | null;
  /** Position among the note's reminders, for finding the block again once the note is open. */
  ordinal: number;
};

export type VaultReminder = NoteReminder & {
  filePath: string;
  /** The root of the vault the note lives in; the list spans every vault of the vault menu. */
  vaultRoot: string;
};

// The same rule the editor and the export use, so a marker counts here
// exactly where it would show up as a bell (not in a code block, not in the
// middle of a paragraph).
const markdownIt = new MarkdownIt({ html: false, linkify: false, breaks: true });
markdownIt.use(reminderStripMarkdownItPlugin);

const CHECKBOX_PATTERN = /^\[([ xX])\]\s+/;

/** True when the text could contain a reminder at all; skips the parse for every other note. */
export function mayContainReminder(markdown: string): boolean {
  return markdown.includes("reminder");
}

type InlineToken = { type: string; content: string; children: InlineToken[] | null };

// The text as it reads in the editor: marks, links and escapes resolved.
function plainText(inline: InlineToken): string {
  const text = (inline.children ?? [])
    .map((child) => {
      if (child.type === "text" || child.type === "code_inline") {
        return child.content;
      }

      return child.type === "softbreak" || child.type === "hardbreak" ? " " : "";
    })
    .join("");

  return text.replace(/\s+/g, " ").trim();
}

/** Every reminder of a note, in document order. */
export function extractNoteReminders(markdown: string): NoteReminder[] {
  if (!mayContainReminder(markdown)) {
    return [];
  }

  const tokens = markdownIt.parse(markdown, {});
  const found: NoteReminder[] = [];

  for (let i = 0; i < tokens.length - 1; i++) {
    const reminder = getTokenReminder(tokens[i]);

    if (!reminder) {
      continue;
    }

    found.push({ ...reminder, ...readableBlockText(tokens, i), ordinal: found.length });
  }

  return found;
}

/**
 * The text of the paragraph or heading opened at `openIndex`, as it reads in
 * the editor, and for a checklist item whether it is ticked (the checkbox is
 * not part of the text there either).
 */
export function readableBlockText(
  tokens: readonly { type: string }[],
  openIndex: number
): { text: string; checked: boolean | null } {
  let text = plainText(tokens[openIndex + 1] as unknown as InlineToken);
  let checked: boolean | null = null;
  const checkbox = CHECKBOX_PATTERN.exec(text);

  if (checkbox && openIndex >= 1 && tokens[openIndex - 1].type === "list_item_open") {
    checked = checkbox[1] !== " ";
    text = text.slice(checkbox[0].length);
  }

  return { text, checked };
}

/** Earliest first; reminders with an unreadable time go last. */
export function compareReminders(a: VaultReminder, b: VaultReminder): number {
  const aTime = isValidDue(a.due) ? dueToDate(a.due)!.getTime() : Number.POSITIVE_INFINITY;
  const bTime = isValidDue(b.due) ? dueToDate(b.due)!.getTime() : Number.POSITIVE_INFINITY;

  return aTime - bTime || a.filePath.localeCompare(b.filePath) || a.ordinal - b.ordinal;
}

/** A key that names one reminder across rescans, for "already notified". */
export function reminderKey(reminder: VaultReminder): string {
  return `${reminder.filePath}\u0000${reminder.due}\u0000${reminder.text}`;
}
