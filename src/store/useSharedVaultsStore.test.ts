import { beforeEach, describe, expect, it, vi } from "vitest";

import type { SharedOverview, SharedVaultServer } from "@/platform/types";

const SERVER = "/@remote/notes.example.com/anna";

const overview = (vaults: SharedOverview["vaults"] = []): SharedOverview => ({
  me: "anna",
  people: ["anna", "bob"],
  vaults,
  trash: [],
  notices: [{ id: "n1", kind: "vault-deleted", vaultId: "0c12", vaultName: "Alt", by: "bob", at: 1 }]
});

const family = {
  id: "7f3a",
  name: "Familie",
  creator: "anna",
  members: [
    { user: "anna", role: "editor" as const },
    { user: "bob", role: "editor" as const }
  ],
  isCreator: true,
  createdAt: 1,
  updatedAt: 1
};

const servers = (vaults: SharedOverview["vaults"] = []): SharedVaultServer[] => [
  { root: SERVER, name: "Annas Vault", overview: overview(vaults) }
];

const api = vi.hoisted(() => ({
  current: null as null | Record<string, ReturnType<typeof vi.fn>>
}));

vi.mock("@/platform", () => ({
  platform: {
    get sharedVaults() {
      return api.current;
    }
  }
}));

const { findVault, useSharedVaultsStore } = await import("./useSharedVaultsStore");

function fakeApi() {
  return {
    servers: vi.fn(async () => servers()),
    connectedCount: vi.fn(() => 1),
    overview: vi.fn(async () => overview()),
    create: vi.fn(async () => family),
    update: vi.fn(async () => family),
    leave: vi.fn(async () => undefined),
    remove: vi.fn(async () => ({ purgeAt: 2 })),
    restore: vi.fn(async () => family),
    dismissNotice: vi.fn(async () => undefined),
    rootFor: vi.fn((serverRoot: string, id: string) => `${serverRoot}/@shared/${id}`),
    parseRoot: vi.fn((path: string) =>
      path === `${SERVER}/@shared/7f3a` ? { serverRoot: SERVER, id: "7f3a" } : null
    )
  };
}

beforeEach(() => {
  api.current = fakeApi();
  useSharedVaultsStore.setState({
    status: "idle",
    servers: [],
    connectedCount: 0,
    error: null,
    isBusy: false,
    dialog: null,
    lost: null,
    presence: null
  });
});

