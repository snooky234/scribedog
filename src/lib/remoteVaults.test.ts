// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The shell as the desktop platform provides it, reduced to what the token
 * flow touches: a fetch that answers from a scripted table, a credential
 * store in memory and the allowlist.
 */
const shell = vi.hoisted(() => {
  const tokens = new Map<string, string>();
  const allowed: string[] = [];
  const requests: { url: string; method: string; headers: Record<string, string>; body?: string | Uint8Array }[] = [];
  let respond: (url: string, init: { method: string; headers: Record<string, string> }) => Response = () =>
    new Response("{}", { status: 200 });

  return {
    tokens,
    allowed,
    requests,
    setResponder(next: typeof respond) {
      respond = next;
    },
    api: {
      allowServer: vi.fn(async (origin: string) => {
        allowed.push(origin);
      }),
      fetch: vi.fn(async (url: string, init: { method: string; headers: Record<string, string>; body?: string | Uint8Array }) => {
        requests.push({ url, ...init });
        return respond(url, init);
      }),
      storeToken: vi.fn(async (root: string, token: string) => {
        tokens.set(root, token);
      }),
      getToken: vi.fn(async (root: string) => tokens.get(root) ?? null),
      deleteToken: vi.fn(async (root: string) => {
        tokens.delete(root);
      }),
      watch: vi.fn(async () => undefined),
      onUnauthorized: vi.fn(async () => () => undefined),
      setPresencePath: vi.fn(async () => undefined),
      onPresence: vi.fn(async () => () => undefined),
      onAccessLost: vi.fn(async () => () => undefined)
    }
  };
});

const platformState = vi.hoisted(() => ({
  activeStorage: null as unknown,
  platform: {
    features: { remoteVaults: true },
    remoteVaults: null as unknown,
    sharedVaults: null as unknown,
    vaultStorage: { capabilities: {}, listMarkdownFiles: async () => [] }
  }
}));

vi.mock("@/platform", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/platform/errors")>();

  return {
    platform: platformState.platform,
    SessionError: actual.SessionError,
    PlatformUnavailableError: actual.PlatformUnavailableError,
    setActiveVaultStorage: (storage: unknown) => {
      platformState.activeStorage = storage;
    }
  };
});

vi.mock("@/i18n", () => ({
  default: { t: (key: string, vars?: Record<string, string>) => (vars ? `${key} ${JSON.stringify(vars)}` : key) }
}));

const { SessionError } = await import("@/platform/errors");
const remoteVaults = await import("./remoteVaults");

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

describe("normalizeServerUrl", () => {
  it("accepts https, bare hosts and localhost over http, and strips what is not identity", () => {
    expect(remoteVaults.normalizeServerUrl("https://notes.example.com/")).toBe("https://notes.example.com");
    expect(remoteVaults.normalizeServerUrl("notes.example.com/anna/")).toBe("https://notes.example.com/anna");
    expect(remoteVaults.normalizeServerUrl("https://Notes.Example.com:9443/?x=1#y")).toBe("https://notes.example.com:9443");
    expect(remoteVaults.normalizeServerUrl("http://localhost:3000")).toBe("http://localhost:3000");
  });

  it("refuses plain http elsewhere and non-URLs", () => {
    expect(() => remoteVaults.normalizeServerUrl("http://192.168.1.5")).toThrow("remoteVaults.urlMustBeHttps");
    expect(() => remoteVaults.normalizeServerUrl("ftp://notes.example.com")).toThrow("remoteVaults.invalidUrl");
    expect(() => remoteVaults.normalizeServerUrl("")).toThrow("remoteVaults.invalidUrl");
  });
});

