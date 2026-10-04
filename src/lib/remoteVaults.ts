import i18n from "@/i18n";
import { isHttpsUrl, isLocalApiUrl } from "@/lib/aiClient";
import { platform, setActiveVaultStorage, SessionError } from "@/platform";
import { createRemoteVaultStorage } from "@/platform/remote/remoteStorage";
import {
  createServerApi,
  scopedTransport,
  type RemoteAccessToken,
  type ServerApi,
  type ServerTransport
} from "@/platform/remote/serverApi";
import {
  isRemoteVaultPath,
  parseSharedVaultRoot,
  remoteVaultRootFor,
  serverRootOf,
  sharedVaultRootFor
} from "@/platform/remote/vaultRoot";
import { setVaultUser } from "@/lib/userMeta";
import type {
  SharedOverview,
  SharedPresenceEditor,
  SharedVaultsApi,
  SharedVaultServer,
  VaultStorage
} from "@/platform/types";

export { isRemoteVaultPath };
export type { RemoteAccessToken };

/**
 * Server vaults in the desktop app: the list of servers the user added, the
 * token flow against each, and the switch that makes the store read and write
 * one of them instead of a local folder.
 *
 * The list lives in `localStorage` like the recent folders; the tokens do not.
 * They are in the OS credential store (through `platform.remoteVaults`), the
 * way the API keys are, and the password is held only for the one request
 * that trades it for a token.
 *
 * Everything here is keyed by the vault root (see platform/remote/vaultRoot),
 * which is also the `folderPath` the store sees, so the rest of the app can
 * keep treating a server vault as a folder.
 */

export type RemoteVaultEntry = {
  /** The virtual root that stands for this vault in the store. */
  root: string;
  /** Normalized server URL, base path included, no trailing slash. */
  url: string;
  /** What the sidebar shows. */
  name: string;
  /** The id of this device's token on the server, for "this device" in the list. */
  tokenId: string | null;
  addedAt: string;
};

const STORAGE_KEY = "scribedog:remoteVaults";

/**
 * The same rule the AI endpoints follow (assertValidEndpoint in aiClient):
 * HTTPS everywhere except on the machine itself. Returns the URL in the form
 * the identity is built from.
 */
