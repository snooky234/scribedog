import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@tauri-apps/api/path", () => ({ join: async (...parts: string[]) => parts.join("/") }));

// The vault as the sidecar modules see it: a map from path to content.
const files = vi.hoisted(() => new Map<string, string>());

vi.mock("@tauri-apps/plugin-fs", () => ({
  exists: async (path: string) => files.has(path),
  mkdir: async () => undefined,
  readTextFile: async (path: string) => files.get(path) ?? "",
  remove: async (path: string) => void files.delete(path),
  writeTextFile: async (path: string, content: string) => void files.set(path, content)
}));

const { getVaultUser, InvalidVaultUserError, isValidVaultUserName, setVaultUser, userMetaDirPath, userMetaSegments } =
  await import("./userMeta");
const { readSessions, writeSessions } = await import("./chatSessions");
const { readSortMode, readManualOrder, writeManualOrder, writeSortMode } = await import("./vaultMeta");

const VAULT = "/vault";

beforeEach(() => {
  files.clear();
  setVaultUser(VAULT, null);
});

describe("user names", () => {
  it("accepts plain slugs", () => {
    for (const name of ["john", "lisa-2", "pia_m", "a"]) {
      expect(isValidVaultUserName(name), name).toBe(true);
    }
  });

  it("rejects anything that could steer a path", () => {
    for (const name of ["", "..", ".hidden", "john/../lisa", "a\\b", "John", "-lead", "x".repeat(33), "pia m"]) {
      expect(isValidVaultUserName(name), name).toBe(false);
    }
  });
});

describe("userMetaSegments", () => {
  it("is the common metadata folder for a vault of one", () => {
    expect(userMetaSegments(null)).toEqual([".scribedog"]);
  });

  it("is a folder per person in a shared vault", () => {
    expect(userMetaSegments("lisa")).toEqual([".scribedog", "users", "lisa"]);
  });

  it("refuses an invalid name instead of building a path from it", () => {
    expect(() => userMetaSegments("../server")).toThrow(InvalidVaultUserError);
  });
});

describe("the registered user of a vault", () => {
  it("decides the sidecar folder, per vault", async () => {
    setVaultUser("/vault/", "lisa");

    expect(getVaultUser(VAULT)).toBe("lisa");
    expect(await userMetaDirPath(VAULT)).toBe("/vault/.scribedog/users/lisa");
    expect(await userMetaDirPath("/other")).toBe("/other/.scribedog");

    setVaultUser(VAULT, null);
    expect(await userMetaDirPath(VAULT)).toBe("/vault/.scribedog");
  });

  it("fails when the vault is opened with a bad name, not on the first write", () => {
    expect(() => setVaultUser(VAULT, "Lisa")).toThrow(InvalidVaultUserError);
    expect(getVaultUser(VAULT)).toBeNull();
  });
});

describe("sidecars in a shared vault", () => {
  it("keeps chat sessions apart per person", async () => {
    const session = { id: "s1", title: "Hi", createdAt: 1, updatedAt: 1, assistantId: "default", messages: [] };

    setVaultUser(VAULT, "john");
    await writeSessions(VAULT, [session]);

    setVaultUser(VAULT, "lisa");
    expect(await readSessions(VAULT)).toEqual([]);

    setVaultUser(VAULT, "john");
    expect((await readSessions(VAULT)).map((stored) => stored.id)).toEqual(["s1"]);
    expect(files.has("/vault/.scribedog/users/john/chat-sessions.json")).toBe(true);
  });

  it("keeps the sort mode per person but the manual order shared", async () => {
    setVaultUser(VAULT, "john");
    await writeSortMode(VAULT, "name");
    await writeManualOrder(VAULT, { "": ["b.md", "a.md"] });

    setVaultUser(VAULT, "lisa");
    expect(await readSortMode(VAULT)).toBe("manual");
    expect(await readManualOrder(VAULT)).toEqual({ "": ["b.md", "a.md"] });
    expect(files.has("/vault/.scribedog/order.json")).toBe(true);
  });

  it("leaves a vault of one in the layout it always had", async () => {
    await writeSortMode(VAULT, "modified");

    expect(files.has("/vault/.scribedog/sort-mode.json")).toBe(true);
    expect(await readSortMode(VAULT)).toBe("modified");
  });
});
