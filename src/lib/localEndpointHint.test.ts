import { beforeEach, describe, expect, it, vi } from "vitest";

import type { LocalEndpointDiagnosis, LocalModelsApi } from "@/platform/types";

vi.mock("@tauri-apps/api/path", () => ({ join: async (...parts: string[]) => parts.join("/") }));
vi.mock("@tauri-apps/plugin-fs", () => ({}));

const diagnose = vi.fn<LocalModelsApi["diagnose"]>();
const platform: { localModels: LocalModelsApi | null } = {
  localModels: { origin: "https://notes.example.com", diagnose }
};

vi.mock("@/platform", () => ({ platform, PlatformUnavailableError: class extends Error {} }));
// t() echoes the key with its variables, so a test can see both which
// sentence was chosen and what went into it.
vi.mock("@/i18n", () => ({
  default: { t: (key: string, vars?: Record<string, string>) => `${key} ${JSON.stringify(vars ?? {})}` }
}));

const { describeAiError, explainLocalEndpointFailure, localOriginInstruction } = await import("./localEndpointHint");

const networkError = new TypeError("Failed to fetch");

describe("explainLocalEndpointFailure", () => {
  beforeEach(() => {
    diagnose.mockReset();
    platform.localModels = { origin: "https://notes.example.com", diagnose };
  });

  it("names the browser permission when it was denied", async () => {
    diagnose.mockResolvedValue("permission");

    const text = await explainLocalEndpointFailure("ollama", "http://localhost:11434", networkError);

    expect(text).toContain("aiClient.localBrowserPermission");
    expect(text).toContain("http://localhost:11434");
    expect(diagnose).toHaveBeenCalledWith("ollama", "http://localhost:11434");
  });

  it("tells the user what the server has to allow when it refuses the origin", async () => {
    diagnose.mockResolvedValue("cors");

    const text = await explainLocalEndpointFailure("jan", "http://localhost:1337", networkError);

    expect(text).toContain("aiClient.localBrowserCors");
    expect(text).toContain('"origin":"https://notes.example.com"');
    // The instruction is nested (and so escaped) inside the sentence.
    expect(text).toContain("aiClient.localOriginJan");
    expect(text).toContain("notes.example.com");
  });

  it("says nothing answered when nothing did", async () => {
    diagnose.mockResolvedValue("unreachable");

    expect(await explainLocalEndpointFailure("lmstudio", "http://localhost:1234", networkError)).toContain(
      "aiClient.localBrowserUnreachable"
    );
  });

  it("does not probe a model server elsewhere in the network from the tab", async () => {
    diagnose.mockResolvedValue("cors");

    expect(await explainLocalEndpointFailure("jan", "http://192.168.1.50:1337", networkError)).toBeNull();
    expect(diagnose).not.toHaveBeenCalled();
  });

  it("stays out of it when the request works again, on the desktop, for cloud providers and other errors", async () => {
    diagnose.mockResolvedValue("ok" as LocalEndpointDiagnosis);
    expect(await explainLocalEndpointFailure("ollama", "http://localhost:11434", networkError)).toBeNull();

    diagnose.mockResolvedValue("cors");
    expect(await explainLocalEndpointFailure("openai", "https://api.openai.com", networkError)).toBeNull();
    expect(await explainLocalEndpointFailure("ollama", "http://localhost:11434", new Error("model not found"))).toBeNull();

    platform.localModels = null;
    expect(await explainLocalEndpointFailure("ollama", "http://localhost:11434", networkError)).toBeNull();
    expect(diagnose).toHaveBeenCalledTimes(1);
  });
});

describe("localOriginInstruction", () => {
  it("carries the origin to Ollama and the host to Jan", () => {
    expect(localOriginInstruction("ollama", "https://notes.example.com")).toContain('"origin":"https://notes.example.com"');
    expect(localOriginInstruction("jan", "https://notes.example.com:9443")).toContain('"host":"notes.example.com:9443"');
    expect(localOriginInstruction("lmstudio", "https://notes.example.com")).toContain("aiClient.localOriginLmStudio");
    expect(localOriginInstruction("openai", "https://notes.example.com")).toBe("");
  });
});

describe("describeAiError", () => {
  it("falls back to the generic message when no explanation applies", async () => {
    diagnose.mockResolvedValue("ok");
    vi.spyOn(console, "error").mockImplementation(() => undefined);

    const text = await describeAiError(networkError, { provider: "ollama", apiUrl: "http://localhost:11434" });

    expect(text).toContain("Failed to fetch");
    expect(text).toContain("editor.aiTipConnection");
  });
});
