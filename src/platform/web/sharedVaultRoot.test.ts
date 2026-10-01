import { describe, expect, it } from "vitest";

import { sharedVaultIdOf, sharedVaultRoot, sharedVaultScope } from "./sharedVaultRoot";

describe("shared vault roots", () => {
  it("round-trips an id through its root", () => {
    expect(sharedVaultRoot("7f3a")).toBe("/shared/7f3a");
    expect(sharedVaultIdOf("/shared/7f3a")).toBe("7f3a");
    expect(sharedVaultIdOf("/shared/7f3a/")).toBe("7f3a");
    expect(sharedVaultScope("7f3a")).toBe("/v/7f3a");
  });

  it("is null for the own vault, paths inside a shared one and anything malformed", () => {
    for (const path of ["/vault", "/shared/7f3a/Note.md", "/shared/", "/shared/XYZ1", "/shared/../vault", "shared/7f3a"]) {
      expect(sharedVaultIdOf(path), path).toBeNull();
    }
  });
});
