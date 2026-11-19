import { describe, expect, it } from "vitest";

import { isLoopbackHost } from "../src/config.js";

describe("isLoopbackHost", () => {
  it("accepts the addresses that only this computer can reach", () => {
    for (const host of ["127.0.0.1", "127.0.1.1", "localhost", "LOCALHOST", "::1", "[::1]", " 127.0.0.1 "]) {
      expect(isLoopbackHost(host), host).toBe(true);
    }
  });

  it("rejects every address the network can reach", () => {
    for (const host of ["0.0.0.0", "::", "192.168.1.50", "10.0.0.1", "example.com", "127.0.0.1.example.com", "localhost.example.com", ""]) {
      expect(isLoopbackHost(host), host).toBe(false);
    }
  });
});
