import { describe, expect, it } from "vitest";

import { maxWordLength, splitOverlongWords } from "./pdfTableFit";

describe("maxWordLength", () => {
  it("gives a narrow column fewer characters than a wide one", () => {
    expect(maxWordLength(9, 10.5, 451)).toBeLessThan(maxWordLength(3, 10.5, 451));
  });

  it("allows fewer characters for the wider face", () => {
    expect(maxWordLength(5, 10.5, 451, true)).toBeLessThanOrEqual(maxWordLength(5, 10.5, 451));
  });

  it("never drops below one character", () => {
    expect(maxWordLength(200, 20, 451)).toBe(1);
  });
});

describe("splitOverlongWords", () => {
  it("leaves text without overlong words in one plain segment", () => {
    expect(splitOverlongWords("short words only", 8)).toEqual([{ text: "short words only", breakAll: false }]);
  });

  it("marks only the word that cannot fit", () => {
    expect(splitOverlongWords("a fsadfsdfsdfsdaf b", 8)).toEqual([
      { text: "a ", breakAll: false },
      { text: "fsadfsdfsdfsdaf", breakAll: true },
      { text: " b", breakAll: false }
    ]);
  });

  it("keeps the text unchanged when joined back together", () => {
    const text = "  Tabellenbreite  und  Spaltenbreiten ";
    expect(
      splitOverlongWords(text, 6)
        .map((segment) => segment.text)
        .join("")
    ).toBe(text);
  });

  it("counts characters, not UTF-16 units", () => {
    expect(splitOverlongWords("äöüß", 4)).toEqual([{ text: "äöüß", breakAll: false }]);
  });
});