describe("useSharedVaultsStore", () => {
  it("is off where the platform has no shared vaults or no server offers them", async () => {
    api.current = null;
    await useSharedVaultsStore.getState().refresh();
    expect(useSharedVaultsStore.getState().status).toBe("off");

    api.current = fakeApi();
    api.current.servers.mockResolvedValueOnce([]);
    await useSharedVaultsStore.getState().refresh();
    expect(useSharedVaultsStore.getState().status).toBe("off");
  });

  it("reloads the servers after every change", async () => {
    api.current!.servers.mockResolvedValueOnce(servers()).mockResolvedValueOnce(servers([family]));
    await useSharedVaultsStore.getState().refresh();

    const created = await useSharedVaultsStore.getState().create(SERVER, "Familie", ["bob"]);

    expect(created).toEqual(family);
    expect(api.current!.create).toHaveBeenCalledWith(SERVER, "Familie", ["bob"]);
    expect(useSharedVaultsStore.getState().servers[0].overview.vaults).toEqual([family]);
    expect(useSharedVaultsStore.getState().isBusy).toBe(false);
  });

  it("turns a refusal into a message and keeps the last list", async () => {
    await useSharedVaultsStore.getState().refresh();
    api.current!.update.mockRejectedValueOnce(Object.assign(new Error("Only the creator can do that."), { status: 403 }));

    expect(await useSharedVaultsStore.getState().update(SERVER, "7f3a", { name: "X" })).toBe(false);

    const state = useSharedVaultsStore.getState();
    expect(state.error).toBeTruthy();
    expect(state.status).toBe("ready");
  });

  it("keeps the last list when a server cannot answer", async () => {
    api.current!.servers.mockResolvedValueOnce(servers([family]));
    await useSharedVaultsStore.getState().refresh();
    api.current!.servers.mockRejectedValueOnce(new Error("offline"));

    await useSharedVaultsStore.getState().refresh();

    expect(useSharedVaultsStore.getState().servers[0].overview.vaults).toEqual([family]);
  });

  it("hides a dismissed notice at once", async () => {
    await useSharedVaultsStore.getState().refresh();

    await useSharedVaultsStore.getState().dismissNotice(SERVER, "n1");

    expect(useSharedVaultsStore.getState().servers[0].overview.notices).toEqual([]);
    expect(api.current!.dismissNotice).toHaveBeenCalledWith(SERVER, "n1");
  });

  // Switching from a server vault to a local folder: the previous vault's
  // people and notices must not linger, or the file tree marks notes of the
  // new one as "open by someone else".
  it("drops presence and notices when no server offers shared vaults any more", async () => {
    api.current!.servers.mockResolvedValueOnce(servers([family]));
    await useSharedVaultsStore.getState().refresh();
    useSharedVaultsStore.getState().setPresence(`${SERVER}/@shared/7f3a`, [{ user: "bob", path: "Note.md" }]);

    api.current!.servers.mockResolvedValueOnce([]);
    await useSharedVaultsStore.getState().refresh();

    const state = useSharedVaultsStore.getState();
    expect(state.status).toBe("off");
    expect(state.servers).toEqual([]);
    expect(state.presence).toBeNull();
    expect(state.lost).toBeNull();
  });

  it("drops them for a platform without shared vaults too", async () => {
    useSharedVaultsStore.getState().setPresence(`${SERVER}/@shared/7f3a`, [{ user: "bob", path: "Note.md" }]);
    api.current = null;

    await useSharedVaultsStore.getState().refresh();

    expect(useSharedVaultsStore.getState().presence).toBeNull();
  });

  it("remembers which vault was lost, by its name", async () => {
    api.current!.servers.mockResolvedValue(servers([family]));
    await useSharedVaultsStore.getState().refresh();

    useSharedVaultsStore.getState().markLost(`${SERVER}/@shared/7f3a`, "deleted");

    expect(useSharedVaultsStore.getState().lost).toEqual({
      folderPath: `${SERVER}/@shared/7f3a`,
      name: "Familie",
      reason: "deleted"
    });
  });

  // Deleting the open vault oneself closes its event stream at once; that
  // must not come back as "someone deleted your vault".
  it("does not report a vault as lost that the person is deleting or leaving themselves", async () => {
    api.current!.servers.mockResolvedValue(servers([family]));
    await useSharedVaultsStore.getState().refresh();
    api.current!.remove.mockImplementationOnce(async () => {
      useSharedVaultsStore.getState().markLost(`${SERVER}/@shared/7f3a`, "deleted");
      return { purgeAt: 2 };
    });

    expect(await useSharedVaultsStore.getState().remove(SERVER, "7f3a")).toBe(true);
    useSharedVaultsStore.getState().markLost(`${SERVER}/@shared/7f3a`, "deleted");

    expect(useSharedVaultsStore.getState().lost).toBeNull();
  });

  // What the vault menu hides "Manage server vaults…" by: with no server
  // connected there is nothing to manage.
  it("keeps the number of connected servers, reachable or not", async () => {
    api.current!.connectedCount.mockReturnValue(2);
    api.current!.servers.mockResolvedValueOnce([]);

    await useSharedVaultsStore.getState().refresh();

    expect(useSharedVaultsStore.getState().connectedCount).toBe(2);
    expect(useSharedVaultsStore.getState().servers).toEqual([]);

    api.current = null;
    await useSharedVaultsStore.getState().refresh();
    expect(useSharedVaultsStore.getState().connectedCount).toBe(0);
  });

  it("finds a vault by the server it lives on", () => {
    const list = servers([family]);

    expect(findVault(list, SERVER, "7f3a")).toEqual(family);
    expect(findVault(list, "/@remote/other", "7f3a")).toBeNull();
    expect(findVault(list, SERVER, "ffff")).toBeNull();
  });
});
