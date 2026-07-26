import { describe, expect, it } from "vitest";

import {
  EMPTY_NAVIGATION_HISTORY,
  MAX_NAVIGATION_HISTORY,
  findStepIndex,
  visitPath,
  type NavigationHistory
} from "./navigationHistory";

function historyOf(entries: string[], index = entries.length - 1): NavigationHistory {
  return { entries, index };
}

describe("visitPath", () => {
  it("pushes onto an empty history", () => {
    expect(visitPath(EMPTY_NAVIGATION_HISTORY, "a.md")).toEqual({ entries: ["a.md"], index: 0 });
  });

  it("ignores the note that is already open", () => {
    const history = historyOf(["a.md", "b.md"]);

    expect(visitPath(history, "b.md")).toBe(history);
  });

  it("drops the forward entries when navigating from the middle", () => {
    expect(visitPath(historyOf(["a.md", "b.md", "c.md"], 1), "d.md")).toEqual({
      entries: ["a.md", "b.md", "d.md"],
      index: 2
    });
  });

  it("keeps a repeat visit as its own entry", () => {
    expect(visitPath(historyOf(["a.md", "b.md"]), "a.md")).toEqual({
      entries: ["a.md", "b.md", "a.md"],
      index: 2
    });
  });

  it("drops the oldest entries once the cap is reached", () => {
    const entries = Array.from({ length: MAX_NAVIGATION_HISTORY }, (_, index) => `${index}.md`);
    const result = visitPath(historyOf(entries), "new.md");

    expect(result.entries).toHaveLength(MAX_NAVIGATION_HISTORY);
    expect(result.entries[0]).toBe("1.md");
    expect(result.entries[result.entries.length - 1]).toBe("new.md");
    expect(result.index).toBe(MAX_NAVIGATION_HISTORY - 1);
  });
});

describe("findStepIndex", () => {
  const all = ["a.md", "b.md", "c.md"];

  it("steps back and forward one entry", () => {
    expect(findStepIndex(historyOf(all, 2), -1, all)).toBe(1);
    expect(findStepIndex(historyOf(all, 1), 1, all)).toBe(2);
  });

  it("returns null at both ends", () => {
    expect(findStepIndex(historyOf(all, 0), -1, all)).toBeNull();
    expect(findStepIndex(historyOf(all, 2), 1, all)).toBeNull();
    expect(findStepIndex(EMPTY_NAVIGATION_HISTORY, -1, all)).toBeNull();
  });

  it("skips entries whose file is gone", () => {
    expect(findStepIndex(historyOf(all, 2), -1, ["a.md", "c.md"])).toBe(0);
    expect(findStepIndex(historyOf(all, 2), -1, ["c.md"])).toBeNull();
  });
});
