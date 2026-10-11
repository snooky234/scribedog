// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { SharedOverview, SharedVaultInfo } from "@/platform/types";

import { getStartupVault, pickStartupVault, rememberOpenedVault } from "./lastVault";

function overviewWith(...ids: string[]): SharedOverview {
  return {
    me: "anna",
    people: [],
    vaults: ids.map((id) => ({ id }) as SharedVaultInfo),
    trash: [],
    notices: []
  };
}

describe("startup vault in the browser", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it("returns to a shared vault the person is still in", () => {
    expect(pickStartupVault("/shared/7f3a", overviewWith("7f3a"))).toBe("/shared/7f3a");
  });

  it("falls back to the own vault for a lost, unknown or missing shared vault", () => {
    expect(pickStartupVault("/shared/7f3a", overviewWith("b00c"))).toBe("/vault");
    expect(pickStartupVault("/shared/7f3a", null)).toBe("/vault");
    expect(pickStartupVault("/vault", overviewWith("7f3a"))).toBe("/vault");
    expect(pickStartupVault(null, overviewWith("7f3a"))).toBe("/vault");
  });

  it("remembers the last shared vault and forgets it once the own vault is opened", async () => {
    const loadOverview = vi.fn(async () => overviewWith("7f3a"));

    rememberOpenedVault("/shared/7f3a");
    await expect(getStartupVault(loadOverview)).resolves.toBe("/shared/7f3a");

    rememberOpenedVault("/vault");
    await expect(getStartupVault(loadOverview)).resolves.toBe("/vault");
  });

  it("does not ask the server when the own vault was the last one", async () => {
    const loadOverview = vi.fn(async () => overviewWith("7f3a"));

    await expect(getStartupVault(loadOverview)).resolves.toBe("/vault");
    expect(loadOverview).not.toHaveBeenCalled();
  });

  it("falls back to the own vault when the overview fails", async () => {
    rememberOpenedVault("/shared/7f3a");

    await expect(getStartupVault(async () => Promise.reject(new Error("offline")))).resolves.toBe("/vault");
  });
});
