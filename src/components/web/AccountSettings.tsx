import { useState, type FormEvent } from "react";
import { useTranslation } from "react-i18next";

import { DeviceList } from "@/components/remote/DeviceList";
import { InfoPopover } from "@/components/settings/InfoPopover";
import { Button, buttonVariants } from "@/components/ui/button";
import { certificateState } from "@/lib/certificateExpiry";
import { platform, SessionError } from "@/platform";

import { CA_CERTIFICATE_PATH, CERTIFICATE_GUIDE_URL, CERTIFICATE_RENEW_URL, useServerCertificate } from "./useServerCertificate";

/**
 * The "Account" settings tab of the server edition: change the one password
 * that protects this instance. Hidden on the desktop, which has no session.
 *
 * Changing it ends every other session (the server bumps the session epoch,
 * so tokens issued before stop verifying) and re-encrypts the stored API keys
 * under the new password, which is why the form says both out loud rather
 * than leaving the user to find out on the next device.
 *
 * Below the form: the devices that hold an access token for this server
 * (desktop apps that opened this vault), each of which can be signed out on
 * its own without touching the password.
 *
 * Last, the server's CA certificate. Caddy serves it at the origin's root
 * (not under the base path, see server/caddy/Caddyfile), and the guide's
 * advice is to open that URL on the device in question; a link in the
 * settings is that, without typing the URL on a phone. Next to it, the date
 * it runs out, since renewing means installing a new one on every device.
 * The section only shows when the server hands out a certificate at all
 * (see useServerCertificate).
 */

export function AccountSettings() {
  const { t, i18n } = useTranslation();
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [repeatedPassword, setRepeatedPassword] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isDone, setIsDone] = useState(false);
  const certificate = useServerCertificate();
  const certificateStatus = certificate?.notAfter ? certificateState(certificate.notAfter) : null;

  const canSubmit = currentPassword.length > 0 && newPassword.length > 0 && !isSaving;

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();

    if (!canSubmit || !platform.session) {
      return;
    }

    if (newPassword !== repeatedPassword) {
      setError(t("account.mismatch"));
      setIsDone(false);
      return;
    }

    setIsSaving(true);
    setError(null);
    setIsDone(false);

    try {
      await platform.session.changePassword(currentPassword, newPassword);

      setCurrentPassword("");
      setNewPassword("");
      setRepeatedPassword("");
      setIsDone(true);
    } catch (caught) {
      setError(
        caught instanceof SessionError && caught.code === "invalid_password"
          ? t("account.wrongCurrentPassword")
          : caught instanceof Error
            ? caught.message
            : t("account.changeFailed")
      );
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <form className="ai-dialog__grid" onSubmit={(event) => void handleSubmit(event)}>
      <h3 className="ai-dialog__field--full">{t("account.changePassword")}</h3>
      <p className="ai-dialog__field--full ai-dialog__model-hint">{t("account.changePasswordHint")}</p>

      <label className="ai-dialog__field">
        <span>{t("account.currentPassword")}</span>
        <input
          type="password"
          autoComplete="current-password"
          value={currentPassword}
          onChange={(event) => setCurrentPassword(event.target.value)}
          disabled={isSaving}
          data-testid="current-password"
        />
      </label>

      <label className="ai-dialog__field">
        <span>{t("account.newPassword")}</span>
        <input
          type="password"
          autoComplete="new-password"
          value={newPassword}
          onChange={(event) => setNewPassword(event.target.value)}
          disabled={isSaving}
          data-testid="new-password"
        />
      </label>

      <label className="ai-dialog__field">
        <span>{t("account.repeatPassword")}</span>
        <input
          type="password"
          autoComplete="new-password"
          value={repeatedPassword}
          onChange={(event) => setRepeatedPassword(event.target.value)}
          disabled={isSaving}
          data-testid="repeat-password"
        />
      </label>

      {error ? (
        <p className="ai-dialog__field--full ai-dialog__error" role="alert">
          {error}
        </p>
      ) : null}

      {isDone ? (
        <p className="ai-dialog__field--full ai-dialog__model-hint" role="status" data-testid="password-changed">
          {t("account.changed")}
        </p>
      ) : null}

      <div className="ai-dialog__field--full">
        <Button type="submit" disabled={!canSubmit} data-testid="change-password">
          {isSaving ? t("account.changing") : t("account.changePassword")}
        </Button>
      </div>

      <h3 className="ai-dialog__field--full">{t("account.devices")}</h3>
      <p className="ai-dialog__field--full ai-dialog__model-hint">{t("account.devicesHint")}</p>
      <div className="ai-dialog__field--full">
        <DeviceList
          load={() => platform.session?.listDevices() ?? Promise.resolve([])}
          revoke={(id) => platform.session?.revokeDevice(id) ?? Promise.resolve()}
        />
      </div>

      {certificate ? (
        <>
          <div className="ai-dialog__field--full account-settings__head">
            <h3>{t("account.certificate")}</h3>
            <InfoPopover
              text={t("account.certificateInfo")}
              link={{ href: CERTIFICATE_GUIDE_URL, label: t("account.certificateGuide") }}
            />
          </div>
          <p className="ai-dialog__field--full ai-dialog__model-hint">{t("account.certificateHint")}</p>
          {certificateStatus ? (
            <p
              className={
                certificateStatus.kind === "valid"
                  ? "ai-dialog__field--full ai-dialog__model-hint"
                  : "ai-dialog__field--full ai-dialog__error"
              }
              role={certificateStatus.kind === "valid" ? undefined : "alert"}
              data-testid="certificate-validity"
            >
              {t(
                certificateStatus.kind === "expired"
                  ? "account.certificateExpired"
                  : certificateStatus.kind === "expiring"
                    ? "account.certificateExpiring"
                    : "account.certificateValidUntil",
                { date: certificateStatus.notAfter.toLocaleDateString(i18n.language) }
              )}{" "}
              {certificateStatus.kind !== "valid" ? (
                <a className="underline underline-offset-2" href={CERTIFICATE_RENEW_URL} target="_blank" rel="noreferrer">
                  {t("account.certificateRenewGuide")}
                </a>
              ) : null}
            </p>
          ) : null}
          <div className="ai-dialog__field--full">
            <a
              className={buttonVariants({ variant: "outline" })}
              href={CA_CERTIFICATE_PATH}
              download="scribedog-ca.crt"
              data-testid="download-ca-certificate"
            >
              {t("account.certificateDownload")}
            </a>
          </div>
        </>
      ) : null}
    </form>
  );
}
