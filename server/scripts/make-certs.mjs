#!/usr/bin/env node
// Creates the certificate authority and the server certificate for ScribeDog
// on a home network, where there is no public domain to get a certificate for.
//
//   docker compose run --rm certificates                 (addresses from .env)
//   docker compose run --rm certificates 192.168.1.50 nas.fritz.box
//   node scripts/make-certs.mjs 192.168.1.50 [--out certs] [--days 825]
//
// Writes ca.crt (installed on every device), server.crt and server.key (read
// by Caddy) and prints the CA's SHA-256 fingerprint to compare on the device.
//
// What makes this safer than a regular local CA, and why it is built by hand:
//
// - The CA's private key only ever exists in this process's memory. It signs
//   exactly one server certificate and is then dropped; it is never written
//   anywhere. Whoever later breaks into the server finds no key that could
//   issue a certificate for anything else, so installing ca.crt on a phone
//   does not hand the server the power to impersonate the user's bank.
//   The flip side: renewing means a new CA on every device.
// - The CA carries a critical Name Constraints extension that permits only the
//   addresses of this installation (IPs as /32 or /128, the given host names,
//   and "app.invalid" when there are none, because without a DNS subtree host
//   names would not be constrained at all). Windows, macOS, Firefox, OpenSSL
//   and rustls enforce it; Android does not for a user-installed root, which
//   RFC 5280 permits. It is the second line of defence, the discarded key is
//   the first.
// - No dependencies and no openssl: Node's crypto creates the keys and the
//   signatures, the certificate structure (DER) is assembled below. An
//   openssl call would need the key in a file.
//
// The CA is valid exactly as long as the server certificate, since without its
// key it can never sign another one. 825 days is the most iOS accepts for a
// server certificate.

import { createHash, generateKeyPairSync, randomBytes, sign, X509Certificate } from "node:crypto";
import { chmodSync, chownSync, mkdirSync, writeFileSync } from "node:fs";
import { isIP } from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const MAX_DAYS = 825;
const PLACEHOLDER_HOST = "app.invalid";

// ---------------------------------------------------------------------------
// DER encoding, only the handful of types an X.509 certificate needs.

function length(n) {
  if (n < 0x80) return Buffer.from([n]);
  const bytes = [];
  for (let rest = n; rest > 0; rest >>= 8) bytes.unshift(rest & 0xff);
  return Buffer.from([0x80 | bytes.length, ...bytes]);
}

function tlv(tag, ...parts) {
  const content = Buffer.concat(parts);
  return Buffer.concat([Buffer.from([tag]), length(content.length), content]);
}

const sequence = (...parts) => tlv(0x30, ...parts);
const set = (...parts) => tlv(0x31, ...parts);
const octetString = (bytes) => tlv(0x04, bytes);
const bitString = (bytes, unusedBits = 0) => tlv(0x03, Buffer.from([unusedBits]), bytes);
const booleanTrue = () => tlv(0x01, Buffer.from([0xff]));
const utf8String = (text) => tlv(0x0c, Buffer.from(text, "utf8"));

function integer(bytes) {
  let value = Buffer.from(bytes);
  while (value.length > 1 && value[0] === 0 && (value[1] & 0x80) === 0) value = value.subarray(1);
  if (value[0] & 0x80) value = Buffer.concat([Buffer.from([0]), value]);
  return tlv(0x02, value);
}

function oid(dotted) {
  const [first, second, ...rest] = dotted.split(".").map(Number);
  const bytes = [40 * first + second];
  for (const arc of rest) {
    const chunk = [arc & 0x7f];
    for (let value = arc >> 7; value > 0; value >>= 7) chunk.unshift((value & 0x7f) | 0x80);
    bytes.push(...chunk);
  }
  return tlv(0x06, Buffer.from(bytes));
}

/** UTCTime up to 2049, GeneralizedTime after, as RFC 5280 requires. */
function time(date) {
  const iso = date.toISOString().replace(/[-:T]/g, "").slice(0, 14) + "Z";
  return date.getUTCFullYear() < 2050 ? tlv(0x17, Buffer.from(iso.slice(2))) : tlv(0x18, Buffer.from(iso));
}

const OID = {
  commonName: "2.5.4.3",
  organization: "2.5.4.10",
  ecdsaWithSha256: "1.2.840.10045.4.3.2",
  subjectKeyIdentifier: "2.5.29.14",
  keyUsage: "2.5.29.15",
  subjectAltName: "2.5.29.17",
  basicConstraints: "2.5.29.19",
  nameConstraints: "2.5.29.30",
  authorityKeyIdentifier: "2.5.29.35",
  extKeyUsage: "2.5.29.37",
  serverAuth: "1.3.6.1.5.5.7.3.1"
};

