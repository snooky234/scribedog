/**
 * Where a plain-http AI endpoint lives, decided from the URL alone.
 *
 * Two kinds of address may skip HTTPS: the machine itself (loopback) and a
 * machine in the user's own network. Anything else over plain http would send
 * the document text unencrypted across the internet, which is what the local
 * providers' endpoint check exists to prevent.
 *
 * "In the user's own network" can only be told from what the URL says: a
 * private IPv4 literal (RFC 1918) or a name under a suffix that only resolves
 * inside a home or company network. A plain name without a dot is left out on
 * purpose; the desktop app's http scope (src-tauri/capabilities/default.json)
 * cannot express it, and an address the check accepts but the shell refuses
 * would fail with a message about permissions instead of the endpoint. The
 * server's proxy applies the same rule (server/src/llm/privateAddress.ts).
 */

/** Name suffixes that never belong to a public host. */
export const PRIVATE_NAME_SUFFIXES = [".local", ".lan", ".home.arpa", ".internal", ".fritz.box"] as const;

function parseHttpUrl(rawUrl: string): URL | null {
  try {
    const url = new URL(rawUrl);

    return url.protocol === "http:" ? url : null;
  } catch {
    return null;
  }
}

/** True for a private IPv4 literal: 10.0.0.0/8, 172.16.0.0/12, 192.168.0.0/16. */
export function isPrivateIPv4(hostname: string): boolean {
  const match = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(hostname);

  if (!match) {
    return false;
  }

  const [a, b] = match.slice(1, 3).map(Number);

  return a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168);
}

export function isPrivateNetworkHostname(hostname: string): boolean {
  const host = hostname.toLowerCase();

  return isPrivateIPv4(host) || PRIVATE_NAME_SUFFIXES.some((suffix) => host.endsWith(suffix) && host.length > suffix.length);
}

/** http to this machine: localhost, 127.0.0.1, [::1] or a *.localhost name. */
export function isLoopbackHttpUrl(rawUrl: string): boolean {
  const url = parseHttpUrl(rawUrl);

  return (
    url !== null &&
    (url.hostname === "localhost" ||
      url.hostname === "127.0.0.1" ||
      url.hostname === "[::1]" ||
      url.hostname.endsWith(".localhost"))
  );
}

/** http to another machine in the user's own network. */
export function isPrivateNetworkHttpUrl(rawUrl: string): boolean {
  const url = parseHttpUrl(rawUrl);

  return url !== null && isPrivateNetworkHostname(url.hostname);
}

/**
 * The line a ScribeDog server admin adds to the server's .env so its AI proxy
 * may reach `entry` (an origin like http://192.168.1.50:1337, or a host
 * name). "default" keeps the built-in cloud providers next to it.
 */
export function serverAllowlistLine(entry: string): string {
  return `SCRIBEDOG_LLM_ALLOWED_HOSTS=default,${entry}`;
}
