import type { FastifyInstance, FastifyRequest } from "fastify";

import type { RequireSession } from "../auth/guard.js";
import type { TokenStore } from "../auth/tokenStore.js";
import { vaultErrorHandler } from "./routes.js";
import type { VaultWatcher } from "./watcher.js";

/** Why a socket's access to its vault ended. */
export type AccessLoss = "removed" | "deleted";

/**
 * Where a socket's change signal comes from. The instance's own vault has one
 * watcher for everybody; a shared vault is checked for access before the
 * upgrade and keeps being checked afterwards, since the creator can remove a
 * member (or delete the vault) while their socket is open.
 */
export type EventSource = {
  /** Runs before the upgrade; throwing refuses it with the error's status. */
  prepare?(request: FastifyRequest): Promise<void>;
  subscribe(request: FastifyRequest, handler: () => void): () => void;
  watchAccess?(request: FastifyRequest, onLost: (reason: AccessLoss) => void): () => void;
  /**
   * Presence on a shared vault: the client says which note it has open
   * (`{"type":"presence","path":"Notes/Idea.md"}`, null for none) and is told
   * who else has which note open (`{"type":"presence","editors":[...]}`).
   */
  presence?(
    request: FastifyRequest,
    push: (editors: Array<{ user: string; path: string }>) => void
  ): { setPath(rawPath: unknown): void; leave(): void };
};

export type EventRoutesOptions = {
  source: EventSource | VaultWatcher;
  tokens: TokenStore;
  requireSession: RequireSession;
};

/** The one message the server pushes; the client answers it with a rescan. */
export const FILES_CHANGED_MESSAGE = JSON.stringify({ type: "files-changed" });

/** Keeps proxies and browsers from closing an idle connection. */
const PING_INTERVAL_MS = 30_000;

/** WebSocket close code for "your credentials stopped being valid" (4000-4999 is the application range). */
export const REVOKED_CLOSE_CODE = 4001;
/** The person was taken off a shared vault, or left it on another device. */
export const ACCESS_REMOVED_CLOSE_CODE = 4003;
/** The shared vault was deleted. */
export const VAULT_DELETED_CLOSE_CODE = 4004;

function isEventSource(source: EventSource | VaultWatcher): source is EventSource {
  return !("close" in source);
}

/**
 * `GET ${basePath}/api/events` upgraded to a WebSocket. The session cookie
 * (or the access token header) rides along with the upgrade request, so
 * requireSession guards this the same way it guards the file API; a client
 * without a session gets the usual 401 before any socket exists.
 *
 * A socket authenticated by an access token is closed the moment that token
 * is revoked. Nothing else would tell an idle desktop app that its key is
 * gone: the socket was checked once at the upgrade, and the next HTTP request
 * might be hours away. Closing it makes the client reconnect, fail with 401
 * and ask for the password. A socket on a shared vault is closed the same way
 * when its access ends, with a code that says why.
 */
export async function eventRoutes(app: FastifyInstance, options: EventRoutesOptions): Promise<void> {
  const { tokens, requireSession } = options;
  const source: EventSource = isEventSource(options.source)
    ? options.source
    : { subscribe: (_request, handler) => (options.source as VaultWatcher).subscribe(handler) };

  const socketsByToken = new Map<string, Set<{ close(code: number, reason: string): void }>>();

  const stopListening = tokens.onRevoked((id) => {
    for (const socket of socketsByToken.get(id) ?? []) {
      socket.close(REVOKED_CLOSE_CODE, "access token revoked");
    }

    socketsByToken.delete(id);
  });

  app.addHook("onClose", async () => {
    stopListening();
  });

  const prepare = async (request: FastifyRequest, reply: Parameters<typeof vaultErrorHandler>[2]) => {
    if (!source.prepare) {
      return;
    }

    try {
      await source.prepare(request);
    } catch (error) {
      return vaultErrorHandler(error as Parameters<typeof vaultErrorHandler>[0], request, reply);
    }
  };

  app.get("/events", { websocket: true, onRequest: requireSession, preValidation: prepare }, (socket, request) => {
    const tokenId = request.auth?.kind === "token" ? request.auth.tokenId : null;

    if (tokenId !== null) {
      const sockets = socketsByToken.get(tokenId) ?? new Set();
      sockets.add(socket);
      socketsByToken.set(tokenId, sockets);
    }

    const unsubscribe = source.subscribe(request, () => {
      if (socket.readyState === socket.OPEN) {
        socket.send(FILES_CHANGED_MESSAGE);
      }
    });

    const stopWatchingAccess =
      source.watchAccess?.(request, (reason) => {
        socket.close(
          reason === "deleted" ? VAULT_DELETED_CLOSE_CODE : ACCESS_REMOVED_CLOSE_CODE,
          reason === "deleted" ? "vault deleted" : "access removed"
        );
      }) ?? (() => undefined);

    const presence =
      source.presence?.(request, (editors) => {
        if (socket.readyState === socket.OPEN) {
          socket.send(JSON.stringify({ type: "presence", editors }));
        }
      }) ?? null;

    if (presence) {
      socket.on("message", (data) => {
        let message: { type?: unknown; path?: unknown };

        try {
          message = JSON.parse(String(data)) as typeof message;
        } catch {
          return;
        }

        if (message?.type === "presence") {
          presence.setPath(message.path ?? null);
        }
      });
    }

    const ping = setInterval(() => {
      if (socket.readyState === socket.OPEN) {
        socket.ping();
      }
    }, PING_INTERVAL_MS);

    const cleanup = () => {
      clearInterval(ping);
      unsubscribe();
      stopWatchingAccess();
      presence?.leave();

      if (tokenId !== null) {
        const sockets = socketsByToken.get(tokenId);
        sockets?.delete(socket);

        if (sockets?.size === 0) {
          socketsByToken.delete(tokenId);
        }
      }
    };

    socket.on("close", cleanup);
    socket.on("error", cleanup);
  });
}
