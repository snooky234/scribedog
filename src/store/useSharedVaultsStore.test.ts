import { beforeEach, describe, expect, it, vi } from "vitest";

import type { SharedOverview } from "@/platform/types";

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

const { useSharedVaultsStore } = await import("./useSharedVaultsStore");

function fakeApi() {
  return {
    overview: vi.fn(async () => overview()),
    create: vi.fn(async () => family),
    update: vi.fn(async () => family),
    leave: vi.fn(async () => undefined),
    remove: vi.fn(async () => ({ purgeAt: 2 })),
    restore: vi.fn(async () => family),
    dismissNotice: vi.fn(async () => undefined),
    idOf: vi.fn((path: string) => (path === "/shared/7f3a" ? "7f3a" : null)),
    rootFor: vi.fn((id: string) => `/shared/${id}`)
  };
}

beforeEach(() => {
  api.current = fakeApi();
  useSharedVaultsStore.setState({ status: "idle", overview: null, error: null, isBusy: false, dialog: null, lost: null });
});

describe("useSharedVaultsStore", () => {
  it("is off where the platform has no shared vaults or the server is not set up", async () => {
    api.current = null;
    await useSharedVaultsStore.getState().refresh();
    expect(useSharedVaultsStore.getState().status).toBe("off");

    api.current = fakeApi();
    api.current.overview.mockResolvedValueOnce(null);
    await useSharedVaultsStore.getState().refresh();
    expect(useSharedVaultsStore.getState().status).toBe("off");
  });

  it("refreshes the overview after every change", async () => {
    api.current!.overview.mockResolvedValueOnce(overview()).mockResolvedValueOnce(overview([family]));
    await useSharedVaultsStore.getState().refresh();

    const created = await useSharedVaultsStore.getState().create("Familie", ["bob"]);

    expect(created).toEqual(family);
    expect(api.current!.create).toHaveBeenCalledWith("Familie", ["bob"]);
    expect(useSharedVaultsStore.getState().overview?.vaults).toEqual([family]);
    expect(useSharedVaultsStore.getState().isBusy).toBe(false);
  });

  it("turns a refusal into a message and keeps the last list", async () => {
    await useSharedVaultsStore.getState().refresh();
    api.current!.update.mockRejectedValueOnce(Object.assign(new Error("Only the creator can do that."), { status: 403 }));

    expect(await useSharedVaultsStore.getState().update("7f3a", { name: "X" })).toBe(false);

    const state = useSharedVaultsStore.getState();
    expect(state.error).toBeTruthy();
    expect(state.status).toBe("ready");
  });

  it("keeps the last list when the server cannot answer", async () => {
    api.current!.overview.mockResolvedValueOnce(overview([family]));
    await useSharedVaultsStore.getState().refresh();
    api.current!.overview.mockRejectedValueOnce(new Error("offline"));

    await useSharedVaultsStore.getState().refresh();

    expect(useSharedVaultsStore.getState().overview?.vaults).toEqual([family]);
  });

  it("hides a dismissed notice at once", async () => {
    await useSharedVaultsStore.getState().refresh();

    await useSharedVaultsStore.getState().dismissNotice("n1");

    expect(useSharedVaultsStore.getState().overview?.notices).toEqual([]);
    expect(api.current!.dismissNotice).toHaveBeenCalledWith("n1");
  });

  // Switching from a server vault to a local folder: the previous vault's
  // people and notices must not linger, or the file tree marks notes of the
  // new one as "open by someone else".
  it("drops presence and notices when the new vault has no shared vaults", async () => {
    api.current!.overview.mockResolvedValueOnce(overview([family]));
    await useSharedVaultsStore.getState().refresh();
    useSharedVaultsStore.getState().setPresence("/shared/7f3a", [{ user: "bob", path: "Note.md" }]);

    api.current!.overview.mockResolvedValueOnce(null);
    await useSharedVaultsStore.getState().refresh();

    const state = useSharedVaultsStore.getState();
    expect(state.status).toBe("off");
    expect(state.overview).toBeNull();
    expect(state.presence).toBeNull();
    expect(state.lost).toBeNull();
  });

  it("drops them for a platform without shared vaults too", async () => {
    useSharedVaultsStore.getState().setPresence("/shared/7f3a", [{ user: "bob", path: "Note.md" }]);
    api.current = null;

    await useSharedVaultsStore.getState().refresh();

    expect(useSharedVaultsStore.getState().presence).toBeNull();
  });

  it("remembers which vault was lost, by its name", async () => {
    api.current!.overview.mockResolvedValue(overview([family]));
    await useSharedVaultsStore.getState().refresh();

    useSharedVaultsStore.getState().markLost("/shared/7f3a", "deleted");

    expect(useSharedVaultsStore.getState().lost).toEqual({ folderPath: "/shared/7f3a", name: "Familie", reason: "deleted" });
  });

  // Deleting the open vault oneself closes its event stream at once; that
  // must not come back as "someone deleted your vault".
  it("does not report a vault as lost that the person is deleting or leaving themselves", async () => {
    api.current!.overview.mockResolvedValue(overview([family]));
    await useSharedVaultsStore.getState().refresh();
    api.current!.remove.mockImplementationOnce(async () => {
      useSharedVaultsStore.getState().markLost("/shared/7f3a", "deleted");
      return { purgeAt: 2 };
    });

    expect(await useSharedVaultsStore.getState().remove("7f3a")).toBe(true);
    useSharedVaultsStore.getState().markLost("/shared/7f3a", "deleted");

    expect(useSharedVaultsStore.getState().lost).toBeNull();
  });
});
