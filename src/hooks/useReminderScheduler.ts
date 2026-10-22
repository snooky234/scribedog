import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

import { isReminderDue } from "@/lib/reminders/reminderTime";
import { reminderKey, type VaultReminder } from "@/lib/reminders/vaultReminders";
import { platform } from "@/platform";
import { useAppStore } from "@/store/useAppStore";
import { listVaultReminders, useRemindersStore } from "@/store/useRemindersStore";

const SYNC_DEBOUNCE_MS = 400;
const CHECK_INTERVAL_MS = 30_000;
const NOTIFICATION_TEXT_LENGTH = 140;

function documentsOf(fileDocuments: Record<string, { content: string }>): Record<string, string> {
  return Object.fromEntries(Object.entries(fileDocuments).map(([filePath, document]) => [filePath, document.content]));
}

function notificationBody(reminder: VaultReminder): string {
  const text = reminder.note ? `${reminder.note}: ${reminder.text}` : reminder.text;

  return text.length > NOTIFICATION_TEXT_LENGTH ? `${text.slice(0, NOTIFICATION_TEXT_LENGTH).trimEnd()}…` : text;
}

/**
 * Keeps the reminder index in step with the vault and tells the user when a
 * reminder comes due: a system notification while the app runs, and, for
 * what came due while it was closed, one notice when the vault opens (a
 * notification per missed reminder would bury the desktop). Each reminder
 * is announced once per session; snoozing gives it a new time and with that
 * a new announcement.
 */
export function useReminderScheduler(): { overdueCount: number; dismissOverdue: () => void } {
  const { t } = useTranslation();
  const [overdueCount, setOverdueCount] = useState(0);
  const announcedRef = useRef(new Set<string>());
  // The vault whose first complete index has been checked; until then a due
  // reminder counts as missed while closed, not as coming due now.
  const checkedVaultRef = useRef<string | null>(null);
  const tRef = useRef(t);
  tRef.current = t;

  useEffect(() => {
    let timer: number | undefined;
    let lastFolderPath: string | null = null;

    const check = () => {
      const { folderPath, byFile } = useRemindersStore.getState();

      if (!folderPath || checkedVaultRef.current !== folderPath) {
        return;
      }

      const now = Date.now();

      for (const reminder of listVaultReminders(byFile)) {
        const key = reminderKey(reminder);

        if (!isReminderDue(reminder, now) || announcedRef.current.has(key)) {
          continue;
        }

        announcedRef.current.add(key);
        void platform.notifications
          ?.notify(tRef.current("reminders.notification.title"), notificationBody(reminder))
          .catch(() => undefined);
      }
    };

    const sync = async () => {
      const { folderPath, filePaths, fileMtimeMs, fileDocuments } = useAppStore.getState();

      if (folderPath !== lastFolderPath) {
        lastFolderPath = folderPath;
        checkedVaultRef.current = null;
        announcedRef.current = new Set();
        setOverdueCount(0);
      }

      await useRemindersStore.getState().syncIndex({
        folderPath,
        filePaths,
        fileMtimeMs,
        documents: documentsOf(fileDocuments)
      });

      if (!folderPath || useAppStore.getState().folderPath !== folderPath) {
        return;
      }

      if (checkedVaultRef.current !== folderPath) {
        // The first complete index of this vault: everything due now was
        // missed while the app was closed.
        const now = Date.now();
        const overdue = listVaultReminders(useRemindersStore.getState().byFile).filter((reminder) =>
          isReminderDue(reminder, now)
        );

        overdue.forEach((reminder) => announcedRef.current.add(reminderKey(reminder)));
        checkedVaultRef.current = folderPath;
        setOverdueCount(overdue.length);
        return;
      }

      check();
    };

    const scheduleSync = () => {
      window.clearTimeout(timer);
      timer = window.setTimeout(() => void sync(), SYNC_DEBOUNCE_MS);
    };

    scheduleSync();

    const unsubscribe = useAppStore.subscribe((state, previous) => {
      if (
        state.folderPath !== previous.folderPath ||
        state.filePaths !== previous.filePaths ||
        state.fileMtimeMs !== previous.fileMtimeMs ||
        state.fileDocuments !== previous.fileDocuments
      ) {
        scheduleSync();
      }
    });
    const interval = window.setInterval(check, CHECK_INTERVAL_MS);

    return () => {
      unsubscribe();
      window.clearTimeout(timer);
      window.clearInterval(interval);
    };
  }, []);

  return { overdueCount, dismissOverdue: () => setOverdueCount(0) };
}
