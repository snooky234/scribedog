/**
 * When the server's certificate runs out, read from the CA certificate the
 * server edition hands out at /scribedog-ca.crt.
 *
 * The CA made by the server's certificate script lives exactly as long as
 * its one server certificate (its key is gone, it can never sign another),
 * so its "not after" date is the date both stop working. Renewing means a
 * new CA on every device, which is why the app says so ahead of time rather
 * than leaving the user to meet a browser warning on the day.
 *
 * A minimal DER walk rather than a certificate library: only the validity
 * field is needed, and it sits at a fixed position in every X.509 certificate.
 */

/** How long before the end the app starts pointing at the renewal guide. */
export const CERTIFICATE_WARNING_DAYS = 60;

const DAY_MS = 24 * 60 * 60 * 1000;

export type CertificateState =
  | { kind: "valid"; notAfter: Date; daysLeft: number }
  | { kind: "expiring"; notAfter: Date; daysLeft: number }
  | { kind: "expired"; notAfter: Date; daysLeft: number };

function pemToDer(pem: string): Uint8Array | null {
  const match = /-----BEGIN CERTIFICATE-----([\s\S]*?)-----END CERTIFICATE-----/.exec(pem);
  if (!match) {
    return null;
  }

  try {
    const binary = atob(match[1].replace(/\s+/g, ""));
    return Uint8Array.from(binary, (char) => char.charCodeAt(0));
  } catch {
    return null;
  }
}

type Element = { tag: number; start: number; end: number };

/** Reads the tag and length at `offset`; `start`/`end` delimit the content. */
function readElement(der: Uint8Array, offset: number): Element | null {
  if (offset + 2 > der.length) {
    return null;
  }

  const tag = der[offset];
  let size = der[offset + 1];
  let start = offset + 2;

  if (size & 0x80) {
    const count = size & 0x7f;
    if (count === 0 || count > 4 || start + count > der.length) {
      return null;
    }
    size = 0;
    for (let i = 0; i < count; i++) {
      size = size * 256 + der[start + i];
    }
    start += count;
  }

  const end = start + size;
  return end <= der.length ? { tag, start, end } : null;
}

function readTime(der: Uint8Array, element: Element): Date | null {
  const text = String.fromCharCode(...der.subarray(element.start, element.end));
  let digits: string;

  if (element.tag === 0x17) {
    // UTCTime, YYMMDDHHMMSSZ; RFC 5280: 50-99 are 19xx, 00-49 are 20xx.
    const match = /^(\d{2})(\d{10})Z$/.exec(text);
    if (!match) return null;
    digits = `${Number(match[1]) >= 50 ? "19" : "20"}${match[1]}${match[2]}`;
  } else if (element.tag === 0x18) {
    const match = /^(\d{14})Z$/.exec(text);
    if (!match) return null;
    digits = match[1];
  } else {
    return null;
  }

  const date = new Date(
    Date.UTC(
      Number(digits.slice(0, 4)),
      Number(digits.slice(4, 6)) - 1,
      Number(digits.slice(6, 8)),
      Number(digits.slice(8, 10)),
      Number(digits.slice(10, 12)),
      Number(digits.slice(12, 14))
    )
  );
  return Number.isNaN(date.getTime()) ? null : date;
}

/** The "not after" date of a PEM certificate, or null if it cannot be read. */
export function readCertificateNotAfter(pem: string): Date | null {
  const der = pemToDer(pem);
  if (!der) {
    return null;
  }

  // Certificate ::= SEQUENCE { tbsCertificate SEQUENCE { [0] version?,
  //   serialNumber, signature, issuer, validity SEQUENCE { notBefore, notAfter }, ... } }
  const certificate = readElement(der, 0);
  if (!certificate || certificate.tag !== 0x30) return null;
  const tbs = readElement(der, certificate.start);
  if (!tbs || tbs.tag !== 0x30) return null;

  let offset = tbs.start;
  const first = readElement(der, offset);
  if (!first) return null;
  if (first.tag === 0xa0) {
    offset = first.end;
  }

  // serialNumber, signature, issuer
  for (let skip = 0; skip < 3; skip++) {
    const element = readElement(der, offset);
    if (!element) return null;
    offset = element.end;
  }

  const validity = readElement(der, offset);
  if (!validity || validity.tag !== 0x30) return null;
  const notBefore = readElement(der, validity.start);
  if (!notBefore) return null;
  const notAfter = readElement(der, notBefore.end);
  return notAfter ? readTime(der, notAfter) : null;
}

/** Whether to say nothing, point at the renewal, or say it has run out. */
export function certificateState(notAfter: Date, now: Date = new Date()): CertificateState {
  const daysLeft = Math.floor((notAfter.getTime() - now.getTime()) / DAY_MS);

  if (notAfter.getTime() <= now.getTime()) {
    return { kind: "expired", notAfter, daysLeft };
  }
  if (daysLeft < CERTIFICATE_WARNING_DAYS) {
    return { kind: "expiring", notAfter, daysLeft };
  }
  return { kind: "valid", notAfter, daysLeft };
}
