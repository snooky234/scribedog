import type { NotificationsApi } from "@/platform/types";

// The browser's Notification API. Browsers only show the permission prompt
// for a request made while a user's click is handled, so the reminder dialog
// asks on its save button (prepare) and a reminder that comes due later only
// notifies when the answer was yes.
function available(): boolean {
  return typeof window !== "undefined" && "Notification" in window;
}

export const browserNotifications: NotificationsApi | null = available()
  ? {
      prepare: async () => {
        if (Notification.permission === "default") {
          await Notification.requestPermission();
        }
      },
      notify: async (title, body) => {
        if (Notification.permission === "granted") {
          new Notification(title, { body });
        }
      }
    }
  : null;
