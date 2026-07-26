import { describe, expect, it } from "vitest";

import { countCharacters, countWords, estimateReadingMinutes } from "./documentStats";

describe("countWords", () => {
  it("counts plain prose", () => {
    expect(countWords("Ein kurzer Satz mit sechs Wörtern.")).toBe(6);
  });

  it("ignores markdown scaffolding", () => {
    const markdown = [
      "# Überschrift",
      "",
      "- erster Punkt",
      "- [ ] zweiter Punkt",
      "",
      "> ein Zitat",
      "",
      "---",
      "",
      "**fett** und *kursiv*"
    ].join("\n");

    expect(countWords(markdown)).toBe(10);
  });

  it("counts a link label but not its target", () => {
    expect(countWords("Siehe [die Notiz](notes/meeting.md).")).toBe(3);
  });

  it("skips code blocks and inline code", () => {
    const markdown = ["Vorher.", "", "```ts", "const answer = 42;", "```", "", "`inline` danach."].join(
      "\n"
    );

    expect(countWords(markdown)).toBe(2);
  });

  it("counts CJK characters individually", () => {
    expect(countWords("今日は良い天気です")).toBe(9);
  });

  it("returns 0 for an empty document", () => {
    expect(countWords("\n\n   \n")).toBe(0);
  });
});

describe("countCharacters", () => {
  it("counts letters and the spaces between them", () => {
    expect(countCharacters("Ein Satz.")).toBe(9);
  });

  it("collapses whitespace and ignores markdown scaffolding", () => {
    expect(countCharacters("# Titel\n\n\nEin   Satz.")).toBe(15);
  });

  it("counts an emoji as one character", () => {
    expect(countCharacters("Hi 👋")).toBe(4);
  });

  it("returns 0 for an empty document", () => {
    expect(countCharacters("\n\n   \n")).toBe(0);
  });
});

describe("estimateReadingMinutes", () => {
  it("is 0 only for an empty document", () => {
    expect(estimateReadingMinutes(0)).toBe(0);
  });

  it("rounds up to a full minute for short texts", () => {
    expect(estimateReadingMinutes(12)).toBe(1);
  });

  it("rounds to the nearest minute", () => {
    expect(estimateReadingMinutes(500)).toBe(3);
  });
});
