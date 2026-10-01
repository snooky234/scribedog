import { describe, expect, it } from "vitest";

import {
  can,
  createVault,
  dismissNotice,
  emptyRegistry,
  folderNameFor,
  leaveVault,
  normalizeRegistry,
  overviewFor,
  registerPerson,
  removeVaults,
  requireAccess,
  restoreVault,
  slugify,
  trashVault,
  TRASH_RETENTION_MS,
  updateVault,
  vaultsDueForPurge,
  type SharedRegistry
} from "../src/shared/model.js";

const T0 = 1_700_000_000_000;

function setup(): SharedRegistry {
  let registry = emptyRegistry();

  for (const user of ["john", "lisa", "pia"]) {
    registry = registerPerson(registry, user, T0);
  }

  return registry;
}

function withFamily(): SharedRegistry {
  return createVault(setup(), { id: "7f3a", name: "Familie", creator: "john", members: ["lisa", "pia"], now: T0 }).registry;
}

describe("names and folders", () => {
  it("makes a folder-safe slug once, from the display name", () => {
    expect(slugify("Familie")).toBe("familie");
    expect(slugify("Rezepte & Ideen für Übermorgen")).toBe("rezepte-ideen-fuer-uebermorgen");
    expect(slugify("Café Crème")).toBe("cafe-creme");
    expect(slugify("../../etc")).toBe("etc");
    expect(slugify("日本語")).toBe("vault");
    expect(slugify("x".repeat(100))).toHaveLength(40);
    expect(folderNameFor("Familie", "7f3a")).toBe("familie-7f3a");
  });

  it("keeps the folder when the vault is renamed", () => {
    const { registry } = updateVault(withFamily(), "7f3a", "john", { name: "Familie Müller" }, T0 + 1);

    expect(registry.vaults[0]).toMatchObject({ name: "Familie Müller", folder: "familie-7f3a" });
  });

  it("rejects empty, overlong and control-character names", () => {
    // Line breaks and tabs collapse into spaces; other control characters are refused.
    for (const name of ["", "   ", "x".repeat(81), "a\u0007b", 42]) {
      expect(() => createVault(setup(), { id: "1234", name, creator: "john", members: [], now: T0 }), String(name)).toThrow();
    }
  });
});

describe("members", () => {
  it("always includes the creator and only takes known people", () => {
    const { vault } = createVault(setup(), { id: "abcd", name: "Solo", creator: "john", members: [], now: T0 });
    expect(vault.members).toEqual([{ user: "john", role: "editor" }]);

    expect(() =>
      createVault(setup(), { id: "abcd", name: "X", creator: "john", members: ["mallory"], now: T0 })
    ).toThrow(/not a person/);
  });

  it("stores members with a role, ready for a later reader role", () => {
    expect(withFamily().vaults[0].members).toEqual([
      { user: "john", role: "editor" },
      { user: "lisa", role: "editor" },
      { user: "pia", role: "editor" }
    ]);
  });

  it("reports who was removed so their sockets can be closed", () => {
    const { removedUsers, vault } = updateVault(withFamily(), "7f3a", "john", { members: ["lisa"] }, T0 + 1);

    expect(removedUsers).toEqual(["pia"]);
    expect(vault.members.map((member) => member.user)).toEqual(["john", "lisa"]);
  });

  it("cannot remove the creator", () => {
    const { vault } = updateVault(withFamily(), "7f3a", "john", { members: [] }, T0 + 1);

    expect(vault.members.map((member) => member.user)).toEqual(["john"]);
  });
});

describe("can", () => {
  const vault = withFamily().vaults[0];

  it("lets members read and write, and only the creator manage", () => {
    expect(can("lisa", vault, "read")).toBe(true);
    expect(can("lisa", vault, "write")).toBe(true);
    expect(can("lisa", vault, "manage")).toBe(false);
    expect(can("john", vault, "manage")).toBe(true);
    expect(can("carol", vault, "read")).toBe(false);
  });

  it("lets members leave, but not the creator", () => {
    expect(can("lisa", vault, "leave")).toBe(true);
    expect(can("john", vault, "leave")).toBe(false);
  });

  it("closes everything but the creator's restore once deleted", () => {
    const deleted = { ...vault, deletedAt: T0, deletedBy: "john" };

    expect(can("lisa", deleted, "read")).toBe(false);
    expect(can("john", deleted, "read")).toBe(false);
    expect(can("john", deleted, "restore")).toBe(true);
    expect(can("lisa", deleted, "restore")).toBe(false);
    expect(can("john", vault, "restore")).toBe(false);
  });
});

describe("requireAccess", () => {
  it("answers a stranger exactly like a vault that does not exist", () => {
    expect(() => requireAccess(withFamily(), "7f3a", "carol", "read")).toThrow(expect.objectContaining({ code: "not_found" }));
    expect(() => requireAccess(withFamily(), "ffff", "lisa", "read")).toThrow(expect.objectContaining({ code: "not_found" }));
  });

  it("says forbidden to a member asking for the creator's rights", () => {
    expect(() => requireAccess(withFamily(), "7f3a", "lisa", "manage")).toThrow(expect.objectContaining({ code: "forbidden" }));
  });

  it("says gone for a deleted vault", () => {
    const { registry } = trashVault(withFamily(), "7f3a", "john", { now: T0, noticeId: "n1" });

    expect(() => requireAccess(registry, "7f3a", "lisa", "read")).toThrow(expect.objectContaining({ code: "gone" }));
  });
});

