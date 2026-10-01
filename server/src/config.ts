import path from "node:path";

/**
 * Everything the server takes from the environment, parsed once at startup.
 * All of these are deployment decisions (where the vault is, which prefix the
 * reverse proxy routes to us), not user settings, which is why none of them
 * are editable from the UI.
 */
export type ServerConfig = {
  /** Absolute path of the one vault this instance serves. */
  vaultPath: string;
  /**
   * URL prefix the whole app lives under, normalized to "" (root) or
   * "/prefix" (leading slash, no trailing slash). Every route, asset URL and
   * the session cookie's Path attribute are derived from this one value.
   */
  basePath: string;
  host: string;
  port: number;
  /**
   * Initial password, honoured only while the vault has no password hash yet.
   * Once a hash exists the variable is ignored (and a startup log line says
   * so), otherwise every redeploy with the variable still set would reset the
   * password.
   */
  initPassword: string | null;
  /**
   * Whether the session cookie carries the Secure flag. Defaults to true
   * because the documented deployment always sits behind TLS; switched off
   * only for plain-http development on localhost.
   */
  cookieSecure: boolean;
  /**
   * How far to trust `X-Forwarded-*`. A number is what the documented
   * deployment uses: it says how many proxies stand in front, and the client
   * address is taken that many hops from the right. Trusting the whole chain
   * instead would let a client prepend an address of its own and, with it,
   * pick which bucket the login rate limit counts against.
   */
  trustProxy: boolean | number | string;
  /** Hard cap for a session's lifetime, sliding expiration or not. */
  sessionMaxAgeDays: number;
  /**
   * Login brute-force protection. With one password and no user name an
   * attacker has a single secret to guess, so the lock escalates: after
   * `loginMaxAttempts` failures the address waits `loginLockSeconds`, after
   * the next series five times as long, up to `loginLockMaxSeconds`.
   */
  loginMaxAttempts: number;
  loginLockSeconds: number;
  loginLockMaxSeconds: number;
  /**
   * Extra origins accepted on state-changing requests, on top of the host the
   * request itself arrived at. Only needed where the reverse proxy hands us a
   * different host than the browser sees; an empty list is the normal case.
   */
  allowedOrigins: string[];
  /**
   * Hosts the LLM proxy may forward to. Cloud provider APIs cannot be called
   * from the browser directly (CORS, and the API key would have to travel to
   * the tab), so the server forwards those requests; this list is what keeps
   * that from becoming a way to reach anything else.
   */
  llmAllowedHosts: string[];
  /**
   * Directory with the built web client (`npm run build:web` in the repo
   * root). Defaults to `../dist-web` relative to the server package, which
   * is where that build lands in a checkout and where the Docker image
   * copies it to.
   */
  webDistDir: string;
  /**
   * The person this instance serves, in a multi-instance setup where people
   * share vaults. Also the folder name of their own sidecars in a shared
   * vault, hence the slug rule. Null outside such a setup.
   */
  user: string | null;
  /**
   * The folder every instance of the setup mounts for shared vaults. Sharing
   * is on only when both this and `user` are set; a folder without a user
   * leaves it off with a warning at startup rather than refusing to start,
   * so a compose file updated ahead of its .env keeps running.
   */
  sharedPath: string | null;
};

export class ConfigError extends Error {}

const USER_NAME_PATTERN = /^[a-z0-9][a-z0-9_-]{0,31}$/;

export function parseUser(raw: string | undefined): string | null {
  const value = raw?.trim() ?? "";

  if (!value) {
    return null;
  }

  if (!USER_NAME_PATTERN.test(value)) {
    throw new ConfigError(
      `SCRIBEDOG_USER "${raw}" is not usable. Use lowercase letters, digits, "-" and "_" (up to 32), e.g. "anna".`
    );
  }

  return value;
}

const BASE_PATH_SEGMENT = /^[A-Za-z0-9._~-]+$/;

/**
 * "" | "/" | undefined → "" (app at the root). Anything else becomes
 * "/segment/segment": leading slash added, trailing slashes and backslashes
 * removed, duplicate slashes collapsed. Segments are restricted to unreserved
 * URL characters, so the value can be dropped into routes, cookie Path
 * attributes and HTML without any further escaping.
 */
export function normalizeBasePath(raw: string | undefined): string {
  const trimmed = (raw ?? "").trim().replace(/\\/g, "/");

  if (!trimmed || trimmed === "/") {
    return "";
  }

  const segments = trimmed.split("/").filter((segment) => segment.length > 0);

  if (segments.length === 0) {
    return "";
  }

  for (const segment of segments) {
    if (segment === "." || segment === ".." || !BASE_PATH_SEGMENT.test(segment)) {
      throw new ConfigError(
        `SCRIBEDOG_BASE_PATH "${raw}" is not a usable path prefix. Use letters, digits, "-", "_" and "." only, e.g. "/anna".`
      );
    }
  }

  return `/${segments.join("/")}`;
}

/**
 * "" -> 1 (one reverse proxy, the bundled Caddy), "false" -> no proxy at all,
 * a number -> that many hops, anything else -> handed to Fastify as an
 * address or CIDR list of proxies to trust.
 */
