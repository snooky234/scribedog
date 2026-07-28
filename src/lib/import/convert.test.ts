import { describe, expect, it, vi } from "vitest";

// convert.ts reaches the filesystem only for sources picked through the file
// dialog; the sources built here carry their content directly.
vi.mock("@tauri-apps/plugin-fs", () => ({
  readTextFile: vi.fn(async () => ""),
  stat: vi.fn(async () => ({ size: 0 }))
}));

vi.mock("@/lib/fileSystem", () => ({ allowFileAccess: vi.fn(async () => undefined) }));

import {
  SourceTooLargeError,
  classifyExtension,
  convertToMarkdown,
  extensionOf,
  isConvertibleFileName,
  type ConvertSource
} from "./convert";

const NO_IMAGES = { embedImages: false } as const;

function givenFile(name: string, content: string): ConvertSource {
  const bytes = new TextEncoder().encode(content);

  return {
    name,
    byteLength: async () => bytes.byteLength,
    bytes: async () => bytes,
    text: async () => content
  };
}

function convert(name: string, content: string): Promise<string> {
  return convertToMarkdown(givenFile(name, content), NO_IMAGES);
}

describe("classifyExtension", () => {
  it("separates the formats that need converting from the ones that do not", () => {
    expect(classifyExtension("md")).toBe("markdown");
    expect(classifyExtension("csv")).toBe("text");
    expect(classifyExtension("pdf")).toBe("document");
    expect(classifyExtension("png")).toBe("image");
  });

  it("names the legacy .doc format apart from unsupported ones", () => {
    expect(classifyExtension("doc")).toBe("legacyDoc");
    expect(classifyExtension("xlsx")).toBe("unsupported");
    expect(classifyExtension("")).toBe("unsupported");
  });

  it("does not treat a dotfile's name as an extension", () => {
    expect(extensionOf(".gitignore")).toBe("");
    expect(isConvertibleFileName(".gitignore")).toBe(false);
    expect(isConvertibleFileName("notes.MD")).toBe(true);
  });
});

describe("text conversion", () => {
  it("keeps markdown and plain text verbatim", async () => {
    const markdown = "# Titel\n\nEin *Absatz*.\n";

    await expect(convert("notiz.md", markdown)).resolves.toBe(markdown);
    await expect(convert("notiz.txt", "Zeile eins\nZeile zwei")).resolves.toBe(
      "Zeile eins\nZeile zwei"
    );
  });

  it("strips the BOM Excel and Notepad write", async () => {
    await expect(convert("notiz.txt", "﻿Text")).resolves.toBe("Text");
  });

  it("fences structured formats so their exact characters survive", async () => {
    await expect(convert("data.json", '{\n  "a": 1\n}\n')).resolves.toBe(
      '```json\n{\n  "a": 1\n}\n```'
    );
    await expect(convert("app.log", "line")).resolves.toBe("```\nline\n```");
  });

  it("refuses a file too large to be a note", async () => {
    const source = givenFile("huge.txt", "x".repeat(6 * 1024 * 1024));

    await expect(convertToMarkdown(source, NO_IMAGES)).rejects.toBeInstanceOf(SourceTooLargeError);
  });
});

describe("delimited text", () => {
  it("renders a CSV as a pipe table with a header row", async () => {
    await expect(convert("t.csv", "Name,Ort\nAnna,Berlin\nBo,Kiel")).resolves.toBe(
      ["| Name | Ort |", "| --- | --- |", "| Anna | Berlin |", "| Bo | Kiel |"].join("\n")
    );
  });

  it("detects the semicolon a German Excel writes", async () => {
    await expect(convert("t.csv", 'Name;Ort\n"Meier, Anna";Berlin')).resolves.toBe(
      ["| Name | Ort |", "| --- | --- |", "| Meier, Anna | Berlin |"].join("\n")
    );
  });

  it("keeps quoted delimiters, escaped quotes and embedded newlines inside their cell", async () => {
    await expect(convert("t.csv", 'A,B\n"x,y","sagt ""hallo"""\n"zwei\nZeilen",z')).resolves.toBe(
      [
        "| A | B |",
        "| --- | --- |",
        "| x,y | sagt \"hallo\" |",
        "| zwei<br>Zeilen | z |"
      ].join("\n")
    );
  });

  it("escapes pipes so a cell cannot break the table", async () => {
    await expect(convert("t.csv", "A\na|b")).resolves.toBe(
      ["| A |", "| --- |", "| a\\|b |"].join("\n")
    );
  });

  it("pads ragged rows to the widest one", async () => {
    await expect(convert("t.csv", "A,B,C\n1")).resolves.toBe(
      ["| A | B | C |", "| --- | --- | --- |", "| 1 |  |  |"].join("\n")
    );
  });

  it("splits a TSV on tabs even when the row also contains commas", async () => {
    await expect(convert("t.tsv", "A\tB\n1,5\t2")).resolves.toBe(
      ["| A | B |", "| --- | --- |", "| 1,5 | 2 |"].join("\n")
    );
  });

  it("falls back to a code fence when the table would be unreadably long", async () => {
    const rows = Array.from({ length: 1_200 }, (_, index) => `${index},x`).join("\n");

    await expect(convert("t.csv", `A,B\n${rows}`)).resolves.toMatch(/^```\nA,B\n0,x/);
  });
});
