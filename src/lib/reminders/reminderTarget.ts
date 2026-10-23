import { comparableText } from "@/lib/editor/textSearch";

import { isValidDue, splitTrailingReminder, type Reminder } from "./reminderMarker";

// What the chat agent's reminder tools share between the open note (a
// ProseMirror document) and every other note (Markdown text): reading the
// model's arguments and choosing the one block a reminder goes on.

/** The time a reminder gets when the user named a day but no time. */
export const DEFAULT_REMINDER_TIME = "09:00";

// "2026-10-25 09:00", plus the near misses models produce for it: an ISO "T",
// seconds, a one-digit hour or month, "9.00". A zone suffix is not accepted:
// the due time is a local wall-clock time, and silently dropping a "Z" would
// move the reminder by the user's UTC offset.
const DUE_INPUT = /^(\d{4})-(\d{1,2})-(\d{1,2})(?:[ T]+(\d{1,2})[:.](\d{2})(?::\d{2}(?:\.\d+)?)?)?$/;

function pad(value: string): string {
  return value.padStart(2, "0");
}

/**
 * The model's `due` argument as a canonical due time, or null when it is not
 * one. A date without a time means DEFAULT_REMINDER_TIME on that day.
 */
export function parseDueArgument(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const match = DUE_INPUT.exec(value.trim());

  if (!match) {
    return null;
  }

  const [, year, month, day, hours, minutes] = match;
  const time = hours === undefined ? DEFAULT_REMINDER_TIME : `${pad(hours)}:${minutes}`;
  const due = `${year}-${pad(month)}-${pad(day)} ${time}`;

  return isValidDue(due) ? due : null;
}

/** The model's `note` argument: trimmed, without quotes it wrapped around it, null when empty. */
export function parseNoteArgument(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim().replace(/^"(.*)"$/s, "$1").trim();

  return trimmed ? trimmed : null;
}

/**
 * The text with every reminder marker taken off its lines. A model quoting a
 * block from get_document or read_file quotes the marker along with it, and
 * the marker is not part of the text the block is found by.
 */
export function stripReminderMarkers(text: string): string {
  return text
    .split(/\r?\n/)
    .map((line) => splitTrailingReminder(line).text)
    .join("\n");
}

export type ReminderTargetMatch =
  | { kind: "found"; index: number }
  | { kind: "not-found" }
  | { kind: "ambiguous"; count: number };

/**
 * Which of the blocks a reminder for `needle` belongs to.
 *
 * A block whose whole text is the needle wins; otherwise the needle has to
 * occur in exactly one block. More than one is an error rather than "the
 * first": a reminder on the wrong paragraph is a mistake the user only
 * notices when it fires, while the error costs the model one more call with a
 * longer quote.
 */
export function pickReminderTarget(blockTexts: readonly string[], needle: string): ReminderTargetMatch {
  const wanted = comparableText(stripReminderMarkers(needle));

  if (!wanted) {
    return { kind: "not-found" };
  }

  const comparable = blockTexts.map(comparableText);
  const exact = comparable.flatMap((text, index) => (text === wanted ? [index] : []));

  if (exact.length === 1) {
    return { kind: "found", index: exact[0] };
  }

  if (exact.length > 1) {
    return { kind: "ambiguous", count: exact.length };
  }

  const containing = comparable.flatMap((text, index) => (text.includes(wanted) ? [index] : []));

  if (containing.length === 1) {
    return { kind: "found", index: containing[0] };
  }

  return containing.length === 0 ? { kind: "not-found" } : { kind: "ambiguous", count: containing.length };
}

/** What setting or removing a reminder on a block found by its text came to. */
export type ReminderEditOutcome =
  | { kind: "set"; blockText: string; previous: Reminder | null }
  | { kind: "removed"; blockText: string; previous: Reminder }
  // The block already carries exactly this reminder.
  | { kind: "unchanged"; blockText: string }
  // A removal on a block that has no reminder.
  | { kind: "no-reminder"; blockText: string }
  | { kind: "not-found" }
  | { kind: "ambiguous"; count: number }
  // The open note is read-only right now (a staged proposal is on display).
  | { kind: "locked" };

export function sameReminder(a: Reminder | null, b: Reminder | null): boolean {
  return (a?.due ?? null) === (b?.due ?? null) && (a?.note ?? null) === (b?.note ?? null);
}

/** The outcome of a found block going from `previous` to `next`. */
export function editOutcome(blockText: string, previous: Reminder | null, next: Reminder | null): ReminderEditOutcome {
  if (sameReminder(previous, next)) {
    return next ? { kind: "unchanged", blockText } : { kind: "no-reminder", blockText };
  }

  return next ? { kind: "set", blockText, previous } : { kind: "removed", blockText, previous: previous! };
}
