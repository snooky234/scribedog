import { SessionError } from "@/platform/errors";
import type { ConditionalWriteResult, VersionedText } from "@/platform/types";

/**
 * The HTTP client for the ScribeDog server, mirroring the routes in
 * server/src (auth, tokens and file API). Two shells use it: the browser,
 * where the session cookie rides along with every request, and the desktop
 * app opening a server vault, where the Rust side sends the request with an
 * access token. What differs between them is only how a request leaves the
 * page, which is the `ServerTransport`; everything above it (paths, bodies,
 * error mapping, the 401 signal) is shared here.
 */

export type RemoteMarkdownFileRecord = {
  relativePath: string;
  mtimeMs: number;
};

export type RemoteDirectoryEntry = {
  name: string;
  isDirectory: boolean;
  isFile: boolean;
  isSymlink: boolean;
};

export type RemoteFileInfo = {
  isFile: boolean;
  isDirectory: boolean;
  isSymlink: boolean;
  size: number;
  mtimeMs: number | null;
  birthtimeMs: number | null;
};

export type RemoteSecretStatus = {
  state: "ready" | "locked";
  ids: string[];
  discardedAt: string | null;
};

/** One entry of the server's "signed-in devices" list; never the token itself. */
export type RemoteAccessToken = {
  id: string;
  name: string;
  createdAt: string;
  lastUsedAt: string | null;
  /** True for the token the request itself was made with. */
  current: boolean;
};

export type IssuedAccessToken = {
  id: string;
  name: string;
  /** The token, handed out exactly once. */
  token: string;
  createdAt: string;
};

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    /** The parsed response body, for errors that carry data (a version conflict). */
    readonly body: unknown = null
  ) {
    super(message);
    this.name = "ApiError";
  }
}

export type TransportInit = {
  method: string;
  headers: Record<string, string>;
  body?: string | Uint8Array;
};

/**
 * How a request reaches the server. `apiPath` is the part after `/api`
 * (`/fs/text?path=...`); the transport knows the server's address and adds
 * the credentials of its platform. It rejects when the server cannot be
 * reached at all; anything the server answered comes back as a Response.
 */
export type ServerTransport = {
  fetch(apiPath: string, init: TransportInit): Promise<Response>;
};

type RequestOptions = {
  method?: string;
  headers?: Record<string, string>;
  body?: string | Uint8Array;
  /**
   * A 401 from a route that takes the password means "wrong password", not
   * "session gone"; it must not tear down the state a form is showing.
   */
  isLogin?: boolean;
  /** The body is raw bytes (sent as application/octet-stream), not JSON. */
  binary?: boolean;
};

const withPath = (route: string, path: string) => `${route}?path=${encodeURIComponent(path)}`;

