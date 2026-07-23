import { useEffect, useState } from "react";
import { check, type Update } from "@tauri-apps/plugin-updater";

import { isWindowsPlatform } from "@/lib/platform";
import { useUpdateSettingsStore } from "@/store/useUpdateSettingsStore";

export function useUpdateCheck() {
  const [availableUpdate, setAvailableUpdate] = useState<Update | null>(null);
  const checkForUpdatesEnabled = useUpdateSettingsStore((state) => state.checkForUpdatesEnabled);

  useEffect(() => {
    if (!checkForUpdatesEnabled || !isWindowsPlatform()) {
      return;
    }

    let isActive = true;

    const checkForUpdates = async () => {
      try {
        const update = await check();

        if (isActive && update) {
          setAvailableUpdate(update);
        }
      } catch {
        // Update-Check darf den App-Start nicht blockieren.
      }
    };

    void checkForUpdates();

    return () => {
      isActive = false;
    };
  }, [checkForUpdatesEnabled]);

  const dismissUpdate = () => setAvailableUpdate(null);

  return { availableUpdate, dismissUpdate };
}
