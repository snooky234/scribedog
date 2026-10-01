import { describe, expect, it } from "vitest";

import { editorsFor, normalizePresencePath, ownPresence, PRESENCE_TTL_MS } from "../src/shared/presence.js";

describe("presence", () => {
  it("collects a person's open notes per vault, once each", () => {
    expect(
      ownPresence(
        [
          { vaultId: "7f3a", path: "Einkauf.md" },
          { vaultId: "7f3a", path: "Einkauf.md" },
          { vaultId: "7f3a", path: null },
          { vaultId: "0c12", path: "Plan.md" }
        ],
        5
      )
    ).toEqual({ at: 5, vaults: { "7f3a": ["Einkauf.md"], "0c12": ["Plan.md"] } });
  });

  it("lists the others in a vault, not oneself and not those whose heartbeat stopped", () => {
    const files = {
      anna: { at: 1_000, vaults: { "7f3a": ["Einkauf.md"] } },
      bob: { at: 1_000, vaults: { "7f3a": ["Einkauf.md", "Notes/Plan.md"], "0c12": ["Other.md"] } },
      carol: { at: 1_000 - PRESENCE_TTL_MS - 1, vaults: { "7f3a": ["Einkauf.md"] } }
    };

    expect(editorsFor(files, "7f3a", "anna", 1_000)).toEqual([
      { user: "bob", path: "Einkauf.md" },
      { user: "bob", path: "Notes/Plan.md" }
    ]);
  });

  it("takes only plain vault-relative paths from a client", () => {
    expect(normalizePresencePath("Notes/Idea.md")).toBe("Notes/Idea.md");

    for (const raw of ["../etc/passwd", "/abs.md", ".scribedog/server/auth.json", 42, null, "x".repeat(2000)]) {
      expect(normalizePresencePath(raw), String(raw).slice(0, 20)).toBeNull();
    }
  });
});
