import { describe, expect, it } from "vitest";

import {
  nextPlacemarkBlock,
  normalizeStoredPlacemarks,
  placemarkQuote,
  removePlacemarkPath,
  renamePlacemarkPath,
  resolvePlacemarkBlock,
  resolvePlacemarks,
  setFilePlacemarks,
  PLACEMARK_QUOTE_LENGTH,
  type PlacemarkFileMap
} from "@/lib/placemarks";

describe("placemarkQuote", () => {
  it("collapses whitespace and cuts to the quote length", () => {
    expect(placemarkQuote("  one\n\ttwo   three ")).toBe("one two three");
    expect(placemarkQuote("x".repeat(200))).toHaveLength(PLACEMARK_QUOTE_LENGTH);
  });
});

describe("resolvePlacemarkBlock", () => {
  const blocks = ["Intro", "Second", "Repeated line", "Middle", "Repeated line", "End"];

  it("keeps the stored block when its text still matches", () => {
    expect(resolvePlacemarkBlock(blocks, { block: 4, quote: "Repeated line" })).toBe(4);
  });

  it("follows the text when blocks were added above", () => {
    expect(resolvePlacemarkBlock(["New", ...blocks], { block: 3, quote: "Middle" })).toBe(4);
  });

  it("picks the nearest of several blocks with the same text", () => {
    const document = ["x", "dup", "y", "z", "w", "dup"];
    expect(resolvePlacemarkBlock(document, { block: 4, quote: "dup" })).toBe(5);
    expect(resolvePlacemarkBlock(document, { block: 2, quote: "dup" })).toBe(1);
  });

  it("accepts a block whose start survived an edit further in", () => {
    const edited = ["Intro", "A long paragraph that begins the same way but ends differently now"];
    expect(
      resolvePlacemarkBlock(edited, {
        block: 0,
        quote: "A long paragraph that begins the same way and ended otherwise"
      })
    ).toBe(1);
  });

  it("falls back to the clamped number when the text is gone", () => {
    expect(resolvePlacemarkBlock(blocks, { block: 3, quote: "vanished" })).toBe(3);
    expect(resolvePlacemarkBlock(blocks, { block: 40, quote: "vanished" })).toBe(5);
  });

  it("uses the number for a block without text", () => {
    expect(resolvePlacemarkBlock(blocks, { block: 2, quote: "" })).toBe(2);
  });

  it("has nothing to resolve against in an empty document", () => {
    expect(resolvePlacemarkBlock([], { block: 0, quote: "x" })).toBeNull();
  });
});

describe("resolvePlacemarks", () => {
  it("merges marks that land on one block and keeps a comment", () => {
    const resolved = resolvePlacemarks(["a", "b"], [
      { block: 1, quote: "b" },
      { block: 5, quote: "b", comment: "keep me" },
      { block: 0, quote: "a" }
    ]);

    expect(resolved).toEqual([
      { block: 0, comment: "" },
      { block: 1, comment: "keep me" }
    ]);
  });
});

describe("nextPlacemarkBlock", () => {
  it("steps forward and backward, wrapping at the ends", () => {
    expect(nextPlacemarkBlock([2, 8, 5], 3, 1)).toBe(5);
    expect(nextPlacemarkBlock([2, 8, 5], 8, 1)).toBe(2);
    expect(nextPlacemarkBlock([2, 8, 5], 5, -1)).toBe(2);
    expect(nextPlacemarkBlock([2, 8, 5], 1, -1)).toBe(8);
    expect(nextPlacemarkBlock([], 1, 1)).toBeNull();
  });
});

describe("path arithmetic", () => {
  const files: PlacemarkFileMap = {
    "notes/a.md": [{ block: 1, quote: "a" }],
    "notes/sub/b.md": [{ block: 2, quote: "b" }],
    "other.md": [{ block: 0, quote: "o" }]
  };

  it("moves a note and everything below a renamed folder", () => {
    expect(renamePlacemarkPath(files, "notes/a.md", "notes/c.md")["notes/c.md"]).toEqual(files["notes/a.md"]);
    const moved = renamePlacemarkPath(files, "Notes", "archive");
    expect(Object.keys(moved).sort()).toEqual(["archive/a.md", "archive/sub/b.md", "other.md"]);
  });

  it("returns the same map when nothing moved", () => {
    expect(renamePlacemarkPath(files, "missing.md", "x.md")).toBe(files);
    expect(removePlacemarkPath(files, "missing.md")).toBe(files);
  });

  it("drops a deleted note or folder", () => {
    expect(Object.keys(removePlacemarkPath(files, "notes"))).toEqual(["other.md"]);
  });

  it("stores, replaces and clears a note's marks", () => {
    const same = setFilePlacemarks(files, "notes\\a.md", [{ block: 1, quote: "a" }]);
    expect(same).toBe(files);

    const cleared = setFilePlacemarks(files, "notes/a.md", []);
    expect(cleared["notes/a.md"]).toBeUndefined();
  });
});

describe("normalizeStoredPlacemarks", () => {
  it("drops malformed entries and keeps the rest", () => {
    const stored = normalizeStoredPlacemarks({
      version: 1,
      files: {
        "Good.md": [
          { block: 3, quote: "  text  ", comment: "  note " },
          { block: -1, quote: "bad" },
          { block: 1.5, quote: "bad" },
          { block: 2, quote: 7 },
          { block: 4, quote: "", comment: "   " }
        ],
        "empty.md": [],
        "notalist.md": "x"
      }
    });

    expect(stored).toEqual({
      version: 1,
      files: {
        "good.md": [
          { block: 3, quote: "text", comment: "note" },
          { block: 4, quote: "" }
        ]
      }
    });
  });

  it("survives anything that is not an object", () => {
    expect(normalizeStoredPlacemarks(null)).toEqual({ version: 1, files: {} });
    expect(normalizeStoredPlacemarks({ files: [] })).toEqual({ version: 1, files: {} });
  });
});