describe("leaving", () => {
  it("takes the member off the vault", () => {
    const registry = leaveVault(withFamily(), "7f3a", "pia", T0 + 1);

    expect(registry.vaults[0].members.map((member) => member.user)).toEqual(["john", "lisa"]);
    expect(overviewFor(registry, "pia").vaults).toEqual([]);
  });

  it("is refused to the creator", () => {
    expect(() => leaveVault(withFamily(), "7f3a", "john", T0)).toThrow(/creator cannot leave/);
  });
});

describe("trash", () => {
  it("leaves a one-time notice for every other member and the creator's restore", () => {
    const { registry } = trashVault(withFamily(), "7f3a", "john", { now: T0, noticeId: "n1" });

    expect(overviewFor(registry, "lisa").notices).toEqual([
      { id: "n1", kind: "vault-deleted", vaultId: "7f3a", vaultName: "Familie", by: "john", at: T0 }
    ]);
    expect(overviewFor(registry, "lisa").vaults).toEqual([]);
    expect(overviewFor(registry, "john").notices).toEqual([]);
    expect(overviewFor(registry, "john").trash).toEqual([
      expect.objectContaining({ id: "7f3a", deletedAt: T0, purgeAt: T0 + TRASH_RETENTION_MS })
    ]);

    const dismissed = dismissNotice(registry, "n1", "lisa");
    expect(overviewFor(dismissed, "lisa").notices).toEqual([]);
    expect(overviewFor(dismissed, "pia").notices).toHaveLength(1);
    expect(dismissNotice(dismissed, "n1", "pia").notices).toEqual([]);
  });

  it("restores the vault and withdraws the notice", () => {
    const trashed = trashVault(withFamily(), "7f3a", "john", { now: T0, noticeId: "n1" }).registry;
    const { registry } = restoreVault(trashed, "7f3a", "john", T0 + 1);

    expect(overviewFor(registry, "lisa").vaults.map((vault) => vault.id)).toEqual(["7f3a"]);
    expect(registry.notices).toEqual([]);
    expect(() => restoreVault(trashed, "7f3a", "lisa", T0 + 1)).toThrow(expect.objectContaining({ code: "forbidden" }));
  });

  it("is due for purging after 30 days, and purging twice is harmless", () => {
    const trashed = trashVault(withFamily(), "7f3a", "john", { now: T0, noticeId: "n1" }).registry;

    expect(vaultsDueForPurge(trashed, T0 + TRASH_RETENTION_MS - 1)).toEqual([]);
    expect(vaultsDueForPurge(trashed, T0 + TRASH_RETENTION_MS).map((vault) => vault.id)).toEqual(["7f3a"]);

    const purged = removeVaults(trashed, ["7f3a"]);
    expect(purged.vaults).toEqual([]);
    expect(removeVaults(purged, ["7f3a"])).toEqual(purged);
  });
});

describe("overview", () => {
  it("shows only the vaults one is in", () => {
    let registry = withFamily();
    registry = createVault(registry, { id: "b0b0", name: "Haushalt", creator: "john", members: ["lisa"], now: T0 }).registry;

    expect(overviewFor(registry, "pia").vaults.map((vault) => vault.name)).toEqual(["Familie"]);
    expect(overviewFor(registry, "lisa").vaults.map((vault) => vault.name)).toEqual(["Familie", "Haushalt"]);
    expect(overviewFor(registry, "lisa").people).toEqual(["john", "lisa", "pia"]);
    expect(overviewFor(registry, "lisa").vaults[0].isCreator).toBe(false);
    expect(overviewFor(registry, "john").vaults[0].isCreator).toBe(true);
  });
});

describe("normalizeRegistry", () => {
  it("round-trips a valid registry", () => {
    const registry = trashVault(withFamily(), "7f3a", "john", { now: T0, noticeId: "n1" }).registry;

    expect(normalizeRegistry(JSON.parse(JSON.stringify(registry)))).toEqual(registry);
  });

  it("drops entries that do not hold up instead of trusting them", () => {
    const raw = {
      vaults: [
        { id: "7f3a", folder: "../escape", name: "x", creator: "john", members: [], createdAt: 1 },
        { id: "zz", folder: "ok-zz", name: "x", creator: "john", members: [], createdAt: 1 },
        { id: "1234", folder: "fine-1234", name: "Fine", creator: "john", members: [{ user: "john" }, { user: "../x" }], createdAt: 1 }
      ],
      people: { john: { registeredAt: 1 }, "Bad Name": { registeredAt: 1 } },
      notices: [{ id: "n", kind: "other" }]
    };

    const registry = normalizeRegistry(raw);

    expect(registry.vaults.map((vault) => vault.id)).toEqual(["1234"]);
    expect(registry.vaults[0].members).toEqual([{ user: "john", role: "editor" }]);
    expect(Object.keys(registry.people)).toEqual(["john"]);
    expect(registry.notices).toEqual([]);
    expect(normalizeRegistry("garbage")).toEqual(emptyRegistry());
  });
});
