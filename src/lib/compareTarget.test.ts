import { describe, expect, it } from "vitest";

import { compareTargetAfterSelection, compareTargetAfterTreeChange } from "./compareTarget";

describe("compareTargetAfterSelection", () => {
  it("keeps the compared note when another note opens", () => {
    expect(compareTargetAfterSelection("/v/b.md", "/v/a.md", "/v/c.md")).toBe("/v/b.md");
  });

  it("swaps sides when the compared note opens", () => {
    expect(compareTargetAfterSelection("/v/b.md", "/v/a.md", "/v/b.md")).toBe("/v/a.md");
  });

  it("matches paths regardless of case and separators", () => {
    expect(compareTargetAfterSelection("C:\\v\\B.md", "C:\\v\\a.md", "c:/v/b.md")).toBe("C:\\v\\a.md");
  });

  it("closes when nothing was open before", () => {
    expect(compareTargetAfterSelection("/v/b.md", null, "/v/b.md")).toBeNull();
  });

  it("does nothing without a comparison", () => {
    expect(compareTargetAfterSelection(null, "/v/a.md", "/v/b.md")).toBeNull();
  });
});

describe("compareTargetAfterTreeChange", () => {
  it("keeps a note that is still there", () => {
    expect(compareTargetAfterTreeChange("/v/b.md", ["/v/a.md", "/v/B.md"])).toBe("/v/b.md");
  });

  it("closes when the note is gone", () => {
    expect(compareTargetAfterTreeChange("/v/b.md", ["/v/a.md"])).toBeNull();
  });
});
