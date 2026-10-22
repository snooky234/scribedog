// A reminder hangs on one block of a note (a paragraph, a heading, the text of
// a list or checklist item) and lives in the Markdown itself, as a comment at
// the end of the block's last line:
//
//   Shorten this paragraph. <!-- reminder: 2026-10-25 09:00 -->
//   - [ ] Check the sources <!-- reminder: 2026-10-25 09:00 "Chapter 3 first" -->
//
// In the file rather than in a sidecar under .scribedog/, because the
// reminder then travels with its paragraph wherever the text goes: moved,
// renamed, edited in another tool, rewritten by the agent, synced through a
// server vault, restored from a version. A sidecar would have to find the
// paragraph again by its text, and the typical reminder ("rework this
// paragraph") is set on text that is about to change. A comment, because other
// Markdown tools and every export then show the text without it.
//
// The time is a local wall-clock time without a zone: "Friday 9:00" means
// 9:00 wherever the user is when Friday comes, as in a calendar's floating
// time.

export type Reminder = {
  /** Local date and time, "YYYY-MM-DD HH:MM". */
  due: string;
  /** Optional text shown before the block's own text; null when there is none. */
  note: string | null;
};

const DUE_PATTERN = /^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2})$/;

// The note is a JSON string, so quotes, backslashes and line breaks need no
// rules of their own. Only "-->" would end the comment early; JSON lets its
// ">" be written as >.
const NOTE_SOURCE = String.raw`"(?:[^"\\]|\\.)*"`;

// The marker at the very end of a block's text, with the whitespace before it.
// Spacing and the colon are optional when reading, the writer always uses the
// canonical form.
const TRAILING_MARKER_PATTERN = new RegExp(
  String.raw`[ \t]*<!--[ \t]*reminder:?[ \t]+(\d{4}-\d{2}-\d{2})[ \t]+(\d{1,2}:\d{2})(?:[ \t]+(${NOTE_SOURCE}))?[ \t]*-->[ \t]*$`
);

/** True for a well-formed due time that names a real date ("2026-02-30 09:00" is not one). */
export function isValidDue(due: string): boolean {
  const match = DUE_PATTERN.exec(due);

  if (!match) {
    return false;
  }

  const [year, month, day, hours, minutes] = match.slice(1).map(Number);
  const date = new Date(year, month - 1, day, hours, minutes);

  return (
    date.getFullYear() === year &&
    date.getMonth() === month - 1 &&
    date.getDate() === day &&
    hours < 24 &&
    minutes < 60
  );
}

/** The due time as a local Date; null for a malformed one. */
export function dueToDate(due: string): Date | null {
  if (!isValidDue(due)) {
    return null;
  }

  const [year, month, day, hours, minutes] = DUE_PATTERN.exec(due)!.slice(1).map(Number);

  return new Date(year, month - 1, day, hours, minutes);
}

function pad(value: number): string {
  return String(value).padStart(2, "0");
}

/** A local Date as a due time, rounded down to the minute. */
export function dateToDue(date: Date): string {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function normalizeNote(note: string | null | undefined): string | null {
  const trimmed = note?.trim() ?? "";

  return trimmed ? trimmed : null;
}

/** A reminder with a valid due time and a trimmed note, or null. */
export function normalizeReminder(value: unknown): Reminder | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  const { due, note } = value as { due?: unknown; note?: unknown };

  if (typeof due !== "string" || !isValidDue(due)) {
    return null;
  }

  return { due, note: normalizeNote(typeof note === "string" ? note : null) };
}

/** The canonical comment for a reminder, without leading whitespace. */
export function formatReminderMarker(reminder: Reminder): string {
  const note = normalizeNote(reminder.note);
  const encodedNote = note === null ? "" : ` ${JSON.stringify(note).replace(/>/g, "\\u003e")}`;

  return `<!-- reminder: ${reminder.due}${encodedNote} -->`;
}

/**
 * Splits a reminder marker off the end of a block's source text. Returns the
 * text unchanged and a null reminder when the text does not end in a valid
 * marker; a marker anywhere else in the text is ordinary text.
 */
export function splitTrailingReminder(text: string): { text: string; reminder: Reminder | null } {
  const match = TRAILING_MARKER_PATTERN.exec(text);

  if (!match) {
    return { text, reminder: null };
  }

  const [hours, minutes] = match[2].split(":");
  const due = `${match[1]} ${hours.padStart(2, "0")}:${minutes}`;

  if (!isValidDue(due)) {
    return { text, reminder: null };
  }

  let note: string | null = null;

  if (match[3] !== undefined) {
    try {
      note = normalizeNote(JSON.parse(match[3]) as string);
    } catch {
      return { text, reminder: null };
    }
  }

  return { text: text.slice(0, match.index), reminder: { due, note } };
}
