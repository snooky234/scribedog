import { describe, expect, it } from "vitest";

import { LATEST_RELEASE_URL, RELEASES_URL, releaseNotesUrl } from "./releaseLinks";

describe("releaseNotesUrl", () => {
  it("anchors the overview at the installed release", () => {
    expect(releaseNotesUrl("0.23.0")).toBe(`${RELEASES_URL}#release-v0.23.0`);
  });

  it("does not double a leading v", () => {
    expect(releaseNotesUrl("v0.24.1")).toBe(`${RELEASES_URL}#release-v0.24.1`);
  });

  it("falls back to the overview without a version", () => {
    expect(releaseNotesUrl(null)).toBe(RELEASES_URL);
    expect(releaseNotesUrl("  ")).toBe(RELEASES_URL);
  });

  it("keeps the latest-release link on the same base", () => {
    expect(LATEST_RELEASE_URL).toBe(`${RELEASES_URL}/latest`);
  });
});
