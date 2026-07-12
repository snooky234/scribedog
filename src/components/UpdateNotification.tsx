import { useState } from "react";
import { X } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { Update } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";

import { Button } from "@/components/ui/button";

type UpdateNotificationProps = {
  update: Update;
  onDismiss: () => void;
};

export function UpdateNotification({ update, onDismiss }: UpdateNotificationProps) {
  const { t } = useTranslation();
  const [installing, setInstalling] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleInstall() {
    setInstalling(true);
    setError(null);

    try {
      await update.downloadAndInstall();
      await relaunch();
    } catch {
      setError(t("updateNotification.installError"));
      setInstalling(false);
    }
  }

  return (
    <div className="update-notification" role="status">
      <div className="update-notification__header">
        <span className="update-notification__title">
          {t("updateNotification.title", { version: update.version })}
        </span>
        <Button
          type="button"
          variant="ghost"
          size="icon-xs"
          onClick={onDismiss}
          disabled={installing}
          aria-label={t("updateNotification.dismiss")}
        >
          <X />
        </Button>
      </div>

      <div className="update-notification__body">
        {error ?? t("updateNotification.body")}
      </div>

      <div className="update-notification__actions">
        <Button type="button" size="sm" onClick={() => void handleInstall()} disabled={installing}>
          {installing ? t("updateNotification.installing") : t("updateNotification.install")}
        </Button>
      </div>
    </div>
  );
}
