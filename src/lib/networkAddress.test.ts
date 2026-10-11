import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import {
  isLoopbackHttpUrl,
  isPrivateIPv4,
  isPrivateNetworkHostname,
  isPrivateNetworkHttpUrl,
  serverAllowlistLine
} from "./networkAddress";

describe("isPrivateIPv4", () => {
  it("accepts the three RFC 1918 ranges", () => {
    for (const host of ["10.0.0.1", "10.255.255.255", "172.16.0.1", "172.31.255.254", "192.168.0.1", "192.168.1.50"]) {
      expect(isPrivateIPv4(host), host).toBe(true);
    }
  });

  it("rejects everything around them", () => {
    for (const host of ["172.15.0.1", "172.32.0.1", "192.169.0.1", "11.0.0.1", "127.0.0.1", "169.254.169.254", "8.8.8.8", "localhost"]) {
      expect(isPrivateIPv4(host), host).toBe(false);
    }
  });
});

describe("isPrivateNetworkHostname", () => {
  it("accepts names under a home-network suffix", () => {
    for (const host of ["jan.fritz.box", "ollama.local", "gpu.lan", "llm.home.arpa", "models.corp.internal"]) {
      expect(isPrivateNetworkHostname(host), host).toBe(true);
    }
  });

  it("rejects public names and a bare suffix", () => {
    for (const host of ["evil.com", "local", "fritz.box", "lan.evil.com", "gamingpc"]) {
      expect(isPrivateNetworkHostname(host), host).toBe(false);
    }
  });
});

describe("isLoopbackHttpUrl", () => {
  it("accepts this machine over plain http only", () => {
    expect(isLoopbackHttpUrl("http://localhost:1337")).toBe(true);
    expect(isLoopbackHttpUrl("http://127.0.0.1:11434")).toBe(true);
    expect(isLoopbackHttpUrl("http://[::1]:8080")).toBe(true);
    expect(isLoopbackHttpUrl("https://localhost")).toBe(false);
    expect(isLoopbackHttpUrl("http://192.168.1.10")).toBe(false);
  });
});

describe("isPrivateNetworkHttpUrl", () => {
  it("accepts another machine in the network over plain http", () => {
    expect(isPrivateNetworkHttpUrl("http://192.168.1.50:1337")).toBe(true);
    expect(isPrivateNetworkHttpUrl("http://jan.fritz.box:1337/v1")).toBe(true);
  });

  it("rejects loopback, public hosts, https and garbage", () => {
    expect(isPrivateNetworkHttpUrl("http://localhost:1337")).toBe(false);
    expect(isPrivateNetworkHttpUrl("http://192.168.1.1.evil.com")).toBe(false);
    expect(isPrivateNetworkHttpUrl("https://192.168.1.50")).toBe(false);
    expect(isPrivateNetworkHttpUrl("not a url")).toBe(false);
  });
});

describe("serverAllowlistLine", () => {
  it("keeps the built-in providers next to the new entry", () => {
    expect(serverAllowlistLine("http://192.168.1.50:1337")).toBe(
      "SCRIBEDOG_LLM_ALLOWED_HOSTS=default,http://192.168.1.50:1337"
    );
  });
});

// The desktop app's http scope has to let through exactly what the endpoint
// check accepts: an address the check takes but the shell refuses fails with
// a message about permissions instead of the endpoint. Node evaluates the
// scope's patterns with the same URLPattern rules the Tauri plugin uses.
describe("desktop http scope", () => {
  type Pattern = { test(input: string): boolean };
  const UrlPattern = (globalThis as unknown as { URLPattern: new (pattern: string) => Pattern }).URLPattern;

  const capability = JSON.parse(
    readFileSync(fileURLToPath(new URL("../../src-tauri/capabilities/default.json", import.meta.url)), "utf8")
  ) as { permissions: Array<string | { identifier: string; allow?: Array<{ url: string }> }> };
  const httpEntry = capability.permissions.find(
    (permission): permission is { identifier: string; allow: Array<{ url: string }> } =>
      typeof permission === "object" && permission.identifier === "http:default"
  );
  const patterns = (httpEntry?.allow ?? []).map((entry) => new UrlPattern(entry.url));
  const allowed = (url: string) => patterns.some((pattern) => pattern.test(url));

  it("allows every address the endpoint check accepts", () => {
    for (const url of [
      "http://localhost:1337/v1/models",
      "http://127.0.0.1:11434/api/chat",
      "http://10.1.2.3:11434/api/tags",
      "http://172.16.0.9:1234/v1/models",
      "http://172.31.255.1:1234/v1/models",
      "http://192.168.1.50:1337/v1/chat/completions",
      "http://jan.fritz.box:1337/v1/models",
      "http://ollama.local:11434/api/tags",
      "http://gpu.lan:1234/v1/models",
      "http://llm.home.arpa/v1/models",
      "http://models.corp.internal:8080/v1/models"
    ]) {
      expect(isLoopbackHttpUrl(url) || isPrivateNetworkHttpUrl(url), url).toBe(true);
      expect(allowed(url), url).toBe(true);
    }
  });

  it("refuses public addresses over plain http", () => {
    for (const url of [
      "http://8.8.8.8/v1",
      "http://172.32.0.1/v1",
      "http://192.168.1.1.evil.com/v1",
      "http://10.1.2.3.evil.com/v1",
      "http://evil.com/v1",
      "http://169.254.169.254/latest/meta-data"
    ]) {
      expect(allowed(url), url).toBe(false);
    }
  });
});
