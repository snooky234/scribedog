import { describe, expect, it } from "vitest";

import { reminderVaultRoots } from "./reminderVaults";

describe("reminderVaultRoots", () => {
  it("takes the menu's vaults with the shared ones under their server, minus the open one", () => {
    expect(
      reminderVaultRoots({
        ownRoots: ["/notes", "/@remote/srv", "/temp"],
        servers: [{ root: "/@remote/srv", vaultRoots: ["/@remote/srv/@shared/a", "/@remote/srv/@shared/b"] }],
        activeRoot: "/temp"
      })
    ).toEqual(["/notes", "/@remote/srv", "/@remote/srv/@shared/a", "/@remote/srv/@shared/b"]);
  });

  it("leaves out the shared vaults of a server the menu does not list", () => {
    expect(
      reminderVaultRoots({
        ownRoots: ["/notes"],
        servers: [{ root: "/@remote/srv", vaultRoots: ["/@remote/srv/@shared/a"] }],
        activeRoot: null
      })
    ).toEqual(["/notes"]);
  });

  it("names a vault once", () => {
    expect(reminderVaultRoots({ ownRoots: ["/notes", "/notes"], servers: [], activeRoot: null })).toEqual(["/notes"]);
  });
});