export function normalizeServerUrl(input: string): string {
  const trimmed = input.trim();
  let url: URL;

  try {
    url = new URL(/^[a-z]+:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`);
  } catch {
    throw new Error(i18n.t("remoteVaults.invalidUrl"));
  }

  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new Error(i18n.t("remoteVaults.invalidUrl"));
  }

  if (!isHttpsUrl(url.toString()) && !isLocalApiUrl(url.toString())) {
    throw new Error(i18n.t("remoteVaults.urlMustBeHttps"));
  }

  url.search = "";
  url.hash = "";
  url.pathname = url.pathname.replace(/\/+$/, "");

  return url.toString().replace(/\/+$/, "");
}

function readEntries(): RemoteVaultEntry[] {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : [];

    if (!Array.isArray(parsed)) {
      return [];
    }

    return parsed.filter(
      (entry): entry is RemoteVaultEntry =>
        !!entry &&
        typeof entry === "object" &&
        typeof (entry as RemoteVaultEntry).root === "string" &&
        typeof (entry as RemoteVaultEntry).url === "string" &&
        typeof (entry as RemoteVaultEntry).name === "string"
    );
  } catch {
    return [];
  }
}

/**
 * The server list lives in localStorage, which no component can observe, so
 * every reader that renders it subscribes here. Renaming a server reaches
 * the sidebar and the vault menu right away rather than at the next start.
 */
const listeners = new Set<() => void>();
let snapshot: RemoteVaultEntry[] | null = null;

export function subscribeToRemoteVaults(listener: () => void): () => void {
  listeners.add(listener);

  return () => {
    listeners.delete(listener);
  };
}

/** A stable array for useSyncExternalStore; a fresh one would loop forever. */
export function getRemoteVaultsSnapshot(): RemoteVaultEntry[] {
  snapshot ??= listRemoteVaults();

  return snapshot;
}

function writeEntries(entries: RemoteVaultEntry[]): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(entries));
  } catch {
    // localStorage may be unavailable in some environments.
  }

  snapshot = null;
  listeners.forEach((listener) => listener());
}

export function listRemoteVaults(): RemoteVaultEntry[] {
  return platform.features.remoteVaults ? readEntries() : [];
}

/**
 * Registers every server the app knows with the shell, which keeps the
 * allowlist in memory and therefore starts empty (see
 * src-tauri/src/remote_vault.rs). Called once at startup, before anything
 * asks a server something: opening a vault registers its own server, but the
 * vault menu lists the shared vaults of all of them, and that happens before
 * any vault is open.
 */
export async function allowKnownRemoteServers(): Promise<void> {
  const shell = platform.remoteVaults;

  if (!shell) {
    return;
  }

  await Promise.all(
    readEntries().map((entry) =>
      // A malformed entry (hand-edited localStorage) must not keep the
      // others from being registered.
      shell.allowServer(originOf(entry.url)).catch(() => undefined)
    )
  );
}

export function remoteVaultFor(folderPath: string | null): RemoteVaultEntry | null {
  if (!folderPath || !isRemoteVaultPath(folderPath)) {
    return null;
  }

  return readEntries().find((entry) => entry.root === folderPath) ?? null;
}

function upsertEntry(entry: RemoteVaultEntry): void {
  writeEntries([...readEntries().filter((existing) => existing.root !== entry.root), entry]);
}

/** A sensible default for the device name the server lists: the app and the OS. */
export function defaultDeviceName(): string {
  const agent = typeof navigator === "undefined" ? "" : navigator.userAgent;
  const os = /Windows/i.test(agent) ? "Windows" : /Mac OS X|Macintosh/i.test(agent) ? "macOS" : /Linux/i.test(agent) ? "Linux" : null;

  return os ? i18n.t("remoteVaults.defaultDeviceNameOn", { os }) : i18n.t("remoteVaults.defaultDeviceName");
}

/*
 * One client per server, created on first use and kept for the session. The
 * token is loaded from the credential store once and swapped in place after
 * a new sign-in, so a request that was refused a moment ago works again
 * without reopening the vault.
 */
type Client = {
  api: ServerApi;
  token: string | null;
  tokenLoaded: boolean;
  /** How a request to this server is sent, for the clients of its shared vaults. */
  transport: ServerTransport;
  /** Everything that wants to know the session was refused, shared with those clients. */
  unauthorizedHandlers: Set<() => void>;
  /** One storage per shared vault of this server, built on first open. */
  sharedStorages: Map<string, VaultStorage>;
};

const clients = new Map<string, Client>();
const unauthorizedHandlers = new Set<(root: string) => void>();
let rustUnauthorizedListener: Promise<() => void> | null = null;

function requireShell() {
  if (!platform.remoteVaults) {
    throw new Error(i18n.t("platform.notAvailable"));
  }

  return platform.remoteVaults;
}

function notifyUnauthorized(root: string): void {
  for (const handler of unauthorizedHandlers) {
    handler(root);
  }
}

function clientFor(entry: RemoteVaultEntry): Client {
  const existing = clients.get(entry.root);

  if (existing) {
    return existing;
  }

  const shell = requireShell();
  const client = {
    api: undefined as unknown as ServerApi,
    token: null as string | null,
    tokenLoaded: false,
    transport: undefined as unknown as ServerTransport,
    unauthorizedHandlers: new Set<() => void>(),
    sharedStorages: new Map<string, VaultStorage>()
  } satisfies Partial<Client> as Client;

  client.transport = {
    fetch: (apiPath, init) =>
      shell.fetch(`${entry.url}/api${apiPath}`, {
        ...init,
        headers: client.token ? { ...init.headers, authorization: `Bearer ${client.token}` } : init.headers
      })
  };

  const { api, onUnauthorized } = createServerApi(client.transport, {
    unauthorizedHandlers: client.unauthorizedHandlers
  });
  client.api = api;
  onUnauthorized(() => notifyUnauthorized(entry.root));
  clients.set(entry.root, client);

  return client;
}

async function loadToken(entry: RemoteVaultEntry, client: Client): Promise<void> {
  if (!client.tokenLoaded) {
    client.token = await requireShell().getToken(entry.root);
    client.tokenLoaded = true;
  }
}

/**
 * Fires when a server refuses this device's token, from a request or from
 * the live-update connection. The app answers with the sign-in dialog.
 */
export function onRemoteVaultUnauthorized(handler: (root: string) => void): () => void {
  unauthorizedHandlers.add(handler);

  if (platform.remoteVaults && !rustUnauthorizedListener) {
    rustUnauthorizedListener = platform.remoteVaults.onUnauthorized(notifyUnauthorized);
  }

  return () => {
    unauthorizedHandlers.delete(handler);
  };
}

function originOf(url: string): string {
  return new URL(url).origin;
}

export type AddRemoteVaultInput = {
  url: string;
  password: string;
  name: string;
  deviceName: string;
};

/**
 * Adds a server: validates the address, trades the password for a token,
 * stores the token and records the entry. The password is not kept. Rejects
 * with `SessionError` for a wrong password or an unreachable server, so the
 * dialog can say which.
 */
export async function addRemoteVault(input: AddRemoteVaultInput): Promise<RemoteVaultEntry> {
  const shell = requireShell();
  const url = normalizeServerUrl(input.url);
  const root = remoteVaultRootFor(url);
  const name = input.name.trim() || new URL(url).host;
  const existing = readEntries().find((entry) => entry.root === root);
  const entry: RemoteVaultEntry = {
    root,
    url,
    name,
    tokenId: existing?.tokenId ?? null,
    addedAt: existing?.addedAt ?? new Date().toISOString()
  };

  await shell.allowServer(originOf(url));

  // The entry is not on the list yet, so the client is built by hand and
  // only kept once the token is in.
  clients.delete(root);
  const client = clientFor(entry);
  client.tokenLoaded = true;
  client.token = null;

  const issued = await client.api.issueToken(input.password, input.deviceName.trim() || defaultDeviceName());

  await shell.storeToken(root, issued.token);
  client.token = issued.token;
  entry.tokenId = issued.id;
  upsertEntry(entry);

  return entry;
}

/**
 * Replaces a token the server no longer accepts (revoked, or the password
 * changed) with a fresh one. Same proof as adding: the password.
 */
export async function signInRemoteVault(root: string, password: string, deviceName: string): Promise<void> {
  const entry = remoteVaultFor(root);

  if (!entry) {
    throw new Error(i18n.t("remoteVaults.unknownServer"));
  }

  const shell = requireShell();
  await shell.allowServer(originOf(entry.url));

  const client = clientFor(entry);
  const issued = await client.api.issueToken(password, deviceName.trim() || defaultDeviceName());

  await shell.storeToken(root, issued.token);
  client.token = issued.token;
  client.tokenLoaded = true;
  upsertEntry({ ...entry, tokenId: issued.id });
}

/**
 * Forgets a server: revokes this device's token on the server (best effort,
 * the server may be away), deletes it from the credential store and drops
 * the entry. The per-vault markers in localStorage stay, so adding the same
 * server again picks up where it left off.
 */
export async function removeRemoteVault(root: string, { revoke = true }: { revoke?: boolean } = {}): Promise<void> {
  const entry = remoteVaultFor(root);

  if (!entry) {
    return;
  }

  const shell = requireShell();

  if (revoke && entry.tokenId) {
    try {
      const client = clientFor(entry);
      await loadToken(entry, client);
      await client.api.revokeToken(entry.tokenId);
    } catch {
      // Unreachable or already revoked: the local copy goes either way.
    }
  }

  await shell.deleteToken(root);
  clients.delete(root);
  writeEntries(readEntries().filter((existing) => existing.root !== root));
}

export function renameRemoteVault(root: string, name: string): void {
  const entry = remoteVaultFor(root);

  if (entry && name.trim()) {
    upsertEntry({ ...entry, name: name.trim() });
  }
}

async function readyClient(root: string): Promise<{ entry: RemoteVaultEntry; client: Client }> {
  // A shared vault has no entry of its own: it belongs to the instance it
  // lives on, and that is whose token, client and sign-in it uses.
  const serverRoot = serverRootOf(root);
  const entry = remoteVaultFor(serverRoot);

  if (!entry) {
    throw new Error(i18n.t("remoteVaults.unknownServer"));
  }

  const client = clientFor(entry);
  await loadToken(entry, client);

  if (!client.token) {
    notifyUnauthorized(serverRoot);
    throw new SessionError("unauthorized", i18n.t("remoteVaults.notSignedIn"));
  }

  return { entry, client };
}

/** The server's list of signed-in devices, this one marked `current`. */
export async function listRemoteDevices(root: string): Promise<RemoteAccessToken[]> {
  const { client } = await readyClient(root);

  return client.api.listTokens();
}

export async function revokeRemoteDevice(root: string, tokenId: string): Promise<void> {
  const { client } = await readyClient(root);

  await client.api.revokeToken(tokenId);
}

/**
 * The switch itself, called at the start of every open: a server vault gets
 * its storage installed, anything else puts the platform's own back. Also
 * where a missing token is noticed, so the sign-in dialog appears instead of
 * a failed listing.
 */
export async function activateVaultStorage(folderPath: string): Promise<void> {
  // A shared vault of the server this frontend runs on (the browser) has a
  // root of its own and a storage the platform hands out per vault.
  const sharedStorage = await platform.sharedVaults?.storageFor(folderPath);

  if (sharedStorage) {
    setActiveVaultStorage(sharedStorage);
    return;
  }

  if (!isRemoteVaultPath(folderPath)) {
    setActiveVaultStorage(null);
    return;
  }

  const shared = parseSharedVaultRoot(folderPath);
  const { entry, client } = await readyClient(folderPath);
  await requireShell().allowServer(originOf(entry.url));

  if (shared) {
    setActiveVaultStorage(await sharedStorageFor(entry, client, shared.vaultId, folderPath));
    return;
  }

  setActiveVaultStorage(createRemoteVaultStorage(client.api, entry.root));
}

/**
 * The storage of one shared vault: the same client as its server, pointed at
 * that vault's own file API (`/api/v/<id>`), and the person the vault is
 * opened as, which is what gives them their own chat history and proposals
 * in it (src/lib/userMeta.ts).
 */
async function sharedStorageFor(
  entry: RemoteVaultEntry,
  client: Client,
  vaultId: string,
  root: string
): Promise<VaultStorage> {
  const overview = sharedOverviews.get(entry.root) ?? (await loadSharedOverview(entry.root));

  if (!overview) {
    throw new Error(i18n.t("sharedVaults.errorGone"));
  }

  setVaultUser(root, overview.me);
  let storage = client.sharedStorages.get(vaultId);

  if (!storage) {
    const scoped = createServerApi(scopedTransport(client.transport, `/v/${vaultId}`), {
      unauthorizedHandlers: client.unauthorizedHandlers
    });
    storage = createRemoteVaultStorage(scoped.api, root);
    client.sharedStorages.set(vaultId, storage);
  }

  return storage;
}

/** Where the server's change stream lives, for the shell's live-update client. */
function eventsUrlFor(entry: RemoteVaultEntry, vaultId: string | null): string {
  const scope = vaultId ? `/v/${vaultId}` : "";

  return `${entry.url.replace(/^http/, "ws")}/api${scope}/events`;
}

export async function watchRemoteVault(root: string): Promise<void> {
  const { entry, client } = await readyClient(root);

  await requireShell().watch(root, eventsUrlFor(entry, parseSharedVaultRoot(root)?.vaultId ?? null), client.token ?? "");
}

/*
 * Shared vaults of the servers the desktop app has added (server/docs/
 * multiuser.md). The management calls go to the instance's own API, each
 * vault's files to its own one; the token is the instance's, so nothing of
 * the sign-in changes.
 *
 * Listed for every server, not only the open one: someone in a local folder
 * should be able to jump straight into a shared vault, the way they can into
 * any other vault. The overviews are cached per server and refreshed
 * whenever the menu opens.
 */

const sharedOverviews = new Map<string, SharedOverview | null>();
const sharedLossHandlers = new Set<(folderPath: string, reason: "removed" | "deleted") => void>();
const sharedPresenceHandlers = new Set<(folderPath: string, editors: SharedPresenceEditor[]) => void>();
// The shell is listened to once; the handlers above come and go with the UI.
let sharedPresenceListener: Promise<() => void> | null = null;
let sharedAccessLostListener: Promise<() => void> | null = null;

async function loadSharedOverview(serverRoot: string): Promise<SharedOverview | null> {
  const { client } = await readyClient(serverRoot);
  const overview = await client.api.sharedOverview();
  sharedOverviews.set(serverRoot, overview);

  return overview;
}

function reportSharedLoss(folderPath: string, reason: "removed" | "deleted"): void {
  for (const handler of sharedLossHandlers) {
    handler(folderPath, reason);
  }
}

function reportSharedPresence(folderPath: string, editors: SharedPresenceEditor[]): void {
  for (const handler of sharedPresenceHandlers) {
    handler(folderPath, editors);
  }
}

export const desktopSharedVaults: SharedVaultsApi = {
  async servers() {
    const entries = listRemoteVaults();
    const overviews = await Promise.all(
      entries.map((entry) =>
        // A server that is away, or whose token was refused, is left out of
        // the list rather than taking the others down with it.
        loadSharedOverview(entry.root).catch(() => null)
      )
    );

    return entries
      .map((entry, index) => ({ root: entry.root, name: entry.name, overview: overviews[index] }))
      .filter((server): server is SharedVaultServer => server.overview !== null);
  },

  connectedCount: () => listRemoteVaults().length,

  async overview(serverRoot) {
    return loadSharedOverview(serverRoot);
  },

  async create(serverRoot, name, members) {
    const { client } = await readyClient(serverRoot);
    return client.api.createSharedVault(name, members);
  },

  async update(serverRoot, id, changes) {
    const { client } = await readyClient(serverRoot);
    return client.api.updateSharedVault(id, changes);
  },

  async leave(serverRoot, id) {
    const { client } = await readyClient(serverRoot);
    await client.api.leaveSharedVault(id);
  },

  async remove(serverRoot, id) {
    const { client } = await readyClient(serverRoot);
    return client.api.deleteSharedVault(id);
  },

  async restore(serverRoot, id) {
    const { client } = await readyClient(serverRoot);
    return client.api.restoreSharedVault(id);
  },

  async dismissNotice(serverRoot, id) {
    const { client } = await readyClient(serverRoot);
    await client.api.dismissSharedNotice(id);
  },

  rootFor: (serverRoot, id) => sharedVaultRootFor(serverRoot, id),
  parseRoot: (folderPath) => {
    const parsed = parseSharedVaultRoot(folderPath);

    return parsed ? { serverRoot: parsed.serverRoot, id: parsed.vaultId } : null;
  },

  async storageFor() {
    // Opening goes through activateVaultStorage above, which has the server's
    // client at hand; this entry point is the browser's.
    return null;
  },

  setOpenNote: (_folderPath, relativePath) => {
    void platform.remoteVaults?.setPresencePath(relativePath);
  },

  onPresence(handler) {
    sharedPresenceHandlers.add(handler);
    sharedPresenceListener ??= platform.remoteVaults?.onPresence(reportSharedPresence) ?? null;

    return () => {
      sharedPresenceHandlers.delete(handler);
    };
  },

  onAccessLost(handler) {
    sharedLossHandlers.add(handler);
    sharedAccessLostListener ??= platform.remoteVaults?.onAccessLost(reportSharedLoss) ?? null;

    return () => {
      sharedLossHandlers.delete(handler);
    };
  }
};

/** Only for tests: forgets the cached clients. */
export function resetRemoteVaultClients(): void {
  clients.clear();
}
