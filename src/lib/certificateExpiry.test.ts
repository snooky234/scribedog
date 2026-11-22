import { X509Certificate } from "node:crypto";
import { describe, expect, it } from "vitest";

// @ts-expect-error The server's certificate script is plain JavaScript without type declarations.
import { createCertificates } from "../../server/scripts/make-certs.mjs";

import { CERTIFICATE_WARNING_DAYS, certificateState, readCertificateNotAfter } from "./certificateExpiry";

type Created = { caPem: string; serverPem: string };

const DAY_MS = 24 * 60 * 60 * 1000;

describe("readCertificateNotAfter", () => {
  it("reads the end date of the CA the server's script creates", () => {
    const { caPem } = createCertificates({ ips: ["192.168.1.50"], hosts: [] }) as Created;
    const expected = new Date(new X509Certificate(caPem).validTo);

    expect(readCertificateNotAfter(caPem)?.getTime()).toBe(expected.getTime());
  });

  it("reads a GeneralizedTime (dates from 2050 on)", () => {
    const now = new Date("2049-06-01T00:00:00Z");
    const { caPem } = createCertificates({ ips: ["192.168.1.50"], hosts: [], days: 825, now }) as Created;

    expect(readCertificateNotAfter(caPem)?.toISOString()).toBe(new Date(now.getTime() + 825 * DAY_MS).toISOString());
  });

  it("returns null for anything that is not a certificate", () => {
    expect(readCertificateNotAfter("")).toBeNull();
    expect(readCertificateNotAfter("<!doctype html><html></html>")).toBeNull();
    expect(readCertificateNotAfter("-----BEGIN CERTIFICATE-----\nAAAA\n-----END CERTIFICATE-----")).toBeNull();
  });
});

describe("certificateState", () => {
  const now = new Date("2027-01-01T12:00:00Z");
  const inDays = (days: number) => new Date(now.getTime() + days * DAY_MS);

  it("stays quiet while there is time", () => {
    expect(certificateState(inDays(CERTIFICATE_WARNING_DAYS + 1), now).kind).toBe("valid");
  });

  it("warns within the warning window", () => {
    expect(certificateState(inDays(CERTIFICATE_WARNING_DAYS - 1), now)).toMatchObject({
      kind: "expiring",
      daysLeft: CERTIFICATE_WARNING_DAYS - 1
    });
    expect(certificateState(inDays(0.5), now)).toMatchObject({ kind: "expiring", daysLeft: 0 });
  });

  it("says so once the date has passed", () => {
    expect(certificateState(inDays(-1), now).kind).toBe("expired");
    expect(certificateState(now, now).kind).toBe("expired");
  });
});
