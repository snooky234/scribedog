import type { EditorToolBridge } from "@/lib/chat/agentTools";
import { agentCapabilities, isOpenDocumentPath, stageReminderEdit } from "@/lib/chat/vaultFileTools";
import { getRelativeDisplayPath } from "@/lib/fileSystem";
import { dateToDue, dueToDate, type Reminder } from "@/lib/reminders/reminderMarker";
import { parseDueArgument, parseNoteArgument, type ReminderEditOutcome } from "@/lib/reminders/reminderTarget";
import { extractNoteReminders, type NoteReminder } from "@/lib/reminders/vaultReminders";
import { useAppStore } from "@/store/useAppStore";
import { useRemindersStore } from "@/store/useRemindersStore";

import { normalizeVaultPath, vaultPathKey } from "./vaultStaging";

/**
 * Execution of the chat agent's reminder tools (set_reminder, remove_reminder,
 * list_reminders).
 *
 * The open note and every other note take different routes, for the same
 * reason the file tools refuse the open note: on the open note the reminder
 * is set as a block attribute through the editor (one undo step, never a text
 * replacement), on any other note it is a staged change to the Markdown that
 * the user reviews like every other change the agent proposes there.
 */

/** Mirrors ToolResult in agentTools.ts; re-declared to keep the import one-way. */
type ReminderToolResult = { content: string; retryable?: boolean };

// The listing goes into the context window whole; a vault with years of
// reminders would otherwise push the user's question out of it.
const MAX_LISTED_REMINDERS = 100;

const MAX_QUOTED_CHARS = 80;

const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

/** "Friday 2026-10-30 09:00": the weekday spelled out, so the model need not work it out. */
export function describeDue(due: string): string {
  const date = dueToDate(due);

  return date ? `${WEEKDAYS[date.getDay()]} ${due}` : due;
}

function quote(text: string): string {
  const flat = text.replace(/\s+/g, " ").trim();

  return `"${flat.length > MAX_QUOTED_CHARS ? `${flat.slice(0, MAX_QUOTED_CHARS - 1)}…` : flat}"`;
}

// The block to find. "text" is the documented name; the others are what
// models carry over from replace_passage and edit_file.
function textArgument(args: Record<string, unknown>): string {
  const value = args.text ?? args.passage ?? args.old_text ?? args.block;

  return typeof value === "string" ? value : "";
}

function pathArgument(args: Record<string, unknown>): string | null {
  return typeof args.path === "string" && args.path.trim() ? args.path.trim() : null;
}

function disabledResult(): ReminderToolResult {
  return {
    content:
      "Error: reminders are switched off for the agent in this app's AI settings, so you cannot set, change " +
      "or list them. Tell the user in one sentence that they can enable it in the AI settings under the " +
      "agent options, or set the reminder themselves with the bell in the editor."
  };
}

function pastNote(reminder: Reminder | null, now: Date): string {
  const date = reminder ? dueToDate(reminder.due) : null;

  return date && date.getTime() <= now.getTime()
    ? " Note: that time is already in the past, so the reminder is due right away. If you meant a later " +
        "date, set it again with the corrected due time."
    : "";
}

/** The model-facing answer for what a set or remove came to. `relativePath` is null for the open note. */
function describeOutcome(
  outcome: ReminderEditOutcome,
  reminder: Reminder | null,
  relativePath: string | null,
  now: Date
): ReminderToolResult {
  const where = relativePath ? `in "${relativePath}"` : "in the open note";

  switch (outcome.kind) {
    case "set": {
      const replaced = outcome.previous
        ? ` It replaces the reminder for ${describeDue(outcome.previous.due)} that block had.`
        : "";
      const result = relativePath
        ? `OK: proposed a reminder for ${describeDue(reminder!.due)} on ${quote(outcome.blockText)} ${where}. ` +
          "It waits for the user's review in the file tree like any other change to that note, and is not in " +
          "the note until they apply it."
        : `OK: reminder set for ${describeDue(reminder!.due)} on ${quote(outcome.blockText)} ${where}. It is ` +
          "in the note now: the user sees a bell at the end of that line and can undo it. Do not set it again.";

      return { content: result + replaced + pastNote(reminder, now) };
    }
    case "removed":
      return {
        content: relativePath
          ? `OK: proposed removing the reminder for ${describeDue(outcome.previous.due)} from ` +
            `${quote(outcome.blockText)} ${where}. It waits for the user's review in the file tree.`
          : `OK: removed the reminder for ${describeDue(outcome.previous.due)} from ` +
            `${quote(outcome.blockText)} ${where}. The user can undo it.`
      };
    case "unchanged":
      return { content: `OK: ${quote(outcome.blockText)} already has exactly this reminder. Nothing changed.` };
    case "no-reminder":
      return {
        content:
          `Error: ${quote(outcome.blockText)} ${where} has no reminder, so there is nothing to remove. Call ` +
          "list_reminders to see which blocks have one.",
        retryable: true
      };
    case "not-found":
      return {
        content:
          `Error: no paragraph, heading or list item ${where} matches that text. Do not retry with the same ` +
          "text: copy a few distinctive words from a single line of the note as it is now. Reminders cannot " +
          "go into a table cell or a code block.",
        retryable: true
      };
    case "ambiguous":
      return {
        content:
          `Error: that text matches ${outcome.count} different blocks ${where}. Quote more of the one you ` +
          "mean, so that it matches only that one.",
        retryable: true
      };
    case "locked":
      return {
        content:
          "Error: the open note is showing a staged change for review and is read-only until the user " +
          "applies or discards it. Tell the user so; do not try to set the reminder another way."
      };
  }
}

