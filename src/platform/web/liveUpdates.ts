import type { SharedPresenceEditor, SharedVaultLoss } from "@/platform/types";

import { eventsUrl } from "./serverApi";

/**
 * The browser end of the server's change signal (server/src/vault/
 * eventRoutes.ts): the counterpart of the native folder watcher. One socket
 * for the whole tab, opened on the first subscription and closed when the
 * last one goes; it reconnects with backoff while subscribers exist, since a
 * laptop lid or a proxy timeout must not silently turn live updates off.
 *
 * The socket follows the open vault: the instance's own, or a shared one
 * (`watchRoot`), whose stream lives one level down under its id. A shared
 * vault's socket is closed by the server when the vault is deleted or the
 * person taken off it; those two closes end the stream for good and are
 * passed on, since reconnecting would only be refused again.
 *
 * The socket is opened through the same origin, so the session cookie
 * rides along with the upgrade. A refused upgrade (session gone) is left
 * to the next HTTP request to report; the socket just backs off.
 */

const RECONNECT_MIN_MS = 1_000;
const RECONNECT_MAX_MS = 30_000;

/** Close codes of server/src/vault/eventRoutes.ts. */
const ACCESS_REMOVED_CLOSE_CODE = 4003;
const VAULT_DELETED_CLOSE_CODE = 4004;

type Handler = (root: string) => void;
type LossHandler = (root: string, reason: SharedVaultLoss) => void;
type PresenceHandler = (root: string, editors: SharedPresenceEditor[]) => void;

type Target = { root: string; scope: string };

const handlers = new Set<Handler>();
const lossHandlers = new Set<LossHandler>();
const presenceHandlers = new Set<PresenceHandler>();
/**
 * The note this tab has open, with the vault it belongs to, told to the
 * server on every (re)connect. Kept with its root because the app may report
 * the note before the stream has switched to that vault.
 */
let presence: { root: string; path: string | null } | null = null;
let target: Target | null = null;
let socket: WebSocket | null = null;
let reconnectTimer: number | null = null;
let reconnectDelay = RECONNECT_MIN_MS;
/** The root whose stream ended for good; nothing reconnects to it. */
let endedRoot: string | null = null;

function connect(): void {
  if (socket || handlers.size === 0 || !target || endedRoot === target.root) {
    return;
  }

  const current = target;
  let opened: WebSocket;

  try {
    opened = new WebSocket(eventsUrl(current.scope));
  } catch {
    scheduleReconnect();
    return;
  }

  socket = opened;

  opened.onopen = () => {
    reconnectDelay = RECONNECT_MIN_MS;
    sendPresence();
  };

  opened.onmessage = (event) => {
    let message: { type?: unknown; editors?: unknown };

    try {
      message = JSON.parse(String(event.data)) as typeof message;
    } catch {
      return;
    }

    if (message.type === "files-changed") {
      for (const handler of handlers) {
        handler(current.root);
      }
    }

    if (message.type === "presence" && Array.isArray(message.editors)) {
      const editors = message.editors.filter(
        (entry): entry is SharedPresenceEditor =>
          typeof (entry as SharedPresenceEditor)?.user === "string" && typeof (entry as SharedPresenceEditor)?.path === "string"
      );

      for (const handler of presenceHandlers) {
        handler(current.root, editors);
      }
    }
  };

  opened.onclose = (event) => {
    if (socket === opened) {
      socket = null;
    }

    if (event.code === ACCESS_REMOVED_CLOSE_CODE || event.code === VAULT_DELETED_CLOSE_CODE) {
      endedRoot = current.root;
      const reason: SharedVaultLoss = event.code === VAULT_DELETED_CLOSE_CODE ? "deleted" : "removed";

      for (const handler of lossHandlers) {
        handler(current.root, reason);
      }

      return;
    }

    // A socket of a vault that is no longer the open one is not missed.
    if (target?.root === current.root) {
      scheduleReconnect();
    }
  };

  opened.onerror = () => {
    opened.close();
  };
}

/** Only a shared vault's stream (one with a scope) takes presence. */
function sendPresence(): void {
  if (socket?.readyState === WebSocket.OPEN && target?.scope) {
    const path = presence?.root === target.root ? presence.path : null;
    socket.send(JSON.stringify({ type: "presence", path }));
  }
}

function scheduleReconnect(): void {
  if (reconnectTimer !== null || handlers.size === 0) {
    return;
  }

  reconnectTimer = window.setTimeout(() => {
    reconnectTimer = null;
    connect();
  }, reconnectDelay);

  reconnectDelay = Math.min(reconnectDelay * 2, RECONNECT_MAX_MS);
}

function disconnect(): void {
  if (reconnectTimer !== null) {
    window.clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }

  const current = socket;
  socket = null;
  current?.close();
}

/**
 * Points the stream at the vault that was just opened. `scope` is the API
 * path the vault's routes live under (`/v/<id>` for a shared one).
 */
export function watchRoot(root: string, scope: string): void {
  if (target?.root === root && target.scope === scope && endedRoot !== root) {
    return;
  }

  target = { root, scope };
  endedRoot = null;
  reconnectDelay = RECONNECT_MIN_MS;
  disconnect();
  connect();
}

export function subscribeToVaultChanges(handler: Handler): () => void {
  handlers.add(handler);
  connect();

  return () => {
    handlers.delete(handler);

    if (handlers.size === 0) {
      disconnect();
    }
  };
}

/** Which note this tab has open in the watched shared vault; null for none. */
export function setPresencePath(root: string, relativePath: string | null): void {
  if (presence?.root === root && presence.path === relativePath) {
    return;
  }

  presence = { root, path: relativePath };
  sendPresence();
}

export function onPresenceChanged(handler: PresenceHandler): () => void {
  presenceHandlers.add(handler);

  return () => {
    presenceHandlers.delete(handler);
  };
}

/** Told when the server ends a shared vault's stream because access ended. */
export function onStreamAccessLost(handler: LossHandler): () => void {
  lossHandlers.add(handler);

  return () => {
    lossHandlers.delete(handler);
  };
}
