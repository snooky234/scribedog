import { describe, expect, it } from "vitest";

import { normalizeEscapedCheckboxes } from "@/lib/editor/markdownNormalize";

describe("normalizeEscapedCheckboxes", () => {
  it("unescapes brackets in bulleted list items", () => {
    expect(normalizeEscapedCheckboxes("- \\[ \\] todo")).toBe("- [ ] todo");
    expect(normalizeEscapedCheckboxes("* \\[x\\] done")).toBe("* [x] done");
    expect(normalizeEscapedCheckboxes("+ \\[X\\] done")).toBe("+ [X] done");
  });

  it("unescapes brackets in numbered list items", () => {
    expect(normalizeEscapedCheckboxes("1. \\[ \\] todo")).toBe("1. [ ] todo");
    expect(normalizeEscapedCheckboxes("2) \\[x\\] done")).toBe("2) [x] done");
  });

  it("fills an empty pair of brackets with a space", () => {
    expect(normalizeEscapedCheckboxes("- \\[\\] todo")).toBe("- [ ] todo");
  });

  it("adds a list marker to a marker-less checkbox line", () => {
    expect(normalizeEscapedCheckboxes("[ ] stray")).toBe("- [ ] stray");
    expect(normalizeEscapedCheckboxes("\\[x\\] stray")).toBe("- [x] stray");
  });

  it("preserves indentation on nested items", () => {
    expect(normalizeEscapedCheckboxes("  - \\[ \\] nested")).toBe("  - [ ] nested");
    expect(normalizeEscapedCheckboxes("  [ ] nested")).toBe("  - [ ] nested");
  });

  it("normalizes every line of a multi-line document", () => {
    expect(normalizeEscapedCheckboxes("# Title\n\n- \\[ \\] a\n- \\[x\\] b\n")).toBe(
      "# Title\n\n- [ ] a\n- [x] b\n"
    );
  });

  it("leaves already-valid checkboxes untouched", () => {
    expect(normalizeEscapedCheckboxes("- [ ] a\n- [x] b")).toBe("- [ ] a\n- [x] b");
  });

  it("does not touch a link or an inline bracket in running text", () => {
    expect(normalizeEscapedCheckboxes("See [docs](https://example.com) here")).toBe(
      "See [docs](https://example.com) here"
    );
    expect(normalizeEscapedCheckboxes("text with [ ] in the middle")).toBe(
      "text with [ ] in the middle"
    );
  });
});
