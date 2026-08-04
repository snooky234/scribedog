import { describe, expect, it } from "vitest";

import { decodeEscapedLineBreaks, normalizeEscapedCheckboxes } from "@/lib/editor/markdownNormalize";

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

describe("decodeEscapedLineBreaks", () => {
  it("turns a fully escaped text back into line breaks", () => {
    expect(decodeEscapedLineBreaks("Zeile eins\\nZeile zwei\\n\\nAbsatz")).toBe(
      "Zeile eins\nZeile zwei\n\nAbsatz"
    );
  });

  it("decodes a text the model escaped only from the second line on", () => {
    const escaped =
      "Im Feld von Lila,\n\nSteht der Lavendel,\\nSein Duft so süß,\\nTrägt mich fort.\\n\\nDie Sonne küsst ihn,\\nEr strahlt zurück.";

    expect(decodeEscapedLineBreaks(escaped)).toBe(
      "Im Feld von Lila,\n\nSteht der Lavendel,\nSein Duft so süß,\nTrägt mich fort.\n\nDie Sonne küsst ihn,\nEr strahlt zurück."
    );
  });

  it("leaves a single literal sequence alone — a sentence about \\n is likelier than one escaped break", () => {
    expect(decodeEscapedLineBreaks("Ein Umbruch schreibt sich \\n.")).toBe(
      "Ein Umbruch schreibt sich \\n."
    );
  });

  it("handles escaped CRLF and tabs alongside", () => {
    expect(decodeEscapedLineBreaks("a\\r\\nb\\r\\n\\tc")).toBe("a\nb\n\tc");
  });

  it("leaves a text without literal sequences untouched", () => {
    expect(decodeEscapedLineBreaks("# Titel\n\nAbsatz mit \\* Sternchen.")).toBe(
      "# Titel\n\nAbsatz mit \\* Sternchen."
    );
  });

  it("leaves a note that documents \\n in prose or code alone", () => {
    const note = "# Escapes\n\nEin Zeilenumbruch ist `\\n`:\n\n```js\nconsole.log(\"a\\nb\");\n```\n\nSo weit.";

    expect(decodeEscapedLineBreaks(note)).toBe(note);
  });

  it("leaves an empty string alone", () => {
    expect(decodeEscapedLineBreaks("")).toBe("");
  });
});
