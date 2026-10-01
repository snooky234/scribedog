import { describe, expect, it } from "vitest";

import { merge3 } from "./merge3";

const BASE = ["# Shopping", "", "Milk and bread.", "", "Call the plumber.", "", "Water the plants.", ""].join("\n");

describe("merge3", () => {
  it("takes the other side when only one side changed", () => {
    const changed = BASE.replace("Milk", "Oat milk");

    expect(merge3(BASE, changed, BASE)).toEqual({ clean: true, text: changed });
    expect(merge3(BASE, BASE, changed)).toEqual({ clean: true, text: changed });
  });

  it("is clean when both sides made the same change", () => {
    const changed = BASE.replace("Milk", "Oat milk");

    expect(merge3(BASE, changed, changed)).toEqual({ clean: true, text: changed });
  });

  it("merges edits to different paragraphs silently", () => {
    const ours = BASE.replace("Milk and bread.", "Milk, bread and eggs.");
    const theirs = BASE.replace("Water the plants.", "Water the plants on Friday.");

    expect(merge3(BASE, ours, theirs)).toEqual({
      clean: true,
      text: BASE.replace("Milk and bread.", "Milk, bread and eggs.").replace(
        "Water the plants.",
        "Water the plants on Friday."
      )
    });
  });

  it("merges an addition at the end with an edit at the top", () => {
    const ours = BASE.replace("# Shopping", "# Shopping list");
    const theirs = `${BASE}\nBuy stamps.\n`;

    const result = merge3(BASE, ours, theirs);

    expect(result).toEqual({ clean: true, text: `${ours}\nBuy stamps.\n` });
  });

  it("reports edits to the same line as a conflict, with both sides' texts", () => {
    const ours = BASE.replace("Call the plumber.", "Call the plumber on Monday.");
    const theirs = BASE.replace("Call the plumber.", "Plumber is booked.");

    const result = merge3(BASE, ours, theirs);

    expect(result.clean).toBe(false);

    if (result.clean) {
      return;
    }

    expect(result.conflicts).toBe(1);
    expect(result.oursText).toBe(ours);
    expect(result.theirsText).toBe(theirs);
    expect(result.chunks.find((chunk) => chunk.kind === "conflict")).toEqual({
      kind: "conflict",
      base: ["Call the plumber."],
      ours: ["Call the plumber on Monday."],
      theirs: ["Plumber is booked."]
    });
  });

  it("keeps the non-overlapping changes of both sides in either resolution", () => {
    const ours = BASE.replace("Milk and bread.", "Milk, bread and eggs.").replace(
      "Call the plumber.",
      "Call the plumber on Monday."
    );
    const theirs = BASE.replace("Water the plants.", "Water the plants on Friday.").replace(
      "Call the plumber.",
      "Plumber is booked."
    );

    const result = merge3(BASE, ours, theirs);

    expect(result.clean).toBe(false);

    if (result.clean) {
      return;
    }

    // The resolutions differ only in the conflicting line.
    for (const text of [result.oursText, result.theirsText]) {
      expect(text).toContain("Milk, bread and eggs.");
      expect(text).toContain("Water the plants on Friday.");
    }

    expect(result.oursText).toContain("Call the plumber on Monday.");
    expect(result.theirsText).toContain("Plumber is booked.");
  });

  it("counts every overlapping passage", () => {
    const ours = BASE.replace("Milk and bread.", "A").replace("Water the plants.", "B");
    const theirs = BASE.replace("Milk and bread.", "C").replace("Water the plants.", "D");

    const result = merge3(BASE, ours, theirs);

    expect(result.clean ? 0 : result.conflicts).toBe(2);
  });

  it("treats a deletion against an edit of the same line as a conflict", () => {
    const ours = BASE.replace("Call the plumber.\n\n", "");
    const theirs = BASE.replace("Call the plumber.", "Call the plumber today.");

    expect(merge3(BASE, ours, theirs).clean).toBe(false);
  });

  it("keeps Windows line endings intact", () => {
    const base = "one\r\ntwo\r\nthree\r\n";
    const ours = "one!\r\ntwo\r\nthree\r\n";
    const theirs = "one\r\ntwo\r\nthree!\r\n";

    expect(merge3(base, ours, theirs)).toEqual({ clean: true, text: "one!\r\ntwo\r\nthree!\r\n" });
  });
});
