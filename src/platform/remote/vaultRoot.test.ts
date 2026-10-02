import { describe, expect, it } from "vitest";

import { isRemoteVaultPath, parseSharedVaultRoot, remoteVaultRootFor, serverRootOf, sharedVaultRootFor } from "./vaultRoot";

describe("remote vault root", () => {
  it("names host, port and base path, so two instances on one host stay apart", () => {
    expect(remoteVaultRootFor("https://notes.example.com")).toBe("/@remote/notes.example.com");
    expect(remoteVaultRootFor("https://notes.example.com/anna")).toBe("/@remote/notes.example.com/anna");
    expect(remoteVaultRootFor("https://localhost:9443/")).toBe("/@remote/localhost:9443");
  });

  it("tells a server vault path from a local one, either separator", () => {
    expect(isRemoteVaultPath("/@remote/notes.example.com/Notes/Idea.md")).toBe(true);
    expect(isRemoteVaultPath("\\@remote\\notes.example.com\\Notes\\Idea.md")).toBe(true);
    expect(isRemoteVaultPath("C:\\Users\\me\\Notes")).toBe(false);
    expect(isRemoteVaultPath("/home/me/@remote")).toBe(false);
    expect(isRemoteVaultPath("/vault/Idea.md")).toBe(false);
  });

  it("gives a shared vault a root of its own below its server", () => {
    const server = remoteVaultRootFor("https://notes.example.com/anna");
    const shared = sharedVaultRootFor(server, "7f3a");

    expect(shared).toBe("/@remote/notes.example.com/anna/@shared/7f3a");
    expect(isRemoteVaultPath(shared)).toBe(true);
    expect(parseSharedVaultRoot(shared)).toEqual({ serverRoot: server, vaultId: "7f3a" });
    // The token and the device list belong to the instance, not the vault.
    expect(serverRootOf(shared)).toBe(server);
    expect(serverRootOf(server)).toBe(server);
  });

  it("is not a shared vault root for the server itself, a note inside one, or a malformed id", () => {
    for (const path of [
      "/@remote/notes.example.com/anna",
      "/@remote/notes.example.com/anna/@shared/7f3a/Note.md",
      "/@remote/notes.example.com/anna/@shared/XYZ",
      "/@remote/notes.example.com/anna/@shared/"
    ]) {
      expect(parseSharedVaultRoot(path), path).toBeNull();
    }
  });
});