const name = (commonName) =>
  sequence(
    set(sequence(oid(OID.organization), utf8String("ScribeDog"))),
    set(sequence(oid(OID.commonName), utf8String(commonName)))
  );

const extension = (id, critical, value) =>
  critical ? sequence(oid(id), booleanTrue(), octetString(value)) : sequence(oid(id), octetString(value));

// GeneralName: dNSName [2] IA5String, iPAddress [7] OCTET STRING.
const dnsName = (host) => tlv(0x82, Buffer.from(host, "ascii"));
const ipAddress = (bytes) => tlv(0x87, bytes);

// ---------------------------------------------------------------------------
// Addresses

function ipBytes(address) {
  if (isIP(address) === 4) return Buffer.from(address.split(".").map(Number));

  const [head, tail = ""] = address.split("::");
  const groups = (part) => (part ? part.split(":") : []);
  let left = groups(head);
  let right = groups(tail);
  // An embedded IPv4 tail (::ffff:192.0.2.1) counts as two groups.
  const last = (address.includes("::") ? right : left).at(-1);
  if (last && last.includes(".")) {
    const v4 = ipBytes(last);
    const extra = [v4.readUInt16BE(0).toString(16), v4.readUInt16BE(2).toString(16)];
    if (address.includes("::")) right = [...right.slice(0, -1), ...extra];
    else left = [...left.slice(0, -1), ...extra];
  }
  const all = address.includes("::")
    ? [...left, ...Array(8 - left.length - right.length).fill("0"), ...right]
    : left;
  const bytes = Buffer.alloc(16);
  all.forEach((group, index) => bytes.writeUInt16BE(parseInt(group, 16), index * 2));
  return bytes;
}

/**
 * Turns what a user may type (or what SCRIBEDOG_SITE_ADDRESS holds: a list,
 * with scheme or port) into plain IPs and host names. Wildcards are refused:
 * the whole point is a certificate for this one installation.
 */
export function parseAddresses(inputs) {
  const ips = [];
  const hosts = [];

  for (const raw of inputs.flatMap((input) => String(input).split(/[\s,]+/))) {
    let value = raw.trim().toLowerCase();
    if (!value) continue;
    value = value.replace(/^[a-z][a-z0-9+.-]*:\/\//, "").replace(/\/.*$/, "");

    const bracketed = /^\[([^\]]+)\](?::\d+)?$/.exec(value);
    if (bracketed) value = bracketed[1];
    else if (isIP(value) !== 6) value = value.replace(/:\d+$/, "");

    if (isIP(value)) {
      if (!ips.includes(value)) ips.push(value);
      continue;
    }
    if (value.includes("*")) {
      throw new Error(`"${raw}": wildcards are not allowed, name the exact address instead.`);
    }
    if (!/^(?=.{1,253}$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)(\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)*\.?$/.test(value)) {
      throw new Error(`"${raw}" is neither an IP address nor a host name.`);
    }
    value = value.replace(/\.$/, "");
    if (!hosts.includes(value)) hosts.push(value);
  }

  if (ips.length === 0 && hosts.length === 0) {
    throw new Error("No address given. Name the IP address or host name the devices use to open ScribeDog.");
  }
  return { ips, hosts };
}

// ---------------------------------------------------------------------------
// Certificates

function serialNumber() {
  const bytes = randomBytes(16);
  bytes[0] &= 0x7f;
  bytes[0] |= 0x01;
  return integer(bytes);
}

function certificate({ subject, issuer, publicKeyDer, notBefore, notAfter, extensions, signingKey }) {
  const algorithm = sequence(oid(OID.ecdsaWithSha256));
  const tbs = sequence(
    tlv(0xa0, integer(Buffer.from([2]))),
    serialNumber(),
    algorithm,
    issuer,
    sequence(time(notBefore), time(notAfter)),
    subject,
    publicKeyDer,
    tlv(0xa3, sequence(...extensions))
  );
  const signature = sign("sha256", tbs, signingKey);
  return sequence(tbs, algorithm, bitString(signature));
}

function toPem(der, label) {
  const base64 = der.toString("base64").replace(/.{1,64}/g, "$&\n");
  return `-----BEGIN ${label}-----\n${base64}-----END ${label}-----\n`;
}

/** SHA-1 over the subjectPublicKey bits, the usual key identifier (RFC 5280 4.2.1.2). */
function keyIdentifier(spkiDer) {
  const key = new X509PublicKeyBits(spkiDer).bits;
  return createHash("sha1").update(key).digest();
}

