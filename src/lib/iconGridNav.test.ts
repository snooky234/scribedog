import { describe, expect, it } from "vitest";

import { nextGridIndex } from "./iconGridNav";

// 20 cells, 9 wide: rows of 9, 9 and a last one of 2 (indices 18 and 19).
const move = (key: string, index: number, ctrl = false) => nextGridIndex(key, ctrl, index, 20, 9, 8);

describe("nextGridIndex", () => {
  it("steps sideways and stops at the ends", () => {
    expect(move("ArrowRight", 4)).toBe(5);
    expect(move("ArrowLeft", 4)).toBe(3);
    expect(move("ArrowLeft", 0)).toBe(0);
    expect(move("ArrowRight", 19)).toBe(19);
  });

  it("steps by rows and leaves through the top", () => {
    expect(move("ArrowDown", 3)).toBe(12);
    expect(move("ArrowUp", 12)).toBe(3);
    expect(move("ArrowUp", 4)).toBe("leave-up");
  });

  it("lands on the last cell when the row below is short", () => {
    expect(move("ArrowDown", 15)).toBe(19);
    expect(move("ArrowDown", 19)).toBe(19);
  });

  it("goes to the edges of the row, or of the whole grid with Ctrl", () => {
    expect(move("Home", 13)).toBe(9);
    expect(move("End", 13)).toBe(17);
    expect(move("End", 19)).toBe(19);
    expect(move("Home", 13, true)).toBe(0);
    expect(move("End", 3, true)).toBe(19);
  });

  it("pages and clamps", () => {
    expect(move("PageDown", 2)).toBe(19);
    expect(move("PageUp", 15)).toBe(0);
  });

  it("ignores other keys and an empty grid", () => {
    expect(move("a", 3)).toBeNull();
    expect(nextGridIndex("ArrowDown", false, 0, 0, 9, 8)).toBeNull();
  });
});
