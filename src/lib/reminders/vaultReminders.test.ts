import { describe, expect, it } from "vitest";

import { compareReminders, extractNoteReminders, type VaultReminder } from "./vaultReminders";

const A = "<!-- reminder: 2026-10-25 09:00 -->";
const B = '<!-- reminder: 2026-11-01 18:30 "Ask Anna" -->';

describe("extractNoteReminders", () => {
  it("finds reminders on paragraphs, headings and list items", () => {
    const markdown = [`# Title ${A}`, "", `Some **bold** text ${B}`, "", `- item ${A}`, `- [ ] open ${A}`, `- [x] done ${B}`].join(
      "\n"
    );

    expect(extractNoteReminders(markdown)).toEqual([
      { due: "2026-10-25 09:00", note: null, text: "Title", checked: null, ordinal: 0 },
      { due: "2026-11-01 18:30", note: "Ask Anna", text: "Some bold text", checked: null, ordinal: 1 },
      { due: "2026-10-25 09:00", note: null, text: "item", checked: null, ordinal: 2 },
      { due: "2026-10-25 09:00", note: null, text: "open", checked: false, ordinal: 3 },
      { due: "2026-11-01 18:30", note: "Ask Anna", text: "done", checked: true, ordinal: 4 }
    ]);
  });

  it("ignores markers in code and in the middle of a paragraph", () => {
    const markdown = ["```", `code ${A}`, "```", "", `Before ${A} after`, "", `    indented ${A}`].join("\n");

    expect(extractNoteReminders(markdown)).toEqual([]);
  });

  it("returns nothing for a note without the word", () => {
    expect(extractNoteReminders("# Nothing here\n")).toEqual([]);
  });
});

describe("compareReminders", () => {
  const entry = (due: string, filePath = "a.md", ordinal = 0): VaultReminder => ({
    due,
    note: null,
    text: "x",
    checked: null,
    ordinal,
    filePath
  });

  it("sorts by time, then file, then position", () => {
    const sorted = [
      entry("2026-11-01 09:00"),
      entry("2026-10-01 09:00", "b.md"),
      entry("2026-10-01 09:00", "a.md", 1),
      entry("2026-10-01 09:00", "a.md", 0)
    ].sort(compareReminders);

    expect(sorted.map((item) => `${item.due} ${item.filePath} ${item.ordinal}`)).toEqual([
      "2026-10-01 09:00 a.md 0",
      "2026-10-01 09:00 a.md 1",
      "2026-10-01 09:00 b.md 0",
      "2026-11-01 09:00 a.md 0"
    ]);
  });
});
