import { X } from "lucide-react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";

type UndoToastProps = {
  message: string;
  actionLabel: string;
  onAction: () => void;
  onDismiss: () => void;
};

/**
 * A short undo offer at the bottom centre, in the inverted palette (light on
 * a dark UI, dark on a light one). It has to stand out from the page it sits
 * on, and it must not share the corner with the reminder notices.
 */
export function UndoToast({ message, actionLabel, onAction, onDismiss }: UndoToastProps) {
  const { t } = useTranslation();

  return createPortal(
    <div className="undo-toast" role="status">
      <span className="undo-toast__message">{message}</span>
      <button type="button" className="undo-toast__action" onClick={onAction}>
        {actionLabel}
      </button>
      <button
        type="button"
        className="undo-toast__dismiss"
        aria-label={t("updateNotification.dismiss")}
        onClick={onDismiss}
      >
        <X aria-hidden="true" />
      </button>
    </div>,
    document.body
  );
}
