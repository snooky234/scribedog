import { useEffect, useState } from "react";

import { readCertificateNotAfter } from "@/lib/certificateExpiry";
import { platform } from "@/platform";

/**
 * Where Caddy serves this installation's CA certificate, host-wide, whatever
 * the base path (see server/caddy/Caddyfile).
 */
export const CA_CERTIFICATE_PATH = "/scribedog-ca.crt";

/** The guide: installing the CA on each device, and renewing it. */
export const CERTIFICATE_GUIDE_URL = "https://github.com/snooky234/scribedog/blob/main/server/docs/certificates.md";
export const CERTIFICATE_RENEW_URL = `${CERTIFICATE_GUIDE_URL}#renewing-the-certificate`;

export type ServerCertificate = { notAfter: Date | null };

/**
 * The server's CA certificate, if it hands one out: null behind another
 * reverse proxy or with a Let's Encrypt certificate (404), and under
 * `vite dev`, where the SPA fallback answers with index.html. Only asked on
 * platforms with a server session; the desktop has none.
 */
export function useServerCertificate(): ServerCertificate | null {
  const [certificate, setCertificate] = useState<ServerCertificate | null>(null);

  useEffect(() => {
    if (!platform.features.session) {
      return;
    }

    const controller = new AbortController();

    void (async () => {
      try {
        const response = await fetch(CA_CERTIFICATE_PATH, { credentials: "same-origin", signal: controller.signal });
        const contentType = response.headers.get("content-type") ?? "";

        if (!response.ok || contentType.startsWith("text/html")) {
          return;
        }

        const pem = await response.text();
        if (!controller.signal.aborted && pem.includes("BEGIN CERTIFICATE")) {
          setCertificate({ notAfter: readCertificateNotAfter(pem) });
        }
      } catch {
        // Offline or aborted: nothing to show.
      }
    })();

    return () => controller.abort();
  }, []);

  return certificate;
}
