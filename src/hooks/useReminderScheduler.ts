import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

import { getRecentFolderPathsSnapshot, subscribeToRecentFolderPaths } from "@/lib/fileSystem";
import { reminderVaultReader } from "@/lib/reminders/reminderVaultReader";
import { reminderVaultRoots } from "@/lib/reminders/reminderVaults";
import { isReminderDue } from "@/lib/reminders/reminderTime";
import { reminderKey, type VaultReminder } from "@/lib/reminders/vaultReminders";
import { isRemoteVaultPath, remoteVaultFor } from "@/lib/remoteVaults";
import { platform } from "@/platform";
import { useAppStore } from "@/store/useAppStore";
import { listAllReminders, useRemindersStore } from "@/store/useRemindersStore";
import { useSharedVaultsStore } from "@/store/useSharedVaultsStore";

const SYNC_DEBOUNCE_MS = 400;
const CHECK_INTERVAL_MS = 30_000;
const NOTIFICATION_TEXT_LENGTH = 140;
// The other vaults have no watcher: they are read again on this interval,
// whenever the vault menu's contents change, and when the list is opened.
const SCAN_INTERVAL_MS = 5 * 60_000;
const SCAN_DEBOUNCE_MS = 1_500;
const SCAN_ON_OPEN_MIN_GAP_MS = 30_000;

function documentsOf(fileDocuments: Record<string, { content: string }>): Record<string, string> {
  return Object.fromEntries(Object.entries(fileDocuments).map(([filePath, document]) => [filePath, document.content]));
}

function notificationBody(reminder: VaultReminder): string {
  const text = reminder.note ? `${reminder.note}: ${reminder.text}` : reminder.text;

  return text.length > NOTIFICATION_TEXT_LENGTH ? `${text.slice(0, NOTIFICATION_TEXT_LENGTH).trimEnd()}…` : text;
}

/** The vaults of the vault menu other than the open one, as useRemindersStore scans them. */
function backgroundVaultRoots(): string[] {
  const api = platform.sharedVaults;
  const servers = useSharedVaultsStore.getState().servers;
  // The same entries the vault menu lists: a server that was forgotten, or a
  // shared vault's own root, drops out of the recent list there too. The
  // browser has no recent list; its server is the one vault of its own.
  const ownRoots = platform.features.localFolders
    ? getRecentFolderPathsSnapshot().filter((path) => remoteVaultFor(path) !== null || !isRemoteVaultPath(path))
    : servers.map((server) => server.root);

  return reminderVaultRoots({
    ownRoots,
    servers: servers.map((server) => ({
      root: server.root,
      vaultRoots: api ? server.overview.vaults.map((vault) => api.rootFor(server.root, vault.id)) : []
    })),
    activeRoot: useAppStore.getState().folderPath
  });
}

/**
 * Keeps the reminder index in step with every vault of the vault menu and
 * tells the user when a reminder comes due, in whichever vault: a system
 * notification while the app runs, and, for what came due while it was
 * closed, one notice once the vault has been read (a notification per missed
 * reminder would bury the desktop). Each reminder is announced once per
 * session; snoozing gives it a new time and with that a new announcement.
 */