describe("remote vault registry and token flow", () => {
  beforeEach(() => {
    window.localStorage.clear();
    shell.tokens.clear();
    shell.allowed.length = 0;
    shell.requests.length = 0;
    shell.setResponder(() => json({}));
    platformState.platform.remoteVaults = shell.api;
    platformState.activeStorage = null;
    remoteVaults.resetRemoteVaultClients();
  });

  it("trades the password for a token, stores only the token and keys the entry by host and base path", async () => {
    shell.setResponder((url, init) => {
      expect(url).toBe("https://notes.example.com/anna/api/auth/tokens");
      expect(init.headers.authorization).toBeUndefined();
      expect(JSON.parse(String(shell.requests[0].body))).toEqual({ password: "secret pw", name: "My laptop" });

      return json({ id: "tok1", name: "My laptop", token: "sdt_tok1_secret", createdAt: "2026-09-14T00:00:00Z" }, 201);
    });

    const entry = await remoteVaults.addRemoteVault({
      url: "notes.example.com/anna/",
      password: "secret pw",
      name: "",
      deviceName: "My laptop"
    });

    expect(entry).toMatchObject({
      root: "/@remote/notes.example.com/anna",
      url: "https://notes.example.com/anna",
      name: "notes.example.com",
      tokenId: "tok1"
    });
    expect(shell.allowed).toEqual(["https://notes.example.com"]);
    expect(shell.tokens.get(entry.root)).toBe("sdt_tok1_secret");
    expect(window.localStorage.getItem("scribedog:remoteVaults")).not.toContain("secret");
    expect(remoteVaults.listRemoteVaults().map((vault) => vault.root)).toEqual([entry.root]);
    expect(remoteVaults.remoteVaultFor(entry.root)?.name).toBe("notes.example.com");
    expect(remoteVaults.remoteVaultFor("C:\\Notes")).toBeNull();
  });

  it("reports a wrong password as a SessionError and records nothing", async () => {
    shell.setResponder(() => json({ error: "invalid_password" }, 401));

    await expect(
      remoteVaults.addRemoteVault({ url: "https://notes.example.com", password: "nope", name: "", deviceName: "x" })
    ).rejects.toMatchObject({ code: "invalid_password" });

    expect(remoteVaults.listRemoteVaults()).toEqual([]);
    expect(shell.tokens.size).toBe(0);
  });

  it("installs the remote storage for a server vault and the platform's own for a folder", async () => {
    shell.setResponder(() => json({ id: "t", name: "d", token: "sdt_t_s", createdAt: "" }, 201));
    const entry = await remoteVaults.addRemoteVault({ url: "https://notes.example.com", password: "pw", name: "Home", deviceName: "d" });
    remoteVaults.resetRemoteVaultClients();

    await remoteVaults.activateVaultStorage(entry.root);
    expect(platformState.activeStorage).not.toBeNull();

    // Requests from that storage carry the stored token.
    shell.setResponder(() => json({ files: [{ relativePath: "Idea.md", mtimeMs: 1 }] }));
    const storage = platformState.activeStorage as { listMarkdownFiles(root: string): Promise<{ filePath: string }[]> };
    const records = await storage.listMarkdownFiles(entry.root);
    expect(records).toEqual([{ filePath: "/@remote/notes.example.com/Idea.md", relativePath: "Idea.md", mtimeMs: 1 }]);
    expect(shell.requests[shell.requests.length - 1]?.headers.authorization).toBe("Bearer sdt_t_s");

    await remoteVaults.activateVaultStorage("C:\\Users\\me\\Notes");
    expect(platformState.activeStorage).toBeNull();
  });

  it("asks for a sign-in when no token is stored, and on a refused request", async () => {
    shell.setResponder(() => json({ id: "t", name: "d", token: "sdt_t_s", createdAt: "" }, 201));
    const entry = await remoteVaults.addRemoteVault({ url: "https://notes.example.com", password: "pw", name: "", deviceName: "d" });
    remoteVaults.resetRemoteVaultClients();

    const unauthorized: string[] = [];
    remoteVaults.onRemoteVaultUnauthorized((root) => unauthorized.push(root));

    shell.tokens.clear();
    await expect(remoteVaults.activateVaultStorage(entry.root)).rejects.toBeInstanceOf(SessionError);
    expect(unauthorized).toEqual([entry.root]);

    // A new sign-in swaps the token into the existing client.
    shell.setResponder(() => json({ id: "t2", name: "d", token: "sdt_t2_s2", createdAt: "" }, 201));
    await remoteVaults.signInRemoteVault(entry.root, "pw", "d");
    expect(shell.tokens.get(entry.root)).toBe("sdt_t2_s2");
    expect(remoteVaults.remoteVaultFor(entry.root)?.tokenId).toBe("t2");

    shell.setResponder(() => json({ error: "unauthorized" }, 401));
    await expect(remoteVaults.listRemoteDevices(entry.root)).rejects.toMatchObject({ code: "unauthorized" });
    expect(unauthorized).toEqual([entry.root, entry.root]);
  });

  it("forgets a server: revokes its own token, deletes it locally and keeps the markers", async () => {
    shell.setResponder(() => json({ id: "own", name: "d", token: "sdt_own_s", createdAt: "" }, 201));
    const entry = await remoteVaults.addRemoteVault({ url: "https://notes.example.com", password: "pw", name: "", deviceName: "d" });
    window.localStorage.setItem(`scribedog-last-file:${entry.root}`, "Idea.md");

    shell.setResponder(() => new Response(null, { status: 204 }));
    await remoteVaults.removeRemoteVault(entry.root);

    const revoke = shell.requests[shell.requests.length - 1];
    expect(revoke?.method).toBe("DELETE");
    expect(revoke?.url).toBe("https://notes.example.com/api/auth/tokens/own");
    expect(shell.tokens.has(entry.root)).toBe(false);
    expect(remoteVaults.listRemoteVaults()).toEqual([]);
    expect(window.localStorage.getItem(`scribedog-last-file:${entry.root}`)).toBe("Idea.md");
  });

  it("starts the live connection with the server's event stream and the token", async () => {
    shell.setResponder(() => json({ id: "t", name: "d", token: "sdt_t_s", createdAt: "" }, 201));
    const entry = await remoteVaults.addRemoteVault({ url: "https://notes.example.com/anna", password: "pw", name: "", deviceName: "d" });

    await remoteVaults.watchRemoteVault(entry.root);

    expect(shell.api.watch).toHaveBeenCalledWith(entry.root, "wss://notes.example.com/anna/api/events", "sdt_t_s");
  });
});

