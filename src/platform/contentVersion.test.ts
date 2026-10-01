import { createHash } from "node:crypto";

import { describe, expect, it } from "vitest";

import { contentVersion, contentVersionOfText } from "./contentVersion";

// The server hashes with node:crypto; a token computed here has to be the
// very same string, or a desktop version would never match a server one.
describe("contentVersion", () => {
  it("matches the server's SHA-256 hex of the UTF-8 bytes", async () => {
    const text = "# Notiz\n\nÄpfel, Birnen und ein Emoji 🐶\n";

    expect(await contentVersionOfText(text)).toBe(createHash("sha256").update(text, "utf8").digest("hex"));
  });

  it("hashes raw bytes as they are, a byte order mark included", async () => {
    const bytes = new Uint8Array([0xef, 0xbb, 0xbf, 0x23, 0x0a]);

    expect(await contentVersion(bytes)).toBe(createHash("sha256").update(bytes).digest("hex"));
    expect(await contentVersion(bytes)).not.toBe(await contentVersionOfText("#\n"));
  });
});