export function useReminderScheduler(): { overdueCount: number; dismissOverdue: () => void } {
  const { t } = useTranslation();
  const [overdueCount, setOverdueCount] = useState(0);
  const announcedRef = useRef(new Set<string>());
  // The vaults whose first complete index has been looked at; until then a
  // due reminder there counts as missed while closed, not as coming due now.
  const checkedRootsRef = useRef(new Set<string>());
  const tRef = useRef(t);
  tRef.current = t;

  useEffect(() => {
    let syncTimer: number | undefined;
    let scanTimer: number | undefined;
    let scanning = false;
    let lastScanAt = 0;

    const check = () => {
      const now = Date.now();

      for (const reminder of listAllReminders(useRemindersStore.getState())) {
        const key = reminderKey(reminder);

        if (
          !checkedRootsRef.current.has(reminder.vaultRoot) ||
          !isReminderDue(reminder, now) ||
          announcedRef.current.has(key)
        ) {
          continue;
        }

        announcedRef.current.add(key);
        void platform.notifications
          ?.notify(tRef.current("reminders.notification.title"), notificationBody(reminder))
          .catch(() => undefined);
      }
    };

    // The first complete index of a vault: everything due now was missed
    // while the app was closed (or before the vault could be read).
    const settleFirstIndex = (root: string) => {
      const now = Date.now();
      const missed = listAllReminders(useRemindersStore.getState()).filter(
        (reminder) =>
          reminder.vaultRoot === root && isReminderDue(reminder, now) && !announcedRef.current.has(reminderKey(reminder))
      );

      missed.forEach((reminder) => announcedRef.current.add(reminderKey(reminder)));
      checkedRootsRef.current.add(root);

      if (missed.length > 0) {
        setOverdueCount((count) => count + missed.length);
      }
    };

    const sync = async () => {
      const { folderPath, filePaths, fileMtimeMs, fileDocuments } = useAppStore.getState();

      await useRemindersStore.getState().syncIndex({
        folderPath,
        filePaths,
        fileMtimeMs,
        documents: documentsOf(fileDocuments)
      });

      if (!folderPath || useAppStore.getState().folderPath !== folderPath) {
        return;
      }

      if (!checkedRootsRef.current.has(folderPath)) {
        settleFirstIndex(folderPath);
        return;
      }

      check();
    };

    const scan = async () => {
      if (scanning) {
        return;
      }

      scanning = true;
      lastScanAt = Date.now();

      try {
        const roots = backgroundVaultRoots();
        useRemindersStore.getState().retainVaults(roots);

        // One vault after the other: each is a listing plus whatever changed,
        // and a slow server should not hold up the rest for long.
        for (const root of roots) {
          try {
            const reader = await reminderVaultReader(root);

            if (!reader) {
              continue;
            }

            await useRemindersStore.getState().scanVault(root, reader);
          } catch {
            // Away, refused or deleted: what was known stays until it is back.
            continue;
          }

          if (!checkedRootsRef.current.has(root)) {
            settleFirstIndex(root);
          }
        }

        check();
      } finally {
        scanning = false;
      }
    };

    const scheduleSync = () => {
      window.clearTimeout(syncTimer);
      syncTimer = window.setTimeout(() => void sync(), SYNC_DEBOUNCE_MS);
    };

    const scheduleScan = () => {
      window.clearTimeout(scanTimer);
      scanTimer = window.setTimeout(() => void scan(), SCAN_DEBOUNCE_MS);
    };

    scheduleSync();
    scheduleScan();

    const unsubscribeApp = useAppStore.subscribe((state, previous) => {
      if (
        state.folderPath !== previous.folderPath ||
        state.filePaths !== previous.filePaths ||
        state.fileMtimeMs !== previous.fileMtimeMs ||
        state.fileDocuments !== previous.fileDocuments
      ) {
        scheduleSync();
      }
    });
    const unsubscribeRecent = subscribeToRecentFolderPaths(scheduleScan);
    const unsubscribeShared = useSharedVaultsStore.subscribe((state, previous) => {
      if (state.servers !== previous.servers) {
        scheduleScan();
      }
    });
    const unsubscribeList = useRemindersStore.subscribe((state, previous) => {
      if (state.popoverOpen && !previous.popoverOpen && Date.now() - lastScanAt > SCAN_ON_OPEN_MIN_GAP_MS) {
        void scan();
      }
    });
    const checkInterval = window.setInterval(check, CHECK_INTERVAL_MS);
    const scanInterval = window.setInterval(() => void scan(), SCAN_INTERVAL_MS);

    return () => {
      unsubscribeApp();
      unsubscribeRecent();
      unsubscribeShared();
      unsubscribeList();
      window.clearTimeout(syncTimer);
      window.clearTimeout(scanTimer);
      window.clearInterval(checkInterval);
      window.clearInterval(scanInterval);
    };
  }, []);

  return { overdueCount, dismissOverdue: () => setOverdueCount(0) };
}
