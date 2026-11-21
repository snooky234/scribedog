// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from "vitest";

const STORAGE_KEY = "scribedog-ai-settings";

const server = vi.hoisted(() => ({
  enabled: true,
  stored: null as Record<string, unknown> | null,
  failReads: false,
  writes: [] as Record<string, unknown>[]
}));

vi.mock("@/platform", () => ({
  platform: {
    credentials: {
      storeApiKey: async () => undefined,
      getApiKey: async () => "",
      getStatus: async () => ({ state: "ready", discardedAt: null })
    },
    get preferences() {
      if (!server.enabled) {
        return null;
      }

      return {
        read: async (name: string) => {
          expect(name).toBe("ai-settings");

          if (server.failReads) {
            throw new Error("offline");
          }

          return server.stored;
        },
        write: async (_name: string, value: Record<string, unknown>) => {
          server.writes.push(value);
          server.stored = value;
        }
      };
    }
  }
}));

async function freshStore() {
  vi.resetModules();
  return import("./useAiSettingsStore");
}

describe("AI settings in the server edition", () => {
  beforeEach(() => {
    window.localStorage.clear();
    server.enabled = true;
    server.stored = null;
    server.failReads = false;
    server.writes = [];
  });

  it("takes the server's copy over this browser's", async () => {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify({ provider: "ollama", apiUrl: "http://localhost:11434" }));
    server.stored = { provider: "lmstudio", apiUrl: "http://localhost:1234", model: "qwen" };

    const { useAiSettingsStore } = await freshStore();
    await useAiSettingsStore.getState().loadSettings();

    expect(useAiSettingsStore.getState().settings).toMatchObject({ provider: "lmstudio", apiUrl: "http://localhost:1234", model: "qwen" });
    expect(JSON.parse(window.localStorage.getItem(STORAGE_KEY) ?? "{}")).toMatchObject({ provider: "lmstudio" });
  });

  it("hands this browser's settings to a server that has none yet", async () => {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify({ provider: "jan", apiUrl: "http://localhost:1337" }));

    const { useAiSettingsStore, flushAiSettingsWrites } = await freshStore();
    await useAiSettingsStore.getState().loadSettings();
    await flushAiSettingsWrites();

    expect(useAiSettingsStore.getState().settings.provider).toBe("jan");
    expect(server.writes).toHaveLength(1);
    expect(server.writes[0]).toMatchObject({ provider: "jan", apiUrl: "http://localhost:1337" });
  });

  it("does not upload the defaults of a browser that never saved anything", async () => {
    const { useAiSettingsStore, flushAiSettingsWrites } = await freshStore();
    await useAiSettingsStore.getState().loadSettings();
    await flushAiSettingsWrites();

    expect(server.writes).toHaveLength(0);
  });

  it("falls back to this browser's copy when the server cannot be reached", async () => {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify({ provider: "lmstudio", apiUrl: "http://localhost:1234" }));
    server.failReads = true;

    const { useAiSettingsStore } = await freshStore();
    await useAiSettingsStore.getState().loadSettings();

    expect(useAiSettingsStore.getState().settings.provider).toBe("lmstudio");
  });

  it("sends every change to the server, in order and without the API key", async () => {
    const { useAiSettingsStore, flushAiSettingsWrites } = await freshStore();
    await useAiSettingsStore.getState().loadSettings();

    useAiSettingsStore.getState().updateSettings({ provider: "openai", apiUrl: "https://api.openai.com/v1", apiKey: "sk-secret" });
    useAiSettingsStore.getState().updateSettings({ model: "gpt-x" });
    await flushAiSettingsWrites();

    expect(server.writes.map((value) => value.model)).toEqual(["", "gpt-x"]);
    expect(server.writes.every((value) => !("apiKey" in value))).toBe(true);
    expect(server.stored).toMatchObject({ provider: "openai", model: "gpt-x" });
  });

  it("stays in localStorage only on the desktop", async () => {
    server.enabled = false;

    const { useAiSettingsStore, flushAiSettingsWrites } = await freshStore();
    await useAiSettingsStore.getState().loadSettings();
    useAiSettingsStore.getState().updateSettings({ model: "llama" });
    await flushAiSettingsWrites();

    expect(server.writes).toHaveLength(0);
    expect(JSON.parse(window.localStorage.getItem(STORAGE_KEY) ?? "{}")).toMatchObject({ model: "llama" });
  });
});