/** Reads the BIT STRING out of a SubjectPublicKeyInfo without a full parser. */
class X509PublicKeyBits {
  constructor(spki) {
    let offset = 0;
    const header = () => {
      offset += 1;
      let size = spki[offset++];
      if (size & 0x80) {
        const count = size & 0x7f;
        size = 0;
        for (let i = 0; i < count; i++) size = (size << 8) | spki[offset++];
      }
      return size;
    };
    header(); // outer SEQUENCE
    offset += header(); // AlgorithmIdentifier, skipped
    const size = header(); // BIT STRING
    this.bits = spki.subarray(offset + 1, offset + size);
  }
}

/**
 * A CA that lives in memory only. Its private key is held in this closure and
 * never handed out; dropping the returned object is what "discarding the key"
 * means. Only the tests ever call `issue` more than once (to prove that a
 * certificate for a foreign address is rejected).
 */
export function createAuthority({ ips, hosts, notBefore, notAfter, now = new Date() }) {
  const ca = generateKeyPairSync("ec", { namedCurve: "P-256" });
  const caSpki = ca.publicKey.export({ type: "spki", format: "der" });
  const caKeyId = keyIdentifier(caSpki);

  const label = [...ips, ...hosts].join(", ");
  const stamp = now.toISOString().slice(0, 10);
  const caName = name(`ScribeDog CA ${label} ${stamp}`);

  const permitted = [
    ...ips.map((ip) => {
      const bytes = ipBytes(ip);
      return sequence(ipAddress(Buffer.concat([bytes, Buffer.alloc(bytes.length, 0xff)])));
    }),
    ...(hosts.length > 0 ? hosts : [PLACEHOLDER_HOST]).map((host) => sequence(dnsName(host)))
  ];

  const caDer = certificate({
    subject: caName,
    issuer: caName,
    publicKeyDer: caSpki,
    notBefore,
    notAfter,
    signingKey: ca.privateKey,
    extensions: [
      extension(OID.basicConstraints, true, sequence(booleanTrue(), integer(Buffer.from([0])))),
      // keyCertSign (bit 5) and cRLSign (bit 6).
      extension(OID.keyUsage, true, bitString(Buffer.from([0x06]), 1)),
      extension(OID.subjectKeyIdentifier, false, octetString(caKeyId)),
      extension(OID.nameConstraints, true, sequence(tlv(0xa0, ...permitted)))
    ]
  });

  const caPem = toPem(caDer, "CERTIFICATE");

  /** Signs a server certificate for exactly these addresses. */
  const issue = (target) => {
    const server = generateKeyPairSync("ec", { namedCurve: "P-256" });
    const serverSpki = server.publicKey.export({ type: "spki", format: "der" });
    const serverLabel = [...target.ips, ...target.hosts].join(", ");
    const sans = [...target.ips.map((ip) => ipAddress(ipBytes(ip))), ...target.hosts.map(dnsName)];

    const serverDer = certificate({
      subject: name(`ScribeDog ${serverLabel}`),
      issuer: caName,
      publicKeyDer: serverSpki,
      notBefore,
      notAfter,
      signingKey: ca.privateKey,
      extensions: [
        extension(OID.basicConstraints, true, sequence()),
        // digitalSignature (bit 0).
        extension(OID.keyUsage, true, bitString(Buffer.from([0x80]), 7)),
        extension(OID.extKeyUsage, false, sequence(oid(OID.serverAuth))),
        extension(OID.subjectAltName, false, sequence(...sans)),
        extension(OID.subjectKeyIdentifier, false, octetString(keyIdentifier(serverSpki))),
        extension(OID.authorityKeyIdentifier, false, sequence(tlv(0x80, caKeyId)))
      ]
    });

    return {
      serverPem: toPem(serverDer, "CERTIFICATE"),
      serverKeyPem: server.privateKey.export({ type: "pkcs8", format: "pem" })
    };
  };

  return { caPem, fingerprint: new X509Certificate(caPem).fingerprint256, issue };
}

/**
 * Creates the CA and its one server certificate, checks both and returns the
 * PEM text. The CA goes out of scope when this returns, key included.
 */
