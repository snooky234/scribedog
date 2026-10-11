import { beforeEach, describe, expect, it, vi } from "vitest";

// The module under test talks to the endpoint through Tauri's http plugin,
// which has no implementation outside the app shell.
const { fetchMock } = vi.hoisted(() => ({ fetchMock: vi.fn() }));

vi.mock("@tauri-apps/plugin-http", () => ({ fetch: fetchMock }));

const { embedTexts, fetchAvailableModels } = await import("./aiClient");

function jsonResponse(payload: unknown): Response {
  return { ok: true, status: 200, json: async () => payload } as unknown as Response;
}

function sentHeaders(call = 0): Record<string, string> {
  return (fetchMock.mock.calls[call] as [string, { headers: Record<string, string> }])[1].headers;
}

// A local model server may ask for a key as well (Jan.ai's API key, LM
// Studio's token, an Ollama behind a reverse proxy): it travels the same way
// as a cloud provider's, and only when one is set.
describe("API keys for local model servers", () => {
  beforeEach(() => {
    fetchMock.mockReset();
  });

  it("sends the key to an OpenAI-compatible local server", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ data: [{ id: "qwen3" }] }));

    await fetchAvailableModels("jan", "http://192.168.1.50:1337", "jan-secret");

    expect(fetchMock.mock.calls[0][0]).toBe("http://192.168.1.50:1337/v1/models");
    expect(sentHeaders().Authorization).toBe("Bearer jan-secret");
  });

  it("sends the key to Ollama's own API", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ models: [{ name: "qwen3" }] }));

    await fetchAvailableModels("ollama", "http://localhost:11434", "proxy-token");

    expect(fetchMock.mock.calls[0][0]).toBe("http://localhost:11434/api/tags");
    expect(sentHeaders().Authorization).toBe("Bearer proxy-token");
  });

  it("sends no header at all without a key", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ data: [] }));

    await fetchAvailableModels("lmstudio", "http://localhost:1234", "   ");

    expect(sentHeaders().Authorization).toBeUndefined();
  });

  it("uses the knowledge base's own key for embeddings", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ embeddings: [[0.1, 0.2]] }));

    await embedTexts({ provider: "ollama", apiUrl: "http://localhost:11434", apiKey: "embed-key", model: "nomic" }, ["a"]);

    expect(fetchMock.mock.calls[0][0]).toBe("http://localhost:11434/api/embed");
    expect(sentHeaders().Authorization).toBe("Bearer embed-key");

    fetchMock.mockResolvedValue(jsonResponse({ data: [{ index: 0, embedding: [0.1, 0.2] }] }));

    await embedTexts({ provider: "lmstudio", apiUrl: "http://localhost:1234", apiKey: "lm-key", model: "nomic" }, ["a"]);

    expect(fetchMock.mock.calls[1][0]).toBe("http://localhost:1234/v1/embeddings");
    expect(sentHeaders(1).Authorization).toBe("Bearer lm-key");
  });

  it("still refuses to send a local key anywhere outside the network", async () => {
    await expect(fetchAvailableModels("jan", "http://203.0.113.10:1337", "jan-secret")).rejects.toThrow();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
