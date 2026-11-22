import { useState } from "react";
import { X } from "lucide-react";
import { useTranslation } from "react-i18next";

import { Button, buttonVariants } from "@/components/ui/button";
import { certificateState } from "@/lib/certificateExpiry";

import { CERTIFICATE_RENEW_URL, useServerCertificate } from "./useServerCertificate";

/** Closing the notice quiets it for a week, then it comes back until renewed. */
const SNOOZE_MS = 7 * 24 * 60 * 60 * 1000;
const STORAGE_KEY = "scribedog-certificate-notice";

type Snooze = { notAfter: string; until: number };

function readSnooze(): Snooze | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as Snooze) : null;
  } catch {
    return null;
  }
}

/**
 * Tells whoever uses the server edition that its certificate is about to run
 * out, with a link to the short renewal guide. Renewing means installing a
 * new CA on every device, so the notice comes early (see
 * CERTIFICATE_WARNING_DAYS) rather than on the day the browser starts
 * warning. A renewed certificate has a new end date, which is what the snooze
 * is keyed by, so closing the notice for one certificate never hides it for
 * the next.
 */
export function CertificateNotice() {
  const { t, i18n } = useTranslation();
  const certificate = useServerCertificate();
  const [snooze, setSnooze] = useState<Snooze | null>(readSnooze);

  if (!certificate?.notAfter) {
    return null;
  }

  const state = certificateState(certificate.notAfter);
  const notAfterKey = certificate.notAfter.toISOString();
  const isSnoozed = snooze?.notAfter === notAfterKey && snooze.until > Date.now();

  if (state.kind === "valid" || isSnoozed) {
    return null;
  }

  const dismiss = () => {
    const next = { notAfter: notAfterKey, until: Date.now() + SNOOZE_MS };
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    } catch {
      // Private mode: hidden for this page load only.
    }
    setSnooze(next);
  };

  return (
    <div className="update-notification" role="status" data-testid="certificate-notice">
      <div className="update-notification__header">
        <span className="update-notification__title">
          {t(state.kind === "expired" ? "certificateNotice.expiredTitle" : "certificateNotice.title")}
        </span>
        <Button type="button" variant="ghost" size="icon-xs" onClick={dismiss} aria-label={t("certificateNotice.dismiss")}>
          <X />
        </Button>
      </div>

      <div className="update-notification__body">
        {t(state.kind === "expired" ? "certificateNotice.expiredBody" : "certificateNotice.body", { date: state.notAfter.toLocaleDateString(i18n.language) })}
      </div>

      <div className="update-notification__actions">
        <a className={buttonVariants({ size: "sm" })} href={CERTIFICATE_RENEW_URL} target="_blank" rel="noreferrer">
          {t("certificateNotice.guide")}
        </a>
      </div>
    </div>
  );
}