export function parseTrustProxy(raw: string | undefined): boolean | number | string {
  const value = (raw ?? "").trim().toLowerCase();

  if (value === "") {
    return 1;
  }

  if (["0", "false", "no", "off"].includes(value)) {
    return false;
  }

  // "true" means "there is a proxy", not "trust every hop a client claims".
  if (["true", "yes", "on"].includes(value)) {
    return 1;
  }

  if (/^\d+$/.test(value)) {
    return Number.parseInt(value, 10);
  }

  return raw!.trim();
}

function parseBoolean(raw: string | undefined, fallback: boolean): boolean {
  if (raw === undefined || raw.trim() === "") {
    return fallback;
  }

  const value = raw.trim().toLowerCase();

  if (["1", "true", "yes", "on"].includes(value)) {
    return true;
  }

  if (["0", "false", "no", "off"].includes(value)) {
    return false;
  }

  throw new ConfigError(`Expected a boolean (true/false) but got "${raw}".`);
}

function parseInteger(raw: string | undefined, fallback: number, name: string): number {
  if (raw === undefined || raw.trim() === "") {
    return fallback;
  }

  const value = Number.parseInt(raw, 10);

  if (!Number.isFinite(value) || value <= 0) {
    throw new ConfigError(`${name} must be a positive integer, got "${raw}".`);
  }

  return value;
}

/** Comma or whitespace separated list, empty entries dropped. */
function parseList(raw: string | undefined, fallback: string[]): string[] {
  if (raw === undefined || raw.trim() === "") {
    return fallback;
  }

  return raw
    .split(/[,\s]+/)
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
}

/**
 * The cloud providers ScribeDog knows (see PROVIDER_DEFAULT_API_URL in
 * src/lib/aiClient.ts). Anyone pointing the app at a gateway of their own adds
 * its host through SCRIBEDOG_LLM_ALLOWED_HOSTS.
 */
export const DEFAULT_LLM_HOSTS = ["api.openai.com", "api.anthropic.com", "api.mistral.ai"];

function parseOrigins(raw: string | undefined): string[] {
  return parseList(raw, []).map((entry) => {
    let url: URL;

    try {
      url = new URL(entry);
    } catch {
      throw new ConfigError(`SCRIBEDOG_ALLOWED_ORIGINS entry "${entry}" is not a URL, expected e.g. "https://notes.example.com".`);
    }

    if (url.protocol !== "http:" && url.protocol !== "https:") {
      throw new ConfigError(`SCRIBEDOG_ALLOWED_ORIGINS entry "${entry}" must be http or https.`);
    }

    return url.origin;
  });
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): ServerConfig {
  const vaultPath = path.resolve(env.SCRIBEDOG_VAULT_PATH?.trim() || "/data");
  const initPassword = env.SCRIBEDOG_INIT_PASSWORD ?? null;

  return {
    vaultPath,
    basePath: normalizeBasePath(env.SCRIBEDOG_BASE_PATH),
    host: env.SCRIBEDOG_HOST?.trim() || "0.0.0.0",
    port: parseInteger(env.SCRIBEDOG_PORT, 3000, "SCRIBEDOG_PORT"),
    initPassword: initPassword && initPassword.length > 0 ? initPassword : null,
    cookieSecure: parseBoolean(env.SCRIBEDOG_COOKIE_SECURE, true),
    trustProxy: parseTrustProxy(env.SCRIBEDOG_TRUST_PROXY),
    webDistDir: path.resolve(env.SCRIBEDOG_WEB_DIST_DIR?.trim() || path.join(process.cwd(), "..", "dist-web")),
    sessionMaxAgeDays: Math.min(
      parseInteger(env.SCRIBEDOG_SESSION_MAX_AGE_DAYS, 60, "SCRIBEDOG_SESSION_MAX_AGE_DAYS"),
      60
    ),
    loginMaxAttempts: parseInteger(env.SCRIBEDOG_LOGIN_MAX_ATTEMPTS, 5, "SCRIBEDOG_LOGIN_MAX_ATTEMPTS"),
    loginLockSeconds: parseInteger(env.SCRIBEDOG_LOGIN_LOCK_SECONDS, 60, "SCRIBEDOG_LOGIN_LOCK_SECONDS"),
    loginLockMaxSeconds: parseInteger(env.SCRIBEDOG_LOGIN_LOCK_MAX_SECONDS, 900, "SCRIBEDOG_LOGIN_LOCK_MAX_SECONDS"),
    allowedOrigins: parseOrigins(env.SCRIBEDOG_ALLOWED_ORIGINS),
    llmAllowedHosts: parseList(env.SCRIBEDOG_LLM_ALLOWED_HOSTS, DEFAULT_LLM_HOSTS).map((host) => host.toLowerCase()),
    ...parseSharing(env)
  };
}

function parseSharing(env: NodeJS.ProcessEnv): { user: string | null; sharedPath: string | null } {
  const user = parseUser(env.SCRIBEDOG_USER);
  const rawSharedPath = env.SCRIBEDOG_SHARED_PATH?.trim();
  const sharedPath = rawSharedPath ? path.resolve(rawSharedPath) : null;

  return { user, sharedPath };
}
