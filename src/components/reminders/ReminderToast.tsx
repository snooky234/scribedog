import { X } from "lucide-react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";

import { Button } from "@/components/ui/button";

type ReminderToastProps = {
  message: string;
  actionLabel: string;
  onAction: () => void;
  onDismiss: () => void;
};

/** A short notice in the corner with one action: undo a join, show overdue reminders. */
export function ReminderToast({ message, actionLabel, onAction, onDismiss }: ReminderToastProps) {
  const { t } = useTranslation();

  return createPortal(
    <div className="reminder-toast" role="status">
      <span className="reminder-toast__message">{message}</span>
      <Button type="button" variant="outline" size="sm" onClick={onAction}>
        {actionLabel}
      </Button>
      <button
        type="button"
        className="reminder-toast__dismiss"
        aria-label={t("updateNotification.dismiss")}
        onClick={onDismiss}
      >
        <X aria-hidden="true" />
      </button>
    </div>,
    document.body
  );
}
