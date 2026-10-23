import { describe, expect, it } from "vitest";

import { setMarkdownBlockReminder } from "./markdownReminderEdit";

const FRIDAY = { due: "2026-10-30 09:00", note: null };
const NOTE = "# Plan\n\nShorten this paragraph.\nIt has two lines.\n\n- [ ] Check the sources\n- [ ] Ask Anna\n";

describe("setMarkdownBlockReminder", () => {
  it("puts the marker at the end of the block's last line and changes nothing else", () => {
    const edit = setMarkdownBlockReminder(NOTE, "Shorten this paragraph", FRIDAY);

    expect(edit.kind).toBe("set");
    expect(edit.content).toBe(
      "# Plan\n\nShorten this paragraph.\nIt has two lines. <!-- reminder: 2026-10-30 09:00 -->\n\n- [ ] Check the sources\n- [ ] Ask Anna\n"
    );
  });

  it("sets it on a checklist item and a heading", () => {
    expect(setMarkdownBlockReminder(NOTE, "Ask Anna", { due: "2026-10-30 09:00", note: "about the budget" }).content).toContain(
      '- [ ] Ask Anna <!-- reminder: 2026-10-30 09:00 "about the budget" -->'
    );
    expect(setMarkdownBlockReminder(NOTE, "Plan", FRIDAY).content).toContain(
      "# Plan <!-- reminder: 2026-10-30 09:00 -->\n"
    );
  });

  it("puts a setext heading's marker on its text line, not on the underline", () => {
    expect(setMarkdownBlockReminder("Title\n=====\n\nText\n", "Title", FRIDAY).content).toBe(
      "Title <!-- reminder: 2026-10-30 09:00 -->\n=====\n\nText\n"
    );
  });

  it("replaces a block's reminder instead of adding a second one", () => {
    const withReminder = setMarkdownBlockReminder(NOTE, "Ask Anna", FRIDAY).content!;
    const edit = setMarkdownBlockReminder(withReminder, "Ask Anna", { due: "2026-11-02 14:00", note: null });

    expect(edit).toMatchObject({ kind: "set", previous: FRIDAY });
    expect(edit.content).toContain("- [ ] Ask Anna <!-- reminder: 2026-11-02 14:00 -->\n");
    expect(edit.content!.match(/reminder:/g)).toHaveLength(1);
  });

  it("removes a reminder and leaves the line as it was", () => {
    const withReminder = setMarkdownBlockReminder(NOTE, "Ask Anna", FRIDAY).content!;
    const edit = setMarkdownBlockReminder(withReminder, "Ask Anna", null);

    expect(edit.kind).toBe("removed");
    expect(edit.content).toBe(NOTE);
  });

  it("changes nothing when there is nothing to change", () => {
    const withReminder = setMarkdownBlockReminder(NOTE, "Ask Anna", FRIDAY).content!;

    expect(setMarkdownBlockReminder(withReminder, "Ask Anna", FRIDAY)).toEqual({
      kind: "unchanged",
      blockText: "Ask Anna"
    });
    expect(setMarkdownBlockReminder(NOTE, "Ask Anna", null)).toEqual({ kind: "no-reminder", blockText: "Ask Anna" });
  });

  it("keeps CRLF line endings", () => {
    expect(setMarkdownBlockReminder("One\r\n\r\nTwo\r\n", "Two", FRIDAY).content).toBe(
      "One\r\n\r\nTwo <!-- reminder: 2026-10-30 09:00 -->\r\n"
    );
  });

  it("does not find text in a code block or a table", () => {
    const note = "```\nCheck the sources\n```\n\n| Check the sources |\n| --- |\n| x |\n";

    expect(setMarkdownBlockReminder(note, "Check the sources", FRIDAY)).toEqual({ kind: "not-found" });
  });

  it("refuses an ambiguous quote", () => {
    expect(setMarkdownBlockReminder(NOTE, "- [ ]", FRIDAY).kind).toBe("not-found");
    expect(setMarkdownBlockReminder("Check A\n\nCheck B\n", "Check", FRIDAY)).toEqual({ kind: "ambiguous", count: 2 });
  });
});
