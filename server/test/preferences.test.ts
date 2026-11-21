import { readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { SERVER_META_DIR } from "../src/auth/authStore.js";
import { openPreferenceStore } from "../src/preferences/preferenceStore.js";
import { createTempVault, createTestContext, type TestContext } from "./helpers.js";

describe("preference store", () => {
  let vaultPath: string;

  beforeEach(async () => {
    vaultPath = await createTempVault();
  });

  afterEach(async () => {
    await rm(vaultPath, { recursive: true, force: true });
  });

  it("returns null before anything was stored", async () => {
    expect(await openPreferenceStore(vaultPath).get("ai-settings")).toBeNull();
  });

  it("stores an object and reads it back, without the API key", async () => {
    const store = openPreferenceStore(vaultPath);

    await store.set("ai-settings", { provider: "lmstudio", model: "qwen", apiKey: "sk-never" });

    expect(await store.get("ai-settings")).toEqual({ provider: "lmstudio", model: "qwen" });

    const raw = await readFile(path.join(vaultPath, SERVER_META_DIR, "preferences.json"), "utf8");
    expect(raw).not.toContain("sk-never");
  });

  it("keeps the last of several quick saves", async () => {
    const store = openPreferenceStore(vaultPath);

    await Promise.all([
      store.set("ai-settings", { model: "a" }),
      store.set("ai-settings", { model: "b" }),
      store.set("ai-settings", { model: "c" })
    ]);

    expect(await store.get("ai-settings")).toEqual({ model: "c" });
  });

  it("rejects values that are not objects or too large", async () => {
    const store = openPreferenceStore(vaultPath);

    await expect(store.set("ai-settings", ["a"])).rejects.toThrow();
    await expect(store.set("ai-settings", { model: "x".repeat(20_000) })).rejects.toThrow();
  });

  it("treats a damaged file as empty", async () => {
    const store = openPreferenceStore(vaultPath);
    await store.set("ai-settings", { model: "a" });
    await writeFile(path.join(vaultPath, SERVER_META_DIR, "preferences.json"), "{ not json", "utf8");

    expect(await store.get("ai-settings")).toBeNull();
  });
});

describe("preference routes", () => {
  let context: TestContext;

  beforeEach(async () => {
    context = await createTestContext();
  });

  afterEach(async () => {
    await context.cleanup();
  });

  it("requires a session", async () => {
    expect((await context.app.inject({ method: "GET", url: "/api/preferences/ai-settings" })).statusCode).toBe(401);
  });

  it("stores and returns the AI settings", async () => {
    const cookie = await context.login();

    expect((await context.app.inject({ method: "GET", url: "/api/preferences/ai-settings", headers: { cookie } })).json()).toEqual({
      value: null
    });

    const put = await context.app.inject({
      method: "PUT",
      url: "/api/preferences/ai-settings",
      headers: { cookie },
      payload: { value: { provider: "lmstudio", apiUrl: "http://localhost:1234" } }
    });
    expect(put.statusCode).toBe(204);

    expect((await context.app.inject({ method: "GET", url: "/api/preferences/ai-settings", headers: { cookie } })).json()).toEqual({
      value: { provider: "lmstudio", apiUrl: "http://localhost:1234" }
    });
  });

  it("answers 404 for a name it does not know", async () => {
    const cookie = await context.login();

    expect((await context.app.inject({ method: "GET", url: "/api/preferences/other", headers: { cookie } })).statusCode).toBe(404);
    expect(
      (await context.app.inject({ method: "PUT", url: "/api/preferences/other", headers: { cookie }, payload: { value: {} } })).statusCode
    ).toBe(404);
  });

  it("refuses a value that is not an object", async () => {
    const cookie = await context.login();

    const response = await context.app.inject({
      method: "PUT",
      url: "/api/preferences/ai-settings",
      headers: { cookie },
      payload: { value: "lmstudio" }
    });

    expect(response.statusCode).toBe(400);
  });
});
