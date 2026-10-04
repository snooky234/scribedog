import { useEffect, useRef, useState, type FormEvent } from "react";
import { useTranslation } from "react-i18next";

import { Button } from "@/components/ui/button";
import { useDismissOnOverlayClick } from "@/hooks/useDismissOnOverlayClick";
import { addRemoteVault, defaultDeviceName, signInRemoteVault, type RemoteVaultEntry } from "@/lib/remoteVaults";
import { SessionError } from "@/platform";

/**
 * "add": a server the app does not know yet, asking for its address.
 * "signIn": a known server that refused this device's token (revoked, or
 * the password changed); the address is fixed and only the password is
 * asked for again.
 */
export type RemoteVaultDialogRequest =
  | { mode: "add" }
  | { mode: "signIn"; entry: RemoteVaultEntry };

type RemoteVaultDialogProps = {
  request: RemoteVaultDialogRequest | null;
  /** Called with the vault root once the token is stored. */
  onDone: (root: string) => void;
  onCancel: () => void;
};

/**
 * The one form behind "Add server vault…" and "Sign in again". The password
 * is held in component state for the single request that trades it for an
 * access token and is dropped with the dialog.
 */
export function RemoteVaultDialog({ request, onDone, onCancel }: RemoteVaultDialogProps) {
  const { t } = useTranslation();
  const [url, setUrl] = useState("");
  const [name, setName] = useState("");
  const [deviceName, setDeviceName] = useState("");
  const [password, setPassword] = useState("");
  const [isBusy, setIsBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const firstFieldRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!request) {
      return;
    }

    setUrl(request.mode === "signIn" ? request.entry.url : "");
    setName(request.mode === "signIn" ? request.entry.name : "");
    setDeviceName(defaultDeviceName());
    setPassword("");
    setError(null);
    setIsBusy(false);
    // Focus lands after the fields have rendered with their values.
    window.setTimeout(() => firstFieldRef.current?.focus(), 0);
  }, [request]);

  useEffect(() => {
    if (!request) {
      return;
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !isBusy) {
        event.preventDefault();
        onCancel();
      }
    };

    window.addEventListener("keydown", handleKeyDown);

    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [request, isBusy, onCancel]);

  if (!request) {
    return null;
  }

  const isSignIn = request.mode === "signIn";
  const canSubmit = !isBusy && password.length > 0 && (isSignIn || url.trim().length > 0);

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();

    if (!canSubmit) {
      return;
    }

    setIsBusy(true);
    setError(null);

    try {
      if (isSignIn) {
        await signInRemoteVault(request.entry.root, password, deviceName);
        onDone(request.entry.root);
      } else {
        const entry = await addRemoteVault({ url, password, name, deviceName });
        onDone(entry.root);
      }
    } catch (caught) {
      if (caught instanceof SessionError) {
        setError(
          caught.code === "invalid_password"
            ? t("remoteVaults.wrongPassword")
            : caught.code === "too_many_attempts"
              ? t("remoteVaults.tooManyAttempts")
              : t("remoteVaults.unreachable", { detail: caught.message })
        );
      } else {
        setError(caught instanceof Error ? caught.message : t("remoteVaults.addFailed"));
      }
    } finally {
      setIsBusy(false);
    }
  };

  const dismissProps = useDismissOnOverlayClick(isBusy ? null : onCancel);

  return (
    <div
      className="unsaved-dialog"
      role="presentation"
      {...dismissProps}
    >
      <form
        className="unsaved-dialog__panel remote-vault-dialog__panel"
        role="dialog"
        aria-modal="true"
        aria-labelledby="remote-vault-dialog-title"
        onClick={(event) => event.stopPropagation()}
        onSubmit={(event) => void handleSubmit(event)}
        data-testid="remote-vault-dialog"
      >
        <p className="unsaved-dialog__eyebrow">{t("remoteVaults.eyebrow")}</p>
        <h3 id="remote-vault-dialog-title">
          {isSignIn ? t("remoteVaults.signInTitle", { name: request.entry.name }) : t("remoteVaults.addTitle")}
        </h3>
        <p className="unsaved-dialog__description">
          {isSignIn ? t("remoteVaults.signInDescription") : t("remoteVaults.addDescription")}
        </p>

        <div className="remote-vault-dialog__fields">
          <label className="ai-dialog__field">
            <span>{t("remoteVaults.serverUrl")}</span>
            <input
              ref={isSignIn ? undefined : firstFieldRef}
              type="url"
              inputMode="url"
              autoComplete="url"
              placeholder="https://notes.example.com"
              value={url}
              disabled={isSignIn || isBusy}
              onChange={(event) => setUrl(event.target.value)}
              data-testid="remote-vault-url"
            />
          </label>

          <label className="ai-dialog__field">
            <span>{t("remoteVaults.password")}</span>
            <input
              ref={isSignIn ? firstFieldRef : undefined}
              type="password"
              autoComplete="current-password"
              value={password}
              disabled={isBusy}
              onChange={(event) => setPassword(event.target.value)}
              data-testid="remote-vault-password"
            />
          </label>

          {isSignIn ? null : (
            <label className="ai-dialog__field">
              <span>{t("remoteVaults.displayName")}</span>
              <input
                type="text"
                value={name}
                placeholder={t("remoteVaults.displayNamePlaceholder")}
                disabled={isBusy}
                onChange={(event) => setName(event.target.value)}
                data-testid="remote-vault-name"
              />
            </label>
          )}

          <label className="ai-dialog__field">
            <span>{t("remoteVaults.deviceName")}</span>
            <input
              type="text"
              value={deviceName}
              disabled={isBusy}
              onChange={(event) => setDeviceName(event.target.value)}
              data-testid="remote-vault-device"
            />
            <small className="ai-dialog__model-hint">{t("remoteVaults.deviceNameHint")}</small>
          </label>
        </div>

        {error ? (
          <p className="ai-dialog__error" role="alert" data-testid="remote-vault-error">
            {error}
          </p>
        ) : null}

        <div className="unsaved-dialog__actions">
          <Button type="button" variant="outline" disabled={isBusy} onClick={onCancel}>
            {t("remoteVaults.cancel")}
          </Button>
          <Button type="submit" disabled={!canSubmit} data-testid="remote-vault-submit">
            {isBusy
              ? t("remoteVaults.connecting")
              : isSignIn
                ? t("remoteVaults.signIn")
                : t("remoteVaults.add")}
          </Button>
        </div>
      </form>
    </div>
  );
}
