import { useCallback, useEffect, useState } from "react";
import { Laptop } from "lucide-react";
import { useTranslation } from "react-i18next";

import { Button } from "@/components/ui/button";

export type DeviceListEntry = {
  id: string;
  name: string;
  createdAt: string;
  lastUsedAt: string | null;
  /** The device the list is being viewed from, when known. */
  current?: boolean;
};

type DeviceListProps = {
  load: () => Promise<DeviceListEntry[]>;
  revoke: (id: string) => Promise<void>;
  /** Called after this device's own token was revoked from the list. */
  onRevokedCurrent?: () => void;
  testIdPrefix?: string;
};

function formatDate(value: string | null, locale: string): string {
  if (!value) {
    return "";
  }

  const date = new Date(value);

  return Number.isNaN(date.getTime()) ? value : date.toLocaleString(locale, { dateStyle: "medium", timeStyle: "short" });
}

/**
 * The "signed-in devices" of a server: every desktop app that holds an
 * access token, with a way to end that access one device at a time. Shown
 * in the browser under Account and on the desktop per server; the server
 * decides who is "this device".
 */
export function DeviceList({ load, revoke, onRevokedCurrent, testIdPrefix = "device" }: DeviceListProps) {
  const { t, i18n } = useTranslation();
  const [devices, setDevices] = useState<DeviceListEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setError(null);

    try {
      setDevices(await load());
    } catch (caught) {
      setDevices([]);
      setError(caught instanceof Error ? caught.message : t("devices.loadFailed"));
    }
  }, [load, t]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const handleRevoke = async (device: DeviceListEntry) => {
    setBusyId(device.id);
    setError(null);

    try {
      await revoke(device.id);

      if (device.current) {
        onRevokedCurrent?.();
      }

      await refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : t("devices.revokeFailed"));
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="device-list" data-testid={`${testIdPrefix}-list`}>
      {devices === null ? (
        <p className="ai-dialog__model-hint">{t("devices.loading")}</p>
      ) : devices.length === 0 ? (
        <p className="ai-dialog__model-hint" data-testid={`${testIdPrefix}-empty`}>
          {t("devices.none")}
        </p>
      ) : (
        <ul className="device-list__items">
          {devices.map((device) => (
            <li key={device.id} className="device-list__item" data-testid={`${testIdPrefix}-item`}>
              <Laptop className="size-4 device-list__icon" aria-hidden="true" />
              <div className="device-list__text">
                <span className="device-list__name">
                  {device.name}
                  {device.current ? <span className="device-list__badge">{t("devices.thisDevice")}</span> : null}
                </span>
                <span className="device-list__meta">
                  {t("devices.added", { date: formatDate(device.createdAt, i18n.language) })}
                  {" · "}
                  {device.lastUsedAt
                    ? t("devices.lastUsed", { date: formatDate(device.lastUsedAt, i18n.language) })
                    : t("devices.neverUsed")}
                </span>
              </div>
              <Button
                type="button"
                variant="destructive"
                size="sm"
                disabled={busyId !== null}
                onClick={() => void handleRevoke(device)}
                data-testid={`${testIdPrefix}-revoke`}
              >
                {busyId === device.id ? t("devices.revoking") : t("devices.revoke")}
              </Button>
            </li>
          ))}
        </ul>
      )}

      {error ? (
        <p className="ai-dialog__error" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}
