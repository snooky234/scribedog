import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

/**
 * Which plain-http addresses the LLM proxy may be allowed to reach: machines in
 * the network the server runs in, never the internet. The browser client
 * applies the same rule to decide which requests it sends here
 * (src/lib/networkAddress.ts); keep the two in step.
 *
 * "In the network" is what the address says: a private IPv4 literal (RFC 1918)
 * or a name under a suffix that only resolves inside a home or company
 * network. Link-local (169.254.0.0/16, where cloud metadata services live) and
 * loopback are not part of it: the first is the classic SSRF target, the
 * second is the server itself, which no browser request means.
 */

const PRIVATE_NAME_SUFFIXES = [".local", ".lan", ".home.arpa", ".internal", ".fritz.box"];

export function isPrivateIPv4(address: string): boolean {
  const match = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(address);

  if (!match) {
    return false;
  }

  const [a, b] = match.slice(1, 3).map(Number);

  return a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168);
}

/** Unique local IPv6 (fc00::/7), which is what a home network's names may resolve to. */
function isUniqueLocalIPv6(address: string): boolean {
  return /^f[cd][0-9a-f]{2}:/i.test(address);
}

export function isPrivateNetworkHostname(hostname: string): boolean {
  const host = hostname.toLowerCase();

  return isPrivateIPv4(host) || PRIVATE_NAME_SUFFIXES.some((suffix) => host.endsWith(suffix) && host.length > suffix.length);
}

export type Lookup = (hostname: string) => Promise<Array<{ address: string }>>;

const systemLookup: Lookup = (hostname) => lookup(hostname, { all: true });

/**
 * A name in the allowlist was checked by its suffix when the server started;
 * what it points to is only known now. Every address it resolves to has to be
 * in the network too, or a home-network name that happens to resolve publicly
 * would send the document unencrypted across the internet.
 *
 * Null when the name does not resolve at all: that is an unreachable model
 * server, which the request itself reports better than a refusal would.
 */
export async function resolvesToPrivateNetwork(hostname: string, resolve: Lookup = systemLookup): Promise<boolean | null> {
  if (isIP(hostname)) {
    return isPrivateIPv4(hostname);
  }

  const addresses = await resolve(hostname).catch(() => []);

  if (addresses.length === 0) {
    return null;
  }

  return addresses.every(({ address }) => isPrivateIPv4(address) || isUniqueLocalIPv6(address));
}
