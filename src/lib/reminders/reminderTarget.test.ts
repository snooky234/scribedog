import { describe, expect, it } from "vitest";

import {
  editOutcome,
  parseDueArgument,
  parseNoteArgument,
  pickReminderTarget,
  stripReminderMarkers
} from "./reminderTarget";

describe("parseDueArgument", () => {
  it("accepts the canonical form", () => {
    expect(parseDueArgument("2026-10-30 09:00")).toBe("2026-10-30 09:00");
  });

  it("accepts the near misses models produce", () => {
    expect(parseDueArgument("2026-10-30T09:00")).toBe("2026-10-30 09:00");
    expect(parseDueArgument("2026-10-30T09:00:00")).toBe("2026-10-30 09:00");
    expect(parseDueArgument(" 2026-10-30 9:05 ")).toBe("2026-10-30 09:05");
    expect(parseDueArgument("2026-1-5 14.30")).toBe("2026-01-05 14:30");
  });

  it("gives a date without a time the default time", () => {
    expect(parseDueArgument("2026-10-30")).toBe("2026-10-30 09:00");
  });

  it("rejects what is not a local due time", () => {
    expect(parseDueArgument("2026-10-30T09:00Z")).toBeNull();
    expect(parseDueArgument("2026-02-30 09:00")).toBeNull();
    expect(parseDueArgument("2026-10-30 25:00")).toBeNull();
    expect(parseDueArgument("Friday 9:00")).toBeNull();
    expect(parseDueArgument(20261030)).toBeNull();
    expect(parseDueArgument(undefined)).toBeNull();
  });
});

describe("parseNoteArgument", () => {
  it("trims and drops quotes a model wrapped around the note", () => {
    expect(parseNoteArgument('  "Chapter 3 first" ')).toBe("Chapter 3 first");
  });

  it("is null for nothing", () => {
    expect(parseNoteArgument("   ")).toBeNull();
    expect(parseNoteArgument(null)).toBeNull();
  });
});

describe("stripReminderMarkers", () => {
  it("takes the marker off every line", () => {
    expect(
      stripReminderMarkers('First <!-- reminder: 2026-10-30 09:00 -->\nSecond <!-- reminder: 2026-10-31 10:00 "x" -->')
    ).toBe("First\nSecond");
  });
});

describe("pickReminderTarget", () => {
  const blocks = ["Introduction", "Check the sources for chapter 3", "Check the sources for chapter 4", "Summary"];

  it("finds the one block that contains the text", () => {
    expect(pickReminderTarget(blocks, "chapter 3")).toEqual({ kind: "found", index: 1 });
  });

  it("tolerates Markdown, the marker and typography in the quote", () => {
    expect(
      pickReminderTarget(blocks, '- [ ] **Check the sources** for chapter 4 <!-- reminder: 2026-10-30 09:00 -->')
    ).toEqual({ kind: "found", index: 2 });
  });

  it("refuses to guess between several blocks", () => {
    expect(pickReminderTarget(blocks, "Check the sources")).toEqual({ kind: "ambiguous", count: 2 });
  });

  it("prefers a block that is exactly the text over ones that only contain it", () => {
    expect(pickReminderTarget(["Summary", "Summary of chapter 3"], "summary")).toEqual({ kind: "found", index: 0 });
  });

  it("reports a text no block contains", () => {
    expect(pickReminderTarget(blocks, "Conclusion")).toEqual({ kind: "not-found" });
    expect(pickReminderTarget(blocks, "  ")).toEqual({ kind: "not-found" });
  });
});

describe("editOutcome", () => {
  const reminder = { due: "2026-10-30 09:00", note: null };

  it("tells setting, replacing, removing and no-ops apart", () => {
    expect(editOutcome("A", null, reminder)).toEqual({ kind: "set", blockText: "A", previous: null });
    expect(editOutcome("A", reminder, null)).toEqual({ kind: "removed", blockText: "A", previous: reminder });
    expect(editOutcome("A", reminder, { ...reminder })).toEqual({ kind: "unchanged", blockText: "A" });
    expect(editOutcome("A", null, null)).toEqual({ kind: "no-reminder", blockText: "A" });
  });
});