async function editReminder(
  name: string,
  args: Record<string, unknown>,
  bridge: EditorToolBridge | null,
  now: Date
): Promise<ReminderToolResult> {
  const text = textArgument(args);

  if (!text.trim()) {
    return {
      content:
        "Error: no text given. Pass text: a few distinctive words of the paragraph, heading or list item the " +
        "reminder belongs to, copied from the note.",
      retryable: true
    };
  }

  let reminder: Reminder | null = null;

  if (name === "set_reminder") {
    const due = parseDueArgument(args.due);

    if (!due) {
      return {
        content:
          `Error: ${JSON.stringify(args.due ?? "")} is not a due time. Pass due as the user's local time in ` +
          `the form "YYYY-MM-DD HH:MM" (today is ${describeDue(dateToDue(now))}), without a time zone.`,
        retryable: true
      };
    }

    reminder = { due, note: parseNoteArgument(args.note) };
  }

  const path = pathArgument(args);

  if (path && !isOpenDocumentPath(path)) {
    const staged = await stageReminderEdit(path, text, reminder);

    return "outcome" in staged ? describeOutcome(staged.outcome, reminder, staged.relativePath, now) : staged;
  }

  if (!bridge?.hasDocument()) {
    return {
      content: agentCapabilities().fileAccess
        ? "Error: no note is open in the editor. To put a reminder into another note, pass its path exactly " +
          "as list_files reports it."
        : "Error: no note is open in the editor, and reminders in other notes need the agent's file access, " +
          "which is switched off. Ask the user to open the note.",
      retryable: true
    };
  }

  return describeOutcome(bridge.setBlockReminder(text, reminder), reminder, null, now);
}

type ListedReminder = NoteReminder & { path: string };

function listReminders(
  args: Record<string, unknown>,
  bridge: EditorToolBridge | null,
  now: Date
): ReminderToolResult {
  const { fileAccess } = agentCapabilities();
  const { folderPath, selectedFilePath } = useAppStore.getState();
  const relative = (absolutePath: string) =>
    folderPath ? normalizeVaultPath(getRelativeDisplayPath(folderPath, absolutePath)) : absolutePath;
  const found: ListedReminder[] = [];

  // The open note from the editor rather than from the index: a reminder set
  // a moment ago is in the editor before the index has read it.
  if (bridge?.hasDocument() && selectedFilePath) {
    const path = relative(selectedFilePath);
    found.push(...extractNoteReminders(bridge.getDocument()).map((reminder) => ({ ...reminder, path })));
  }

  // Every other note only with file access: the block texts are their
  // content, and reading other notes is what that switch consents to.
  const index = useRemindersStore.getState();

  if (fileAccess && folderPath && index.folderPath === folderPath) {
    for (const [filePath, reminders] of Object.entries(index.byFile)) {
      if (filePath !== selectedFilePath) {
        const path = relative(filePath);
        found.push(...reminders.map((reminder) => ({ ...reminder, path })));
      }
    }
  }

  const pathFilter = pathArgument(args);
  const listed = (pathFilter ? found.filter((entry) => vaultPathKey(entry.path) === vaultPathKey(pathFilter)) : found)
    .map((entry) => ({ entry, time: dueToDate(entry.due)?.getTime() ?? Number.POSITIVE_INFINITY }))
    .sort((a, b) => a.time - b.time || a.entry.path.localeCompare(b.entry.path) || a.entry.ordinal - b.entry.ordinal);

  const scope = fileAccess
    ? ""
    : "\nOnly the open note is listed: reading other notes is switched off (the agent's file access in the AI " +
      "settings).";
  const today = `Now is ${describeDue(dateToDue(now))}.`;

  if (listed.length === 0) {
    return { content: `No reminders${pathFilter ? ` in "${pathFilter}"` : ""}. ${today}${scope}` };
  }

  const lines = listed.slice(0, MAX_LISTED_REMINDERS).map(({ entry, time }) => {
    const state = entry.checked ? " (checked off)" : time <= now.getTime() ? " (due, not dealt with yet)" : "";
    const note = entry.note ? ` | note: ${quote(entry.note)}` : "";

    return `- ${describeDue(entry.due)}${state} | ${entry.path} | ${quote(entry.text)}${note}`;
  });
  const more =
    listed.length > MAX_LISTED_REMINDERS ? `\n(${listed.length - MAX_LISTED_REMINDERS} later ones not listed)` : "";

  return { content: `${listed.length} reminder(s), earliest first. ${today}\n${lines.join("\n")}${more}${scope}` };
}

/** Dispatch for the three reminder tools. */
export async function executeReminderTool(
  name: string,
  args: Record<string, unknown>,
  bridge: EditorToolBridge | null,
  now: Date = new Date()
): Promise<ReminderToolResult> {
  // Checked where the tool runs, not only where it is offered: an alias like
  // add_reminder reaches this function whether or not the tool was offered.
  if (!agentCapabilities().reminders) {
    return disabledResult();
  }

  return name === "list_reminders" ? listReminders(args, bridge, now) : editReminder(name, args, bridge, now);
}
