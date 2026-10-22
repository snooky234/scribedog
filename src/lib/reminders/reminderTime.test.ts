import { describe, expect, it } from "vitest";

import { dueTimeOfDay, snoozeDue } from "./reminderTime";

describe("snoozeDue", () => {
  const now = new Date(2026, 9, 22, 16, 13);

  it("moves an hour on", () => {
    expect(snoozeDue("hour", now)).toBe("2026-10-22 17:13");
  });

  it("falls back to tomorrow at 9:00 without a readable time", () => {
    expect(snoozeDue("sameTimeTomorrow", now, "tomorrow")).toBe("2026-10-23 09:00");
  });

  it("moves to tomorrow at the reminder's own time, counted from today", () => {
    expect(snoozeDue("sameTimeTomorrow", now, "2026-10-20 18:30")).toBe("2026-10-23 18:30");
  });

  it("crosses the end of a month", () => {
    expect(snoozeDue("sameTimeTomorrow", new Date(2026, 9, 31, 8, 0), "2026-10-31 07:45")).toBe("2026-11-01 07:45");
  });
});

describe("dueTimeOfDay", () => {
  it("returns the time part", () => {
    expect(dueTimeOfDay("2026-10-20 18:30")).toBe("18:30");
  });
});
