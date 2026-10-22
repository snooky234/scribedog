import i18n from "@/i18n";

import { dateToDue, dueToDate, type Reminder } from "./reminderMarker";

/** True once the reminder's time has come. A malformed time never becomes due. */
export function isReminderDue(reminder: Reminder, now: number): boolean {
  const date = dueToDate(reminder.due);

  return date !== null && date.getTime() <= now;
}

/** The due time for display, in the UI language ("Fr., 25. Okt. 2026, 09:00"). */
export function formatDueLabel(due: string, language: string = i18n.language): string {
  const date = dueToDate(due);

  if (!date) {
    return due;
  }

  try {
    return new Intl.DateTimeFormat(language || undefined, {
      weekday: "short",
      day: "numeric",
      month: "short",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit"
    }).format(date);
  } catch {
    return due;
  }
}

/** The due time of a new reminder: tomorrow at 9:00. */
export function defaultDue(now: Date = new Date()): string {
  const date = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 9, 0);

  return dateToDue(date);
}

export type SnoozeOption = "hour" | "sameTimeTomorrow";

/** The time of day of a due time ("18:30"). */
export function dueTimeOfDay(due: string): string {
  return due.split(" ")[1] ?? "";
}

/**
 * The new due time after snoozing from `now`: an hour later, or tomorrow at
 * the reminder's own time of day (`due`; 9:00 when that cannot be read).
 */
export function snoozeDue(option: SnoozeOption, now: Date = new Date(), due?: string): string {
  if (option === "hour") {
    return dateToDue(new Date(now.getTime() + 60 * 60 * 1000));
  }

  const own = option === "sameTimeTomorrow" && due ? dueToDate(due) : null;

  if (own) {
    return dateToDue(new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, own.getHours(), own.getMinutes()));
  }

  return defaultDue(now);
}
