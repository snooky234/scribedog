import { createServerApi, type ServerTransport } from "@/platform/remote/serverApi";

export { ApiError } from "@/platform/remote/serverApi";
export type { RemoteSecretStatus } from "@/platform/remote/serverApi";

/**
 * The browser's end of the server API: the shared client from
 * platform/remote over `window.fetch`, same origin, so the session cookie
 * rides along with every request and every 401 brings the login form back
 * no matter which call noticed it first.
 */

const BASE_PATH_META_NAME = "scribedog-base-path";

/**
 * The one place the client learns where it lives. The server substitutes the
 * base path into the meta tag when it serves index.html, so the same bundle
 * works at "/" and at "/anna" without a rebuild.
 */
export function getBasePath(): string {
  const content = document.querySelector(`meta[name="${BASE_PATH_META_NAME}"]`)?.getAttribute("content") ?? "";

  // Under `vite dev` nothing substitutes the placeholder; treat it as the root.
  if (content.startsWith("/__")) {
    return "";
  }

  return content;
}

export const browserTransport: ServerTransport = {
  fetch: (apiPath, init) =>
    fetch(`${getBasePath()}/api${apiPath}`, {
      method: init.method,
      headers: init.headers,
      body: init.body as BodyInit | undefined,
      credentials: "same-origin"
    })
};

const client = createServerApi(browserTransport);

export const serverApi = client.api;
export const onUnauthorized = client.onUnauthorized;
/** For the clients of shared vaults, so a refused session signs out everywhere at once. */
export const unauthorizedHandlers = client.unauthorizedHandlers;

/** Where `platform.http.fetch` sends a cloud AI request; see web/index.ts. */
const LLM_PROXY_PATH = "/llm/request";
export const LLM_TARGET_HEADER = "x-scribedog-llm-url";

/** Absolute URL of the proxy, for the one caller that builds its own request. */
export function llmProxyUrl(): string {
  return `${getBasePath()}/api${LLM_PROXY_PATH}`;
}

/**
 * Absolute WebSocket URL of the live-update stream, prefix included. `scope`
 * is the API path of a shared vault (`/v/<id>`), empty for the instance's own.
 */
export function eventsUrl(scope = ""): string {
  const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";

  return `${protocol}//${window.location.host}${getBasePath()}/api${scope}/events`;
}
