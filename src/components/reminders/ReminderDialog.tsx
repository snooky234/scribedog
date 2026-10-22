import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

import { Button } from "@/components/ui/button";
import { useDismissOnOverlayClick } from "@/hooks/useDismissOnOverlayClick";
import { isValidDue, type Reminder } from "@/lib/reminders/reminderMarker";
import {
  defaultDue,
  dueTimeOfDay,
  formatDueLabel,
  isReminderDue,
  snoozeDue,
  type SnoozeOption
} from "@/lib/reminders/reminderTime";
import { platform } from "@/platform";

export type ReminderDialogState = {
  /** Position of the block in the document. */
  pos: number;
  /** The block's text, shown as the reminder's content. */
  blockText: string;
  /** For a checklist item whether it is ticked; null for any other block. */
  checked: boolean | null;
  /** The block's reminder; null when a new one is being set. */
  reminder: Reminder | null;
};

type ReminderDialogProps = {
  state: ReminderDialogState | null;
  onSave: (reminder: Reminder) => void;
  onRemove: () => void;
  onCancel: () => void;
};

const PREVIEW_LENGTH = 160;

function splitDue(due: string): { date: string; time: string } {
  const [date = "", time = ""] = due.split(" ");

  return { date, time };
}

/**
 * The one dialog for a reminder: setting a new one, and looking at, changing,
 * snoozing or removing an existing one. The reminder's content is the block's
 * own text; the note is an optional line in front of it.
 */
export function ReminderDialog({ state, onSave, onRemove, onCancel }: ReminderDialogProps) {
  const { t } = useTranslation();
  const dismissProps = useDismissOnOverlayClick(onCancel);
  const [date, setDate] = useState("");
  const [time, setTime] = useState("");
  const [note, setNote] = useState("");
  const dateInputRef = useRef<HTMLInputElement>(null);
  const open = state !== null;

  useEffect(() => {
    if (!state) {
      return;
    }

    const due = splitDue(state.reminder?.due ?? defaultDue());
    setDate(due.date);
    setTime(due.time);
    setNote(state.reminder?.note ?? "");
  }, [state]);

  useEffect(() => {
    if (open) {
      dateInputRef.current?.focus();
    }
  }, [open]);

  useEffect(() => {
    if (!open) {
      return;
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onCancel();
      }
    };

    window.addEventListener("keydown", handleKeyDown);

    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [open, onCancel]);

  if (!state) {
    return null;
  }

  const due = `${date} ${time}`;
  const canSave = isValidDue(due);
  const existing = state.reminder;
  const isDue = existing !== null && isReminderDue(existing, Date.now());
  const preview =
    state.blockText.length > PREVIEW_LENGTH ? `${state.blockText.slice(0, PREVIEW_LENGTH).trimEnd()}…` : state.blockText;

  const save = (reminder: Reminder) => {
    // Asked here, during the click: a browser shows its permission prompt
    // only for a request made while the user acts.
    void platform.notifications?.prepare().catch(() => undefined);
    onSave(reminder);
  };

  const submit = () => {
    if (canSave) {
      save({ due, note: note.trim() || null });
    }
  };

  const ownTime = existing ? dueTimeOfDay(existing.due) : "";

  const snooze = (option: SnoozeOption) => {
    save({ due: snoozeDue(option, new Date(), existing?.due), note: existing?.note ?? null });
  };

  return (
    <div className="unsaved-dialog" role="presentation" {...dismissProps}>
      <div
        className="unsaved-dialog__panel reminder-dialog__panel"
        role="dialog"
        aria-modal="true"
        aria-labelledby="reminder-dialog-title"
        onClick={(event) => event.stopPropagation()}
      >
        <p className="unsaved-dialog__eyebrow">{t("reminders.dialog.eyebrow")}</p>
        <h3 id="reminder-dialog-title">{t(existing ? "reminders.dialog.titleEdit" : "reminders.dialog.title")}</h3>

        {isDue ? (
          <p className="reminder-dialog__due" role="status">
            {t("reminders.dialog.dueSince", { due: formatDueLabel(existing.due) })}
          </p>
        ) : null}

        <blockquote
          className={`reminder-dialog__preview${state.checked ? " reminder-dialog__preview--checked" : ""}`}
          aria-label={t("reminders.dialog.contentLabel")}
        >
          {preview || t("reminders.dialog.emptyBlock")}
        </blockquote>

        <form
          className="reminder-dialog__form"
          onSubmit={(event) => {
            event.preventDefault();
            submit();
          }}
        >
          <div className="reminder-dialog__when">
            <label className="link-dialog__field">
              <span>{t("reminders.dialog.date")}</span>
              <input
                ref={dateInputRef}
                type="date"
                value={date}
                required
                onChange={(event) => setDate(event.target.value)}
              />
            </label>
            <label className="link-dialog__field">
              <span>{t("reminders.dialog.time")}</span>
              <input type="time" value={time} required onChange={(event) => setTime(event.target.value)} />
            </label>
          </div>

          <label className="link-dialog__field">
            <span>{t("reminders.dialog.note")}</span>
            <textarea
              className="reminder-dialog__note"
              value={note}
              rows={2}
              placeholder={t("reminders.dialog.notePlaceholder")}
              onChange={(event) => setNote(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) {
                  event.preventDefault();
                  submit();
                }
              }}
            />
          </label>

          {isDue ? (
            <div className="reminder-dialog__snooze">
              <span>{t("reminders.dialog.snooze")}</span>
              <Button type="button" variant="outline" size="sm" onClick={() => snooze("hour")}>
                {t("reminders.dialog.snoozeHour")}
              </Button>
              <Button type="button" variant="outline" size="sm" onClick={() => snooze("sameTimeTomorrow")}>
                {t("reminders.dialog.snoozeSameTimeTomorrow", { time: ownTime })}
              </Button>
            </div>
          ) : null}

          <div className="unsaved-dialog__actions">
            {existing ? (
              <Button type="button" variant="destructive" className="reminder-dialog__remove" onClick={onRemove}>
                {t("reminders.dialog.remove")}
              </Button>
            ) : null}
            <Button type="button" variant="outline" onClick={onCancel}>
              {t("common.cancel")}
            </Button>
            <Button type="submit" disabled={!canSave}>
              {t("reminders.dialog.save")}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}
