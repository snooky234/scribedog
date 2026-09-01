import { useEffect, useState } from "react";
import { X } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { Update } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";
import { openUrl } from "@tauri-apps/plugin-opener";

import { Button } from "@/components/ui/button";
import { getPortableStatus } from "@/lib/portable";

const RELEASES_URL = "https://github.com/snooky234/scribedog/releases/latest";

type UpdateNotificationProps = {
  update: Update;
  onDismiss: () => void;
};

export function UpdateNotification({ update, onDismiss }: UpdateNotificationProps) {
  const { t } = useTranslation();
  const [installing, setInstalling] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // The updater replaces an installed build through its NSIS installer, which
  // a free-standing executable was never put in place by. So the portable
  // build still learns about a new version, but points at the download instead
  // of pretending it can install it.
  const [isPortable, setIsPortable] = useState(false);

  useEffect(() => {
    let active = true;

    void getPortableStatus().then((status) => {
      if (active) {
        setIsPortable(status.mode !== "off");
      }
    });

    return () => {
      active = false;
    };
  }, []);

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
        {error ?? t(isPortable ? "updateNotification.portableBody" : "updateNotification.body")}
      </div>

      <div className="update-notification__actions">
        {isPortable ? (
          <Button type="button" size="sm" onClick={() => void openUrl(RELEASES_URL)}>
            {t("updateNotification.openDownload")}
          </Button>
        ) : (
          <Button type="button" size="sm" onClick={() => void handleInstall()} disabled={installing}>
            {installing ? t("updateNotification.installing") : t("updateNotification.install")}
          </Button>
        )}
      </div>
    </div>
  );
}
