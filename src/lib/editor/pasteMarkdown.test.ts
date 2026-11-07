import { describe, expect, it } from "vitest";

import { looksLikeMarkdown, normalizeBlankLines } from "@/lib/editor/pasteMarkdown";

describe("looksLikeMarkdown", () => {
  it("recognizes block markers at the start of a line", () => {
    expect(looksLikeMarkdown("# Die Geschichte des Kaffees\nKaffee gehört …")).toBe(true);
    expect(looksLikeMarkdown("Einleitung\n\n## Herkunft")).toBe(true);
    expect(looksLikeMarkdown("- Milch\n- Zucker")).toBe(true);
    expect(looksLikeMarkdown("1. erstens\n2. zweitens")).toBe(true);
    expect(looksLikeMarkdown("> Zitat")).toBe(true);
    expect(looksLikeMarkdown("```js\nconsole.log(1)\n```")).toBe(true);
    expect(looksLikeMarkdown("| a | b |\n|---|---|\n| 1 | 2 |")).toBe(true);
    expect(looksLikeMarkdown("oben\n\n---\n\nunten")).toBe(true);
  });

  it("recognizes complete inline constructs", () => {
    expect(looksLikeMarkdown("ein **fettes** Wort")).toBe(true);
    expect(looksLikeMarkdown("ein *kursives* Wort")).toBe(true);
    expect(looksLikeMarkdown("ein _kursives_ Wort")).toBe(true);
    expect(looksLikeMarkdown("siehe [Doku](https://example.com)")).toBe(true);
    expect(looksLikeMarkdown("der Befehl `ls -la` listet")).toBe(true);
    expect(looksLikeMarkdown("~~gestrichen~~")).toBe(true);
  });

  it("leaves ordinary prose and lone markers alone", () => {
    expect(looksLikeMarkdown("")).toBe(false);
    expect(looksLikeMarkdown("   \n  ")).toBe(false);
    expect(looksLikeMarkdown("Kaffee gehört zu den meistgehandelten Rohstoffen der Welt.")).toBe(false);
    expect(looksLikeMarkdown("Preis: 5 * 3 = 15")).toBe(false);
    expect(looksLikeMarkdown("Datei_name_test.txt")).toBe(false);
    expect(looksLikeMarkdown("snake_case und camelCase")).toBe(false);
    expect(looksLikeMarkdown("Ticket #42 ist offen")).toBe(false);
    expect(looksLikeMarkdown("Erste Zeile\nZweite Zeile")).toBe(false);
    expect(looksLikeMarkdown("a * b * c")).toBe(false);
    expect(looksLikeMarkdown("Aufgabe [x] erledigt?")).toBe(false);
  });

  it("does not mistake an indented or number-only line for a marker", () => {
    expect(looksLikeMarkdown("    4 Leerzeichen")).toBe(false);
    expect(looksLikeMarkdown("2024 war ein gutes Jahr")).toBe(false);
    expect(looksLikeMarkdown("#hashtag")).toBe(false);
  });
});

describe("normalizeBlankLines", () => {
  it("empties lines that hold only spaces, tabs or non-breaking spaces", () => {
    expect(normalizeBlankLines("# Titel\n \nAbsatz\n \n- A\n\t\n- B")).toBe("# Titel\n\nAbsatz\n\n- A\n\n- B");
  });

  it("keeps runs of empty lines and indented content as they are", () => {
    expect(normalizeBlankLines("a\n\n\nb")).toBe("a\n\n\nb");
    expect(normalizeBlankLines("- A\n  - B1\n    code")).toBe("- A\n  - B1\n    code");
  });

  it("unifies Windows line endings", () => {
    expect(normalizeBlankLines("a\r\n \r\nb")).toBe("a\n\nb");
  });
});