export function createCertificates({ ips, hosts, days = MAX_DAYS, now = new Date() }) {
  if (!Number.isInteger(days) || days < 1 || days > MAX_DAYS) {
    throw new Error(`Validity must be between 1 and ${MAX_DAYS} days (the limit of iOS).`);
  }

  // A little slack backwards for devices whose clock runs behind.
  const notBefore = new Date(now.getTime() - 60 * 60 * 1000);
  const notAfter = new Date(now.getTime() + days * 24 * 60 * 60 * 1000);

  const authority = createAuthority({ ips, hosts, notBefore, notAfter, now });
  const { serverPem, serverKeyPem } = authority.issue({ ips, hosts });
  verifyCertificates(authority.caPem, serverPem, { ips, hosts });

  return { caPem: authority.caPem, serverPem, serverKeyPem, fingerprint: authority.fingerprint, notAfter };
}

/** The self-check: signatures, roles and every address, read back by Node's own X.509 parser. */
export function verifyCertificates(caPem, serverPem, { ips, hosts }) {
  const ca = new X509Certificate(caPem);
  const server = new X509Certificate(serverPem);
  const fail = (what) => {
    throw new Error(`Self-check failed: ${what}. Nothing was written.`);
  };

  if (!ca.ca) fail("the CA certificate is not marked as a CA");
  if (server.ca) fail("the server certificate is marked as a CA");
  if (!ca.verify(ca.publicKey)) fail("the CA signature does not verify");
  if (!server.verify(ca.publicKey)) fail("the server certificate is not signed by the CA");
  if (!server.checkIssued(ca)) fail("the server certificate does not name the CA as its issuer");
  for (const ip of ips) if (!server.checkIP(ip)) fail(`the server certificate does not cover ${ip}`);
  for (const host of hosts) {
    if (!server.checkHost(host, { wildcards: false })) fail(`the server certificate does not cover ${host}`);
  }
}

// ---------------------------------------------------------------------------
// Command line

function parseArguments(argv) {
  const options = { out: null, days: MAX_DAYS, addresses: [] };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--out") options.out = argv[++i];
    else if (arg === "--days") options.days = Number(argv[++i]);
    else if (arg === "--help" || arg === "-h") options.help = true;
    else if (arg.startsWith("--")) throw new Error(`Unknown option ${arg}.`);
    else options.addresses.push(arg);
  }
  return options;
}

function writeFiles(directory, result) {
  mkdirSync(directory, { recursive: true });
  const write = (file, content, mode) => {
    const target = path.join(directory, file);
    writeFileSync(target, content, { mode });
    // writeFileSync only applies the mode to a new file; a renewal overwrites.
    chmodSync(target, mode);
    return target;
  };

  const caFile = write("ca.crt", result.caPem, 0o644);
  const serverFile = write("server.crt", result.serverPem, 0o644);
  write("server.key", result.serverKeyPem, 0o600);

  // Run as root in a container: hand the public files and the folder to the
  // user the stack runs as, so they can be read and replaced without sudo.
  // The key stays root's (Caddy runs as root), readable by nobody else.
  const uid = Number(process.env.PUID);
  const gid = Number(process.env.PGID);
  if (process.getuid?.() === 0 && Number.isInteger(uid) && Number.isInteger(gid) && process.env.PUID) {
    for (const target of [directory, caFile, serverFile]) chownSync(target, uid, gid);
  }
}

function main() {
  const options = parseArguments(process.argv.slice(2));
  const scriptDir = path.dirname(fileURLToPath(import.meta.url));

  if (options.help) {
    console.log("Usage: make-certs.mjs [address ...] [--out <dir>] [--days <1-825>]");
    console.log("Without addresses, SCRIBEDOG_SITE_ADDRESS is used.");
    return;
  }

  const inputs = options.addresses.length > 0 ? options.addresses : [process.env.SCRIBEDOG_SITE_ADDRESS ?? ""];
  const { ips, hosts } = parseAddresses(inputs);
  const outDir = path.resolve(options.out ?? path.join(scriptDir, "..", "certs"));

  const result = createCertificates({ ips, hosts, days: options.days });
  writeFiles(outDir, result);

  const until = result.notAfter.toISOString().slice(0, 10);
  console.log(`
Certificate created for: ${[...ips, ...hosts].join(", ")}
Valid until:             ${until}
Written to:              ${outDir}  (ca.crt, server.crt, server.key)

CA fingerprint (SHA-256), compare it on every device after installing ca.crt:
  ${result.fingerprint}

The CA's private key was never written anywhere and is gone now: nobody,
you included, can issue another certificate with this CA.

Next: docker compose up -d   (after a renewal: docker compose restart caddy)
Then install ca.crt on every device: https://<this address>/scribedog-ca.crt
or http://<this address>/scribedog-ca.crt, and remove the previous one.
`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    main();
  } catch (error) {
    console.error(`make-certs: ${error instanceof Error ? error.message : error}`);
    process.exit(1);
  }
}
