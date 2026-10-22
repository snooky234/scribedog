import { useTranslation } from "react-i18next";

import { ReminderToast } from "@/components/reminders/ReminderToast";
import { useReminderScheduler } from "@/hooks/useReminderScheduler";
import { useRemindersStore } from "@/store/useRemindersStore";

type ReminderNoticesProps = {
  /** Makes the sidebar visible where it is a sheet, so its list can open. */
  onRevealSidebar: () => void;
};

/** Runs the reminder schedule and shows the notice about reminders missed while the app was closed. */
export function ReminderNotices({ onRevealSidebar }: ReminderNoticesProps) {
  const { t } = useTranslation();
  const { overdueCount, dismissOverdue } = useReminderScheduler();

  if (overdueCount === 0) {
    return null;
  }

  return (
    <ReminderToast
      message={t("reminders.overdueOnOpen", { count: overdueCount })}
      actionLabel={t("reminders.show")}
      onAction={() => {
        dismissOverdue();
        onRevealSidebar();
        useRemindersStore.getState().setPopoverOpen(true);
      }}
      onDismiss={dismissOverdue}
    />
  );
}
