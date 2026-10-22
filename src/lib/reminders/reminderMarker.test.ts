import { describe, expect, it } from "vitest";

import {
  dateToDue,
  dueToDate,
  formatReminderMarker,
  isValidDue,
  normalizeReminder,
  splitTrailingReminder
} from "./reminderMarker";

describe("isValidDue", () => {
  it.each(["2026-10-25 09:00", "2024-02-29 23:59", "2026-01-01 00:00"])("accepts %s", (due) => {
    expect(isValidDue(due)).toBe(true);
  });

  it.each(["2026-02-30 09:00", "2026-13-01 09:00", "2026-10-25 24:00", "2026-10-25 09:60", "2026-10-25T09:00", "2026-10-25", ""])(
    "rejects %s",
    (due) => {
      expect(isValidDue(due)).toBe(false);
    }
  );
});

describe("dueToDate / dateToDue", () => {
  it("reads and writes local wall-clock time", () => {
    const date = dueToDate("2026-10-25 09:05")!;

    expect([date.getFullYear(), date.getMonth(), date.getDate(), date.getHours(), date.getMinutes()]).toEqual([
      2026, 9, 25, 9, 5
    ]);
    expect(dateToDue(date)).toBe("2026-10-25 09:05");
  });
});

describe("formatReminderMarker", () => {
  it("writes the time alone without a note", () => {
    expect(formatReminderMarker({ due: "2026-10-25 09:00", note: null })).toBe("<!-- reminder: 2026-10-25 09:00 -->");
  });

  it("writes the note as a JSON string", () => {
    expect(formatReminderMarker({ due: "2026-10-25 09:00", note: 'Say "hi"' })).toBe(
      '<!-- reminder: 2026-10-25 09:00 "Say \\"hi\\"" -->'
    );
  });

  it("never lets a note end the comment early", () => {
    const marker = formatReminderMarker({ due: "2026-10-25 09:00", note: "a --> b" });

    expect(marker.indexOf("-->")).toBe(marker.length - 3);
  });

  it("drops an empty note", () => {
    expect(formatReminderMarker({ due: "2026-10-25 09:00", note: "   " })).toBe("<!-- reminder: 2026-10-25 09:00 -->");
  });
});

describe("splitTrailingReminder", () => {
  it("splits the marker off the end", () => {
    expect(splitTrailingReminder("Shorten this. <!-- reminder: 2026-10-25 09:00 -->")).toEqual({
      text: "Shorten this.",
      reminder: { due: "2026-10-25 09:00", note: null }
    });
  });

  it("round-trips notes with quotes, line breaks, umlauts and comment ends", () => {
    for (const note of ['Say "hi"', "two\nlines", "Kürzen!", "a --> b", "back\\slash"]) {
      const marker = formatReminderMarker({ due: "2026-10-25 09:00", note });

      expect(splitTrailingReminder(`Text ${marker}`)).toEqual({
        text: "Text",
        reminder: { due: "2026-10-25 09:00", note }
      });
    }
  });

  it("reads tolerant spellings", () => {
    expect(splitTrailingReminder("Text<!--reminder 2026-10-25 9:00-->  ").reminder).toEqual({
      due: "2026-10-25 09:00",
      note: null
    });
  });

  it("keeps a marker that is not at the end", () => {
    const text = "Before <!-- reminder: 2026-10-25 09:00 --> after";

    expect(splitTrailingReminder(text)).toEqual({ text, reminder: null });
  });

  it("keeps a marker with an impossible date", () => {
    const text = "Text <!-- reminder: 2026-02-30 09:00 -->";

    expect(splitTrailingReminder(text)).toEqual({ text, reminder: null });
  });

  it("keeps other comments", () => {
    const text = "Text <!-- todo -->";

    expect(splitTrailingReminder(text)).toEqual({ text, reminder: null });
  });
});

describe("normalizeReminder", () => {
  it("accepts a valid reminder and trims the note", () => {
    expect(normalizeReminder({ due: "2026-10-25 09:00", note: "  x  " })).toEqual({ due: "2026-10-25 09:00", note: "x" });
  });

  it.each([null, undefined, "x", {}, { due: "tomorrow" }])("rejects %s", (value) => {
    expect(normalizeReminder(value)).toBeNull();
  });
});
