import { execFileSync } from "node:child_process";
import { X509Certificate } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import https from "node:https";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";

// @ts-expect-error The script is plain JavaScript, run with node directly; it has no type declarations.
import { createAuthority, createCertificates, MAX_DAYS, parseAddresses } from "../scripts/make-certs.mjs";

type Authority = {
  caPem: string;
  issue(target: { ips: string[]; hosts: string[] }): { serverPem: string; serverKeyPem: string };
};

const IP = "192.168.1.50";
const HOST = "nas.example.test";
const now = new Date();
const window = { notBefore: new Date(now.getTime() - 3_600_000), notAfter: new Date(now.getTime() + 86_400_000) };

const workDir = mkdtempSync(path.join(tmpdir(), "scribedog-certs-"));
afterAll(() => rmSync(workDir, { recursive: true, force: true }));

function write(name: string, content: string): string {
  const file = path.join(workDir, name);
  writeFileSync(file, content);
  return file;
}

function hasOpenssl(): boolean {
  try {
    execFileSync("openssl", ["version"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

/** `openssl verify` output, success or failure alike. */
function opensslVerify(caFile: string, certFile: string): string {
  try {
    return execFileSync("openssl", ["verify", "-x509_strict", "-CAfile", caFile, certFile], { encoding: "utf8", stdio: "pipe" });
  } catch (error) {
    const failed = error as { stdout?: string; stderr?: string };
    return `${failed.stdout ?? ""}${failed.stderr ?? ""}`;
  }
}

describe("parseAddresses", () => {
  it("reads IPs and host names from a site address list with schemes and ports", () => {
    expect(parseAddresses(["https://NAS.example.test:8443, 192.168.1.50:443 [2001:db8::5]:9443"])).toEqual({
      ips: ["192.168.1.50", "2001:db8::5"],
      hosts: ["nas.example.test"]
    });
  });

  it("refuses wildcards, garbage and an empty list", () => {
    expect(() => parseAddresses(["*.example.test"])).toThrow(/wildcard/);
    expect(() => parseAddresses(["not a host!"])).toThrow(/neither/);
    expect(() => parseAddresses([""])).toThrow(/No address/);
  });
});

describe("createCertificates", () => {
  it("issues a CA with critical name constraints and a server certificate for exactly the given addresses", () => {
    const result = createCertificates({ ips: [IP], hosts: [HOST] });
    const ca = new X509Certificate(result.caPem);
    const server = new X509Certificate(result.serverPem);

    expect(ca.ca).toBe(true);
    expect(server.ca).toBe(false);
    expect(server.verify(ca.publicKey)).toBe(true);
    expect(server.checkIP(IP)).toBe(IP);
    expect(server.checkHost(HOST)).toBe(HOST);
    expect(server.checkIP("192.168.1.51")).toBeUndefined();
    expect(server.subjectAltName).not.toContain("*");
    expect(result.fingerprint).toBe(ca.fingerprint256);
    // The CA lives exactly as long as its only certificate.
    expect(ca.validTo).toBe(server.validTo);
  });

  it("caps the validity at the iOS limit", () => {
    expect(() => createCertificates({ ips: [IP], hosts: [], days: MAX_DAYS + 1 })).toThrow(/825/);
    const result = createCertificates({ ips: [IP], hosts: [], days: MAX_DAYS });
    const days = (Date.parse(new X509Certificate(result.serverPem).validTo) - Date.now()) / 86_400_000;
    expect(days).toBeLessThanOrEqual(MAX_DAYS);
  });
});

describe.runIf(hasOpenssl())("name constraints, checked by openssl verify", () => {
  const authority = createAuthority({ ips: [IP], hosts: [HOST], ...window, now }) as Authority;
  const caFile = write("ca.crt", authority.caPem);

  it("accepts the server certificate for the permitted addresses", () => {
    const certFile = write("own.crt", authority.issue({ ips: [IP], hosts: [HOST] }).serverPem);
    expect(opensslVerify(caFile, certFile)).toMatch(/: OK/);
  });

  it("rejects a certificate for a foreign IP", () => {
    const certFile = write("foreign-ip.crt", authority.issue({ ips: ["192.0.2.99"], hosts: [] }).serverPem);
    expect(opensslVerify(caFile, certFile)).toMatch(/permitted subtree violation/);
  });

  it("rejects a certificate for a foreign host name", () => {
    const certFile = write("foreign-host.crt", authority.issue({ ips: [], hosts: ["bank.example"] }).serverPem);
    expect(opensslVerify(caFile, certFile)).toMatch(/permitted subtree violation/);
  });

  it("constrains host names even when only an IP was given", () => {
    const ipOnly = createAuthority({ ips: [IP], hosts: [], ...window, now }) as Authority;
    const ipOnlyCa = write("ip-only-ca.crt", ipOnly.caPem);
    const certFile = write("ip-only-foreign-host.crt", ipOnly.issue({ ips: [], hosts: ["bank.example"] }).serverPem);
    expect(opensslVerify(ipOnlyCa, certFile)).toMatch(/permitted subtree violation/);
  });
});

// Over a named pipe or a Unix socket rather than TCP: virus scanners such as
// Avast intercept TLS on TCP connections, even to localhost, and present
// their own certificate, which would make this test meaningless.
describe("HTTPS with the generated files", () => {
  let pipeCounter = 0;
  const socketPath = () =>
    process.platform === "win32"
      ? `\\\\.\\pipe\\scribedog-certs-${process.pid}-${++pipeCounter}`
      : path.join(workDir, `https-${++pipeCounter}.sock`);

  async function request(server: { serverPem: string; serverKeyPem: string }, caPem: string, host: string) {
    const listener = https.createServer({ cert: server.serverPem, key: server.serverKeyPem }, (_req, res) => res.end("ok"));
    const where = socketPath();
    await new Promise<void>((resolve) => listener.listen(where, resolve));

    try {
      return await new Promise<string>((resolve) => {
        const req = https.request({ socketPath: where, host, path: "/", ca: caPem, agent: false }, (res) => {
          res.resume();
          res.on("end", () => resolve(`status ${res.statusCode}`));
        });
        // Node has no code of its own for a name constraint violation
        // ("UNSPECIFIED"); OpenSSL's reason is in the message.
        req.on("error", (error: NodeJS.ErrnoException) => resolve(`error ${error.code}: ${error.message}`));
        req.end();
      });
    } finally {
      await new Promise<void>((resolve) => listener.close(() => resolve()));
    }
  }

  const authority = createAuthority({ ips: [IP], hosts: [], ...window, now }) as Authority;

  it("connects with the CA as the only trusted root", async () => {
    expect(await request(authority.issue({ ips: [IP], hosts: [] }), authority.caPem, IP)).toBe("status 200");
  });

  it("refuses a certificate the CA was not permitted to issue", async () => {
    const result = await request(authority.issue({ ips: ["192.0.2.99"], hosts: [] }), authority.caPem, "192.0.2.99");
    expect(result).toMatch(/^error .*permitted subtree violation/);
  });
});
