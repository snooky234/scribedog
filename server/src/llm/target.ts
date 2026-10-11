import { isPrivateNetworkHostname } from "./privateAddress.js";

/**
 * Which addresses the LLM proxy may forward to.
 *
 * The proxy exists because a browser tab cannot call the provider itself (CORS,
 * and the API key would have to travel to the tab to try). That turns the
 * server into something that makes outbound requests on behalf of a client,
 * which is the shape of every SSRF hole, so the rule is an allowlist of exact
 * entries rather than "anything the client asks for".
 *
 * Two kinds of entry (config.ts builds the list):
 *
 *  - a bare host name, reached over https on the standard port: the cloud
 *    providers and any gateway in front of them;
 *  - an origin like http://192.168.1.50:1337: a model server (Ollama,
 *    Jan.ai, LM Studio) on another machine in the server's network. Plain http
 *    is accepted only for addresses in the network (privateAddress.ts), and
 *    only for the exact host and port the admin wrote down.
 *
 * Loopback stays out: on a server "localhost" is the server, not the user's
 * machine, and the browser talks to a model on the user's machine directly.
 */

export class LlmTargetError extends Error {
  /**
   * The allowlist entry that would let this target through, when there is
   * one: the client turns it into the exact line for the server's .env.
   */
  constructor(
    message: string,
    readonly entry: string | null = null
  ) {
    super(message);
  }
}

function notAllowed(entry: string): LlmTargetError {
  return new LlmTargetError(
    `${entry} is not an allowed AI endpoint. Add it to SCRIBEDOG_LLM_ALLOWED_HOSTS (e.g. "default,${entry}") to allow it.`,
    entry
  );
}

export function assertAllowedTarget(rawUrl: unknown, allowed: readonly string[]): URL {
  if (typeof rawUrl !== "string" || rawUrl.trim() === "") {
    throw new LlmTargetError("No target URL given.");
  }

  let url: URL;

  try {
    url = new URL(rawUrl.trim());
  } catch {
    throw new LlmTargetError(`"${rawUrl}" is not a URL.`);
  }

  if (url.username || url.password) {
    throw new LlmTargetError("The AI endpoint must not carry credentials.");
  }

  if (url.protocol === "http:") {
    if (!isPrivateNetworkHostname(url.hostname)) {
      throw new LlmTargetError("The AI endpoint must use https unless it is in your own network.");
    }

    if (!allowed.includes(url.origin)) {
      throw notAllowed(url.origin);
    }

    return url;
  }

  if (url.protocol !== "https:") {
    throw new LlmTargetError("The AI endpoint must use https.");
  }

  if (url.port && url.port !== "443") {
    throw new LlmTargetError("The AI endpoint must use the standard https port.");
  }

  if (!allowed.includes(url.hostname.toLowerCase())) {
    throw notAllowed(url.hostname.toLowerCase());
  }

  return url;
}

/**
 * Request headers the proxy passes on. An allowlist, so nothing the browser
 * attaches on its own (cookies, origin, the session) can leak to the provider,
 * and nothing about our own transport (encoding, length, connection) confuses
 * the upstream.
 */
const FORWARDED_REQUEST_HEADERS = new Set([
  "content-type",
  "accept",
  "authorization",
  "x-api-key",
  "anthropic-version",
  "anthropic-beta",
  "openai-organization",
  "openai-project",
  "openai-beta"
]);

export function forwardableRequestHeaders(
  headers: Record<string, string | string[] | undefined>
): Record<string, string> {
  const result: Record<string, string> = {};

  for (const [name, value] of Object.entries(headers)) {
    if (value === undefined || !FORWARDED_REQUEST_HEADERS.has(name.toLowerCase())) {
      continue;
    }

    result[name.toLowerCase()] = Array.isArray(value) ? value.join(", ") : value;
  }

  return result;
}

/**
 * Response headers handed back to the browser. Content-length and the encoding
 * headers stay behind: fetch has already decoded the body, so repeating the
 * upstream's numbers would describe a body that no longer exists.
 */
const FORWARDED_RESPONSE_HEADERS = new Set(["content-type", "retry-after"]);

export function forwardableResponseHeaders(headers: Headers): Record<string, string> {
  const result: Record<string, string> = {};

  headers.forEach((value, name) => {
    if (FORWARDED_RESPONSE_HEADERS.has(name.toLowerCase())) {
      result[name.toLowerCase()] = value;
    }
  });

  return result;
}
