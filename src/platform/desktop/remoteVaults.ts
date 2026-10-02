import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";

import type { RemoteVaultsApi, SharedPresenceEditor, SharedVaultLoss } from "@/platform/types";

/** Fired by the Rust live-update client when the server refuses the token. */
export const REMOTE_VAULT_UNAUTHORIZED_EVENT = "scribedog-remote-vault-unauthorized";
/** Fired when a shared vault's stream is closed for good (removed, deleted). */
export const REMOTE_VAULT_ACCESS_LOST_EVENT = "scribedog-remote-vault-access-lost";
/** Fired with the other people's open notes in the watched shared vault. */
export const REMOTE_VAULT_PRESENCE_EVENT = "scribedog-remote-vault-presence";

type RustRequest = {
  url: string;
  method: string;
  headers: [string, string][];
  /** Base64 of the body bytes, or null. */
  body: string | null;
};

type RustResponse = {
  status: number;
  headers: [string, string][];
  /** Base64 of the body bytes. */
  body: string;
};

function toBase64(bytes: Uint8Array): string {
  let binary = "";

  // Chunked: spreading a multi-megabyte image into one apply() call would
  // blow the argument limit.
  for (let offset = 0; offset < bytes.length; offset += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
  }

  return btoa(binary);
}

function fromBase64(text: string): Uint8Array {
  const binary = atob(text);
  const bytes = new Uint8Array(binary.length);

  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }

  return bytes;
}

/** Status codes that a Response may not carry a body with. */
const BODYLESS_STATUSES = new Set([204, 205, 304]);

/**
 * The desktop's end of the server API: requests go through the Rust side
 * (src-tauri/src/remote_vault.rs), because the webview's own `fetch` is
 * confined to the app and the http plugin's allowlist is fixed at build
 * time. The Rust side checks the origin against the servers the user added,
 * sends the request with the system's certificate store, and hands the
 * answer back; here it is dressed as a standard Response so the shared
 * client (platform/remote/serverApi.ts) cannot tell it from the browser's.
 */
export const desktopRemoteVaults: RemoteVaultsApi = {
  allowServer: (origin) => invoke("allow_remote_vault_origin", { origin }),

  async fetch(url, init) {
    const body =
      init.body === undefined
        ? null
        : typeof init.body === "string"
          ? toBase64(new TextEncoder().encode(init.body))
          : toBase64(init.body);

    const request: RustRequest = {
      url,
      method: init.method,
      headers: Object.entries(init.headers),
      body
    };

    const response = await invoke<RustResponse>("remote_vault_request", { request });
    const bytes = fromBase64(response.body);

    return new Response(BODYLESS_STATUSES.has(response.status) ? null : bytes, {
      status: response.status,
      headers: response.headers
    });
  },

  storeToken: (vaultRoot, token) => invoke("store_remote_vault_token", { vaultRoot, token }),
  getToken: (vaultRoot) => invoke<string | null>("get_remote_vault_token", { vaultRoot }),
  deleteToken: (vaultRoot) => invoke("delete_remote_vault_token", { vaultRoot }),
  watch: (vaultRoot, eventsUrl, token) => invoke("watch_remote_vault", { vaultRoot, eventsUrl, token }),
  onUnauthorized: (handler) => listen<string>(REMOTE_VAULT_UNAUTHORIZED_EVENT, (event) => handler(event.payload)),
  setPresencePath: (relativePath) => invoke("set_remote_vault_presence", { path: relativePath }),
  onPresence: (handler) =>
    listen<{ vaultRoot: string; editors: SharedPresenceEditor[] }>(REMOTE_VAULT_PRESENCE_EVENT, (event) =>
      handler(event.payload.vaultRoot, event.payload.editors)
    ),
  onAccessLost: (handler) =>
    listen<{ vaultRoot: string; reason: SharedVaultLoss }>(REMOTE_VAULT_ACCESS_LOST_EVENT, (event) =>
      handler(event.payload.vaultRoot, event.payload.reason)
    )
};
