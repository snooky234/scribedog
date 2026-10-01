import { mkdtemp, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import WebSocket from "ws";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { registerPerson, TRASH_RETENTION_MS } from "../src/shared/model.js";
import { createRegistryStore } from "../src/shared/registryStore.js";
import { openSharedVaults } from "../src/shared/service.js";
import { createTestContext, type TestContext } from "./helpers.js";

const silentLog = { info: () => {}, warn: () => {} };

type Person = { context: TestContext; cookie: string };

/** A multi-instance setup in miniature: one instance per person, one shared folder. */
describe("shared vaults", () => {
  let sharedRoot: string;
  let clock: number;
  const people: Record<string, Person> = {};

  async function join(user: string): Promise<Person> {
    const context = await createTestContext(
      {},
      { shared: { root: sharedRoot, user, now: () => clock, accessPollMs: 50 } }
    );
    const person = { context, cookie: await context.login() };
    people[user] = person;
    return person;
  }

  function request(user: string, method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE", url: string, payload?: unknown) {
    const { context, cookie } = people[user];
    return context.app.inject({ method, url, headers: { cookie }, payload: payload as never });
  }

  async function createFamily(): Promise<string> {
    const response = await request("anna", "POST", "/api/shared/vaults", { name: "Familie", members: ["bob"] });
    expect(response.statusCode).toBe(201);
    return response.json().id as string;
  }

  // Three instances are expensive to start (a password hash and a login
  // each), so they start once; every test gets an empty shared folder with
  // just the three people registered, as right after a fresh start.
  beforeAll(async () => {
    sharedRoot = await mkdtemp(path.join(os.tmpdir(), "scribedog-shared-"));
    clock = 1_700_000_000_000;
    await join("anna");
    await join("bob");
    await join("carol");
  });

  beforeEach(async () => {
    clock = 1_700_000_000_000;

    // The instances outlive the tests, and a socket closed at the end of the
    // previous one may still write its presence file meanwhile; rm retries
    // a folder that filled up again under it.
    for (const entry of await readdir(sharedRoot)) {
      await rm(path.join(sharedRoot, entry), { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
    }

    await createRegistryStore(sharedRoot).update((registry) => ({
      registry: ["anna", "bob", "carol"].reduce((next, user) => registerPerson(next, user, clock), registry),
      result: undefined
    }));
  });

  afterAll(async () => {
    for (const person of Object.values(people)) {
      await person.context.cleanup();
    }

    // Closing an instance removes its presence file in the background.
    await rm(sharedRoot, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
  });

  it("is off on an instance that is not part of a shared setup", async () => {
    const context = await createTestContext();

    try {
      const cookie = await context.login();
      const response = await context.app.inject({ method: "GET", url: "/api/shared", headers: { cookie } });

      expect(response.json()).toEqual({ enabled: false });
      expect((await context.app.inject({ method: "GET", url: "/api/v/7f3a/files", headers: { cookie } })).statusCode).toBe(404);
    } finally {
      await context.cleanup();
    }
  });

  it("lists everyone whose instance has started as possible members", async () => {
    const overview = (await request("anna", "GET", "/api/shared")).json();

    expect(overview).toMatchObject({ enabled: true, me: "anna", people: ["anna", "bob", "carol"], vaults: [], trash: [] });
  });

  it("creates a vault in a folder named after it, visible to its members only", async () => {
    const id = await createFamily();

    expect(await readdir(sharedRoot)).toContain(`familie-${id}`);
    expect((await request("bob", "GET", "/api/shared")).json().vaults).toEqual([
      expect.objectContaining({ id, name: "Familie", creator: "anna", isCreator: false })
    ]);
    expect((await request("carol", "GET", "/api/shared")).json().vaults).toEqual([]);
  });

  it("serves the vault's files to members, and to nobody else", async () => {
    const id = await createFamily();

    const write = await request("bob", "PUT", `/api/v/${id}/fs/text`, { path: "Shopping.md", content: "# Milk\n", ifMatch: null });
    expect(write.statusCode).toBe(200);
    expect(await readFile(path.join(sharedRoot, `familie-${id}`, "Shopping.md"), "utf8")).toBe("# Milk\n");

    const list = await request("anna", "GET", `/api/v/${id}/files`);
    expect(list.json().files.map((file: { relativePath: string }) => file.relativePath)).toEqual(["Shopping.md"]);

    // A stranger learns nothing, not even that the vault exists.
    expect((await request("carol", "GET", `/api/v/${id}/files`)).statusCode).toBe(404);
    expect((await request("carol", "GET", `/api/v/ffff/files`)).statusCode).toBe(404);

    // The instance's own vault is untouched by any of this.
    expect((await request("bob", "GET", "/api/files")).json().files.map((file: { relativePath: string }) => file.relativePath)).toEqual([
      "Notes/Idea.md",
      "Welcome.md"
    ]);
  });

  it("keeps each person's sidecar folder to themselves", async () => {
    const id = await createFamily();
    await request("anna", "POST", `/api/v/${id}/fs/mkdir`, { path: ".scribedog/users/anna", recursive: true });

    const own = await request("anna", "PUT", `/api/v/${id}/fs/text`, { path: ".scribedog/users/anna/chat-sessions.json", content: "[]" });
    expect(own.statusCode).toBe(200);

    expect((await request("bob", "GET", `/api/v/${id}/fs/text?path=${encodeURIComponent(".scribedog/users/anna/chat-sessions.json")}`)).statusCode).toBe(400);
    expect((await request("bob", "PUT", `/api/v/${id}/fs/text`, { path: ".scribedog/users/anna/chat-sessions.json", content: "x" })).statusCode).toBe(400);
    expect((await request("bob", "POST", "/api/v/" + id + "/fs/remove", { path: ".scribedog/users/anna", recursive: true })).statusCode).toBe(400);
    // Shared sidecars are shared.
    expect((await request("bob", "PUT", `/api/v/${id}/fs/text`, { path: ".scribedog/order.json", content: "{}" })).statusCode).toBe(200);
  });

  it("lets only the creator rename and change members, and cuts a removed member off at once", async () => {
    const id = await createFamily();

    expect((await request("bob", "PATCH", `/api/shared/vaults/${id}`, { name: "Mine now" })).statusCode).toBe(403);

    const renamed = await request("anna", "PATCH", `/api/shared/vaults/${id}`, { name: "Familie Müller", members: ["carol"] });
    expect(renamed.statusCode).toBe(200);
    expect(renamed.json()).toMatchObject({ name: "Familie Müller", members: [{ user: "anna" }, { user: "carol" }] });

    // The folder keeps its name: bookmarks and remote roots stay valid.
    expect(await readdir(sharedRoot)).toContain(`familie-${id}`);
    expect((await request("bob", "GET", `/api/v/${id}/files`)).statusCode).toBe(404);
    expect((await request("carol", "GET", `/api/v/${id}/files`)).statusCode).toBe(200);
  });

  it("lets a member leave, but not the creator", async () => {
    const id = await createFamily();

    expect((await request("anna", "POST", `/api/shared/vaults/${id}/leave`)).statusCode).toBe(403);
    expect((await request("bob", "POST", `/api/shared/vaults/${id}/leave`)).statusCode).toBe(204);
    expect((await request("bob", "GET", "/api/shared")).json().vaults).toEqual([]);
    expect((await request("bob", "GET", `/api/v/${id}/files`)).statusCode).toBe(404);
  });

  it("moves a deleted vault to the trash, tells the members, and lets the creator restore it", async () => {
    const id = await createFamily();
    await request("bob", "PUT", `/api/v/${id}/fs/text`, { path: "Keep.md", content: "# keep\n" });

    expect((await request("bob", "DELETE", `/api/shared/vaults/${id}`)).statusCode).toBe(403);

    const removed = await request("anna", "DELETE", `/api/shared/vaults/${id}`);
    expect(removed.json()).toEqual({ purgeAt: clock + TRASH_RETENTION_MS });
    expect(await readdir(path.join(sharedRoot, ".trash"))).toEqual([`familie-${id}`]);

    // Someone with the vault open gets a clear answer, not a bare 404.
    const gone = await request("bob", "GET", `/api/v/${id}/files`);
    expect(gone.statusCode).toBe(410);
    expect(gone.json().error).toBe("vault_deleted");

    const bobsView = (await request("bob", "GET", "/api/shared")).json();
    expect(bobsView.vaults).toEqual([]);
    expect(bobsView.notices).toEqual([expect.objectContaining({ kind: "vault-deleted", vaultName: "Familie", by: "anna" })]);
    expect((await request("bob", "POST", `/api/shared/notices/${bobsView.notices[0].id}/dismiss`)).statusCode).toBe(204);
    expect((await request("bob", "GET", "/api/shared")).json().notices).toEqual([]);

    expect((await request("anna", "GET", "/api/shared")).json().trash).toEqual([expect.objectContaining({ id })]);

    expect((await request("anna", "POST", `/api/shared/vaults/${id}/restore`)).statusCode).toBe(200);
    expect(await readFile(path.join(sharedRoot, `familie-${id}`, "Keep.md"), "utf8")).toBe("# keep\n");
    expect((await request("bob", "GET", `/api/v/${id}/files`)).statusCode).toBe(200);
  });

  it("purges the trash after 30 days, in every container, idempotently", async () => {
    const id = await createFamily();
    await request("anna", "DELETE", `/api/shared/vaults/${id}`);

    expect(await people.anna.context.shared!.purgeExpired()).toEqual([]);

    clock += TRASH_RETENTION_MS;
    const results = await Promise.all([people.anna.context.shared!.purgeExpired(), people.bob.context.shared!.purgeExpired()]);

    expect(results.flat()).toEqual([id]);
    expect(await readdir(path.join(sharedRoot, ".trash"))).toEqual([]);
    expect((await request("anna", "GET", "/api/shared")).json().trash).toEqual([]);
    expect((await request("anna", "POST", `/api/shared/vaults/${id}/restore`)).statusCode).toBe(404);
  });

  it("keeps every change when several containers write the registry at once", async () => {
    const created = await Promise.all(
      ["Eins", "Zwei", "Drei", "Vier"].map((name, index) =>
        request(index % 2 === 0 ? "anna" : "bob", "POST", "/api/shared/vaults", { name, members: [] })
      )
    );

    expect(created.map((response) => response.statusCode)).toEqual([201, 201, 201, 201]);

    const registry = await createRegistryStore(sharedRoot).read();
    expect(registry.vaults.map((vault) => vault.name).sort()).toEqual(["Drei", "Eins", "Vier", "Zwei"]);
  });

  it("refuses unknown members and malformed requests", async () => {
    expect((await request("anna", "POST", "/api/shared/vaults", { name: "X", members: ["mallory"] })).statusCode).toBe(400);
    expect((await request("anna", "POST", "/api/shared/vaults", { members: [] })).statusCode).toBe(400);
  });

  it("does not start without a shared folder that exists", async () => {
    await expect(openSharedVaults({ root: path.join(sharedRoot, "missing"), user: "anna", log: silentLog })).rejects.toThrow(
      /does not exist/
    );
  });

  describe("live updates", () => {
    function connect(url: string, cookie: string): Promise<WebSocket> {
      return new Promise((resolve, reject) => {
        const socket = new WebSocket(url, { headers: { cookie } });
        socket.once("open", () => resolve(socket));
        socket.once("error", reject);
        socket.once("unexpected-response", (_request, response) => reject(new Error(`HTTP ${response.statusCode}`)));
      });
    }

    function closed(socket: WebSocket): Promise<number> {
      return new Promise((resolve) => socket.once("close", (code) => resolve(code)));
    }

    // Each instance listens once; the instances outlive the single test.
    const addresses = new Map<string, string>();

    async function baseUrl(user: string): Promise<string> {
      if (!addresses.has(user)) {
        addresses.set(user, (await people[user].context.app.listen({ host: "127.0.0.1", port: 0 })).replace(/^http/, "ws"));
      }

      return addresses.get(user)!;
    }

    it("tells members about changes in the shared vault", async () => {
      const id = await createFamily();
      const socket = await connect(`${await baseUrl("bob")}/api/v/${id}/events`, people.bob.cookie);

      try {
        const message = new Promise<string>((resolve) => socket.once("message", (data) => resolve(data.toString())));
        await writeFile(path.join(sharedRoot, `familie-${id}`, "New.md"), "# new\n");
        expect(JSON.parse(await message)).toEqual({ type: "files-changed" });
      } finally {
        socket.close();
      }
    });

    it("refuses the socket to a stranger", async () => {
      const id = await createFamily();

      await expect(connect(`${await baseUrl("carol")}/api/v/${id}/events`, people.carol.cookie)).rejects.toThrow(/404/);
    });

    it("closes a removed member's socket, even when the change came from another container", async () => {
      const id = await createFamily();
      const socket = await connect(`${await baseUrl("bob")}/api/v/${id}/events`, people.bob.cookie);
      const code = closed(socket);

      await request("anna", "PATCH", `/api/shared/vaults/${id}`, { members: [] });

      expect(await code).toBe(4003);
    });

    it("tells each member who else has which note open, across instances", async () => {
      const id = await createFamily();
      const annaSocket = await connect(`${await baseUrl("anna")}/api/v/${id}/events`, people.anna.cookie);
      const bobSocket = await connect(`${await baseUrl("bob")}/api/v/${id}/events`, people.bob.cookie);

      const presenceFrom = (socket: WebSocket, wanted: (editors: unknown[]) => boolean) =>
        new Promise<unknown[]>((resolve) => {
          socket.on("message", (data) => {
            const message = JSON.parse(data.toString()) as { type: string; editors?: unknown[] };

            if (message.type === "presence" && message.editors && wanted(message.editors)) {
              resolve(message.editors);
            }
          });
        });

      try {
        const seenByBob = presenceFrom(bobSocket, (editors) => editors.length > 0);
        annaSocket.send(JSON.stringify({ type: "presence", path: "Einkauf.md" }));
        expect(await seenByBob).toEqual([{ user: "anna", path: "Einkauf.md" }]);

        // Closing the note (or the tab) takes the entry away again.
        const clearedForBob = presenceFrom(bobSocket, (editors) => editors.length === 0);
        annaSocket.send(JSON.stringify({ type: "presence", path: null }));
        expect(await clearedForBob).toEqual([]);
      } finally {
        annaSocket.close();
        bobSocket.close();
        // Let the presence files be rewritten for the closed sockets before
        // the next test empties the shared folder.
        await new Promise((resolve) => setTimeout(resolve, 300));
      }
    });

    it("closes the sockets of a deleted vault with their own code", async () => {
      const id = await createFamily();
      const socket = await connect(`${await baseUrl("bob")}/api/v/${id}/events`, people.bob.cookie);
      const code = closed(socket);

      await request("anna", "DELETE", `/api/shared/vaults/${id}`);

      expect(await code).toBe(4004);
    });
  });

  it("writes the registry where no vault's file API reaches it", async () => {
    await createFamily();

    expect((await stat(path.join(sharedRoot, ".scribedog", "registry.json"))).isFile()).toBe(true);
  });
});