/**
 * A shared vault of a server the app has added (server/docs/multiuser.md):
 * its own vault with its own root, served by the client and the token of the
 * instance it belongs to.
 */
describe("shared vaults of a server vault", () => {
  const OVERVIEW = {
    enabled: true,
    me: "anna",
    people: ["anna", "bob"],
    vaults: [
      {
        id: "7f3a",
        name: "Familie",
        creator: "anna",
        members: [{ user: "anna", role: "editor" }],
        isCreator: true,
        createdAt: 1,
        updatedAt: 1
      }
    ],
    trash: [],
    notices: []
  };

  async function addServer(): Promise<string> {
    shell.setResponder(() => json({ id: "t", name: "d", token: "sdt_t_s", createdAt: "" }, 201));
    const entry = await remoteVaults.addRemoteVault({
      url: "https://notes.example.com/anna",
      password: "pw",
      name: "",
      deviceName: "d"
    });

    return entry.root;
  }

  beforeEach(() => {
    window.localStorage.clear();
    shell.tokens.clear();
    shell.allowed.length = 0;
    shell.requests.length = 0;
    shell.setResponder(() => json({}));
    platformState.platform.remoteVaults = shell.api;
    platformState.platform.sharedVaults = remoteVaults.desktopSharedVaults;
    platformState.activeStorage = null;
    remoteVaults.resetRemoteVaultClients();
    remoteVaults.setActiveRemoteServer(null);
  });

  it("lists the shared vaults of the open server, and none for a local folder", async () => {
    const serverRoot = await addServer();
    shell.setResponder(() => json(OVERVIEW));

    remoteVaults.setActiveRemoteServer(serverRoot);
    const overview = await remoteVaults.desktopSharedVaults.overview();

    expect(overview?.vaults.map((vault) => vault.name)).toEqual(["Familie"]);
    expect(shell.requests[shell.requests.length - 1]).toMatchObject({
      url: "https://notes.example.com/anna/api/shared",
      headers: { authorization: "Bearer sdt_t_s" }
    });

    remoteVaults.setActiveRemoteServer("C:\\Notes");
    expect(await remoteVaults.desktopSharedVaults.overview()).toBeNull();
  });

  it("gives a shared vault a root below its server, and the instance keeps the token", async () => {
    const serverRoot = await addServer();
    remoteVaults.setActiveRemoteServer(serverRoot);

    const root = remoteVaults.desktopSharedVaults.rootFor("7f3a");

    expect(root).toBe("/@remote/notes.example.com/anna/@shared/7f3a");
    expect(remoteVaults.desktopSharedVaults.idOf(root)).toBe("7f3a");
    expect(remoteVaults.desktopSharedVaults.idOf(serverRoot)).toBeNull();
    expect(remoteVaults.desktopSharedVaults.homeRoot).toBe(serverRoot);
    // The token and the device list belong to the instance, not the vault.
    expect(remoteVaults.remoteVaultFor(root)).toBeNull();
  });

  it("installs a storage that works on the vault's own file API", async () => {
    const serverRoot = await addServer();
    remoteVaults.setActiveRemoteServer(serverRoot);
    const root = remoteVaults.desktopSharedVaults.rootFor("7f3a");

    shell.setResponder((url) => (url.endsWith("/api/shared") ? json(OVERVIEW) : json({ files: [] })));
    await remoteVaults.activateVaultStorage(root);

    const storage = platformState.activeStorage as { listMarkdownFiles(rootPath: string): Promise<unknown[]> };
    await storage.listMarkdownFiles(root);

    expect(shell.requests[shell.requests.length - 1]).toMatchObject({
      url: "https://notes.example.com/anna/api/v/7f3a/files",
      headers: { authorization: "Bearer sdt_t_s" }
    });
  });

  it("watches the shared vault's own event stream", async () => {
    const serverRoot = await addServer();
    remoteVaults.setActiveRemoteServer(serverRoot);
    const root = remoteVaults.desktopSharedVaults.rootFor("7f3a");

    await remoteVaults.watchRemoteVault(root);

    expect(shell.api.watch).toHaveBeenCalledWith(root, "wss://notes.example.com/anna/api/v/7f3a/events", "sdt_t_s");
  });

  it("sends the open note to the shell, for the other people's presence hints", async () => {
    const serverRoot = await addServer();
    remoteVaults.setActiveRemoteServer(serverRoot);

    remoteVaults.desktopSharedVaults.setOpenNote(remoteVaults.desktopSharedVaults.rootFor("7f3a"), "Einkauf.md");

    expect(shell.api.setPresencePath).toHaveBeenCalledWith("Einkauf.md");
  });
});
