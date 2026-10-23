import { Bell, BellRing, FileText } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";

import { Button } from "@/components/ui/button";
import { Menu, MenuItem, MenuPopup, MenuPortal, MenuPositioner, MenuTrigger } from "@/components/ui/menu";
import { getFolderBasename } from "@/lib/fileSystem";
import { formatDueLabel, isReminderDue } from "@/lib/reminders/reminderTime";
import type { VaultReminder } from "@/lib/reminders/vaultReminders";
import { listAllReminders, useRemindersStore } from "@/store/useRemindersStore";

const CLOCK_INTERVAL_MS = 30_000;

function fileLabel(filePath: string): string {
  return (filePath.split(/[\\/]/).pop() ?? filePath).replace(/\.md$/i, "");
}

/** The current time, moved on every half minute so "due" follows the clock. */
export function useClock(): number {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), CLOCK_INTERVAL_MS);

    return () => window.clearInterval(timer);
  }, []);

  return now;
}

/** Every reminder of every vault in the vault menu, earliest first. */
function useAllReminders(): VaultReminder[] {
  const folderPath = useRemindersStore((state) => state.folderPath);
  const byFile = useRemindersStore((state) => state.byFile);
  const otherVaults = useRemindersStore((state) => state.otherVaults);

  return useMemo(() => listAllReminders({ folderPath, byFile, otherVaults }), [folderPath, byFile, otherVaults]);
}

/** How many reminders are due right now, across the vaults. */
export function useDueReminderCount(): number {
  const reminders = useAllReminders();
  const now = useClock();

  return useMemo(() => reminders.filter((reminder) => isReminderDue(reminder, now)).length, [reminders, now]);
}

/**
 * A pulsing dot on the button that opens the sidebar where it is a sheet
 * (phone, tablet): the bell with its count sits inside the sheet, out of sight.
 */
export function ReminderDueDot() {
  const { t } = useTranslation();
  const count = useDueReminderCount();

  if (count === 0) {
    return null;
  }

  return (
    <span className="reminder-due-dot">
      <span className="sr-only">{t("reminders.sidebar.buttonDue", { count })}</span>
    </span>
  );
}

type ReminderBellProps = {
  disabled: boolean;
  onOpenReminder: (reminder: VaultReminder) => void;
};

/**
 * The bell in the sidebar's header: how many reminders are due, and the list
 * of all of them, due ones first. It spans every vault of the vault menu, so
 * a reminder in another vault is not out of sight; an entry from another
 * vault names it. Picking one opens its note (and its vault, if need be) and
 * selects the block.
 */
export function ReminderBell({ disabled, onOpenReminder }: ReminderBellProps) {
  const { t } = useTranslation();
  const folderPath = useRemindersStore((state) => state.folderPath);
  const open = useRemindersStore((state) => state.popoverOpen);
  const setOpen = useRemindersStore((state) => state.setPopoverOpen);
  const now = useClock();
  const reminders = useAllReminders();
  const due = reminders.filter((reminder) => isReminderDue(reminder, now));
  const upcoming = reminders.filter((reminder) => !isReminderDue(reminder, now));
  const label = due.length > 0 ? t("reminders.sidebar.buttonDue", { count: due.length }) : t("reminders.sidebar.button");

  const renderItem = (reminder: VaultReminder, isDue: boolean) => {
    const note = fileLabel(reminder.filePath);
    const vault = reminder.vaultRoot === folderPath ? null : getFolderBasename(reminder.vaultRoot);

    return (
      <MenuItem
        key={`${reminder.vaultRoot}:${reminder.filePath}:${reminder.ordinal}`}
        className="reminder-list__item"
        onClick={() => onOpenReminder(reminder)}
      >
        <span className={`reminder-list__due${isDue ? " reminder-list__due--due" : ""}`}>{formatDueLabel(reminder.due)}</span>
        <span className={`reminder-list__text${reminder.checked ? " reminder-list__text--checked" : ""}`}>
          {reminder.note ? <strong>{reminder.note} </strong> : null}
          {reminder.text || t("reminders.dialog.emptyBlock")}
        </span>
        <span
          className="reminder-list__file"
          title={vault ? t("reminders.sidebar.inVaultNote", { note, vault }) : t("reminders.sidebar.inNote", { note })}
        >
          <FileText aria-hidden="true" />
          <span className="reminder-list__file-name">{vault ? `${vault} / ${note}` : note}</span>
        </span>
      </MenuItem>
    );
  };

  return (
    <Menu open={open} onOpenChange={setOpen}>
      <MenuTrigger
        render={
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={disabled}
            aria-label={label}
            title={label}
            className={`reminder-bell-button${due.length > 0 ? " reminder-bell-button--due" : ""}`}
            data-testid="reminders"
          >
            {due.length > 0 ? <BellRing /> : <Bell />}
            {due.length > 0 ? (
              <span className="reminder-bell-button__count" aria-hidden="true">
                {due.length > 99 ? "99+" : due.length}
              </span>
            ) : null}
          </Button>
        }
      />
      <MenuPortal>
        <MenuPositioner>
          <MenuPopup className="reminder-list">
            {reminders.length === 0 ? (
              <p className="reminder-list__empty">{t("reminders.sidebar.empty")}</p>
            ) : null}
            {due.length > 0 ? <p className="reminder-list__heading">{t("reminders.sidebar.due")}</p> : null}
            {due.map((reminder) => renderItem(reminder, true))}
            {upcoming.length > 0 ? <p className="reminder-list__heading">{t("reminders.sidebar.upcoming")}</p> : null}
            {upcoming.map((reminder) => renderItem(reminder, false))}
          </MenuPopup>
        </MenuPositioner>
      </MenuPortal>
    </Menu>
  );
}
