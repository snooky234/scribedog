import MarkdownIt from "markdown-it";

import { getTokenReminder, reminderStripMarkdownItPlugin } from "./reminderMarkdownIt";
import { formatReminderMarker, splitTrailingReminder, type Reminder } from "./reminderMarker";
import { editOutcome, pickReminderTarget, type ReminderEditOutcome } from "./reminderTarget";
import { readableBlockText } from "./vaultReminders";

// Setting a reminder on a note that is not open: the same block lookup the
// editor does, worked out on the Markdown text, so the result can go through
// the staging layer like every other change the agent makes to such a note.
// Only the marker at the end of the block's last line changes; the block's
// own text is never rewritten, which is the point of a reminder tool over an
// edit_file call.

// The parser the reminder index uses, so a block counts here exactly where its
// marker would be read back as a reminder (not in a code block or a table).
const markdownIt = new MarkdownIt({ html: false, linkify: false, breaks: true });
markdownIt.use(reminderStripMarkdownItPlugin);

const BLOCK_OPEN_TYPES = new Set(["paragraph_open", "heading_open"]);

type Block = { text: string; line: number; reminder: Reminder | null };

function reminderBlocks(markdown: string): Block[] {
  const tokens = markdownIt.parse(markdown, {});
  const blocks: Block[] = [];

  for (let i = 0; i < tokens.length - 1; i++) {
    const open = tokens[i];

    if (!BLOCK_OPEN_TYPES.has(open.type) || tokens[i + 1].type !== "inline" || !open.map) {
      continue;
    }

    const { text } = readableBlockText(tokens, i);

    if (!text) {
      continue;
    }

    // The marker goes on the block's last line of text. For a setext heading
    // that is the line above its "===" / "---" underline.
    const [start, end] = open.map;
    const setext = open.type === "heading_open" && !open.markup.startsWith("#");
    const line = open.type === "heading_open" ? (setext ? end - 2 : start) : end - 1;

    blocks.push({ text, line, reminder: getTokenReminder(open) });
  }

  return blocks;
}

export type MarkdownReminderEdit = ReminderEditOutcome & { content?: string };

/**
 * Sets (or, with null, removes) the reminder of the one block of `markdown`
 * whose text matches `needle`. `content` is the changed note, present only
 * when something changed.
 */
export function setMarkdownBlockReminder(
  markdown: string,
  needle: string,
  reminder: Reminder | null
): MarkdownReminderEdit {
  const blocks = reminderBlocks(markdown);
  const match = pickReminderTarget(
    blocks.map((block) => block.text),
    needle
  );

  if (match.kind !== "found") {
    return match;
  }

  const block = blocks[match.index];
  const outcome = editOutcome(block.text, block.reminder, reminder);

  if (outcome.kind !== "set" && outcome.kind !== "removed") {
    return outcome;
  }

  const lines = markdown.split("\n");
  const raw = lines[block.line];
  const lineEnd = raw.endsWith("\r") ? "\r" : "";
  const withoutMarker = splitTrailingReminder(lineEnd ? raw.slice(0, -1) : raw).text.replace(/[ \t]+$/, "");

  lines[block.line] = `${reminder ? `${withoutMarker} ${formatReminderMarker(reminder)}` : withoutMarker}${lineEnd}`;

  return { ...outcome, content: lines.join("\n") };
}