export function createServerApi(transport: ServerTransport) {
  const unauthorizedHandlers = new Set<() => void>();

  function onUnauthorized(handler: () => void): () => void {
    unauthorizedHandlers.add(handler);

    return () => {
      unauthorizedHandlers.delete(handler);
    };
  }

  async function send(path: string, { isLogin = false, binary = false, ...init }: RequestOptions): Promise<Response> {
    let response: Response;

    try {
      response = await transport.fetch(path, {
        method: init.method ?? "GET",
        headers: {
          accept: "application/json",
          ...(init.body !== undefined ? { "content-type": binary ? "application/octet-stream" : "application/json" } : {}),
          ...init.headers
        },
        body: init.body
      });
    } catch (error) {
      throw new SessionError("unreachable", error instanceof Error ? error.message : "Server unreachable.");
    }

    if (response.status === 401) {
      if (isLogin) {
        throw new SessionError("invalid_password", "Wrong password.");
      }

      for (const handler of unauthorizedHandlers) {
        handler();
      }

      throw new SessionError("unauthorized", "Not signed in.");
    }

    if (!response.ok) {
      const body = (await response.json().catch(() => null)) as
        | { error?: string; message?: string; retryAfterSeconds?: number }
        | null;

      // The login lock is a session matter, not a request that went wrong:
      // the form shows it in place of "wrong password".
      if (response.status === 429) {
        throw new SessionError("too_many_attempts", body?.message ?? "Too many attempts.", body?.retryAfterSeconds);
      }

      throw new ApiError(
        response.status,
        body?.error ?? "error",
        body?.message ?? `Request failed (${response.status}).`,
        body
      );
    }

    return response;
  }

  async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
    const response = await send(path, options);

    if (response.status === 204) {
      return undefined as T;
    }

    return (await response.json()) as T;
  }

  async function requestBytes(path: string, accept = "application/json"): Promise<Uint8Array> {
    const response = await send(path, { headers: { accept } });

    return new Uint8Array(await response.arrayBuffer());
  }

  const api = {
    session: () => request<{ authenticated: boolean; via?: "cookie" | "token" }>("/auth/session"),
    login: (password: string) =>
      request<{ ok: true }>("/auth/login", { method: "POST", body: JSON.stringify({ password }), isLogin: true }),
    logout: () => request<void>("/auth/logout", { method: "POST" }),
    /** Trades the password for an access token; the password is not kept. */
    issueToken: (password: string, name: string) =>
      request<IssuedAccessToken>("/auth/tokens", { method: "POST", body: JSON.stringify({ password, name }), isLogin: true }),
    listTokens: async () => (await request<{ tokens: RemoteAccessToken[] }>("/auth/tokens")).tokens,
    revokeToken: (id: string) => request<void>(`/auth/tokens/${encodeURIComponent(id)}`, { method: "DELETE" }),
    listFiles: async () => (await request<{ files: RemoteMarkdownFileRecord[] }>("/files")).files,
    readDir: async (path: string) => (await request<{ entries: RemoteDirectoryEntry[] }>(withPath("/fs/entries", path))).entries,
    stat: (path: string) => request<RemoteFileInfo>(withPath("/fs/stat", path)),
    exists: async (path: string) => (await request<{ exists: boolean }>(withPath("/fs/exists", path))).exists,
    mkdir: (path: string, recursive: boolean) =>
      request<void>("/fs/mkdir", { method: "POST", body: JSON.stringify({ path, recursive }) }),
    readText: async (path: string) => (await request<{ content: string }>(withPath("/fs/text", path))).content,
    readTextVersioned: (path: string) => request<VersionedText>(withPath("/fs/text", path)),
    writeText: (path: string, content: string) =>
      request<{ mtimeMs: number }>("/fs/text", { method: "PUT", body: JSON.stringify({ path, content }) }),
    /** A write that the server lets through only while the file is still `ifMatch` (null: absent). */
    async writeTextIfMatch(path: string, content: string, ifMatch: string | null): Promise<ConditionalWriteResult> {
      try {
        const { version } = await request<{ mtimeMs: number; version: string }>("/fs/text", {
          method: "PUT",
          body: JSON.stringify({ path, content, ifMatch })
        });

        return { ok: true, version };
      } catch (error) {
        if (error instanceof ApiError && error.status === 409 && error.code === "version_conflict") {
          const current = (error.body as { current?: VersionedText | null } | null)?.current ?? null;

          return { ok: false, current };
        }

        throw error;
      }
    },
    readBytes: (path: string) => requestBytes(withPath("/fs/file", path)),
    writeBytes: (path: string, data: Uint8Array) =>
      request<{ mtimeMs: number }>(withPath("/fs/file", path), { method: "PUT", body: data, binary: true }),
    rename: (from: string, to: string) => request<void>("/fs/rename", { method: "POST", body: JSON.stringify({ from, to }) }),
    remove: (path: string, recursive: boolean) =>
      request<void>("/fs/remove", { method: "POST", body: JSON.stringify({ path, recursive }) }),
    /** A folder (`""` for the whole vault) as a ZIP of its raw files; see server/src/vault/exportZip.ts. */
    packFolder: (path: string) => requestBytes(withPath("/export/zip", path), "application/zip"),
    changePassword: (currentPassword: string, newPassword: string) =>
      request<{ ok: true }>("/auth/password", {
        method: "POST",
        body: JSON.stringify({ currentPassword, newPassword }),
        // A 401 here means "the current password is wrong", not "your session
        // ended"; it must not pull the login form over a settings dialog.
        isLogin: true
      }),
    secretStatus: () => request<RemoteSecretStatus>("/secrets"),
    storeSecret: (id: string, value: string) =>
      request<void>(`/secrets/${encodeURIComponent(id)}`, { method: "PUT", body: JSON.stringify({ value }) })
  };

  return { api, onUnauthorized };
}

export type ServerApi = ReturnType<typeof createServerApi>["api"];
