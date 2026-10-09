import { describe, expect, it } from "vitest";

import {
  appendPoint,
  commitHistory,
  createHistory,
  createStroke,
  cropStrokes,
  eraseStrokesAt,
  pressureWidth,
  redoHistory,
  strokeHit,
  strokePathData,
  strokesBounds,
  undoHistory,
  type DrawingStroke
} from "./strokes";

const stroke = (points: Array<[number, number]>, width = 4, color = "#000000"): DrawingStroke => ({
  color,
  width,
  points: points.map(([x, y]) => ({ x, y }))
});

describe("appendPoint", () => {
  it("rounds coordinates to one decimal", () => {
    const next = appendPoint(createStroke("#000000", 2, { x: 0.04, y: 0 }), { x: 10.26, y: 3.333 });
    expect(next.points).toEqual([
      { x: 0, y: 0 },
      { x: 10.3, y: 3.3 }
    ]);
  });

  it("drops points that barely moved and keeps the same stroke object", () => {
    const start = createStroke("#000000", 2, { x: 5, y: 5 });
    expect(appendPoint(start, { x: 5.3, y: 5.2 })).toBe(start);
  });
});

describe("pressureWidth", () => {
  it("keeps the width without pressure data", () => {
    expect(pressureWidth(4, [])).toBe(4);
    expect(pressureWidth(4, [0, 0])).toBe(4);
  });

  it("scales between half and one and a half times the width", () => {
    expect(pressureWidth(4, [0.5])).toBe(4);
    expect(pressureWidth(4, [1])).toBe(6);
    expect(pressureWidth(4, [0.1])).toBe(2.4);
  });
});

describe("strokePathData", () => {
  it("draws a single point as a dot", () => {
    expect(strokePathData([{ x: 3, y: 4 }])).toBe("M3 4l0 0");
  });

  it("draws two points as a straight line", () => {
    expect(strokePathData([{ x: 0, y: 0 }, { x: 10, y: 5 }])).toBe("M0 0L10 5");
  });

  it("smooths longer lines through the midpoints", () => {
    expect(
      strokePathData([
        { x: 0, y: 0 },
        { x: 10, y: 0 },
        { x: 10, y: 10 }
      ])
    ).toBe("M0 0Q10 0 10 5L10 10");
  });

  it("is empty for no points", () => {
    expect(strokePathData([])).toBe("");
  });
});

describe("strokesBounds and cropStrokes", () => {
  it("includes half the line width", () => {
    expect(strokesBounds([stroke([[10, 20], [30, 40]], 4)])).toEqual({
      minX: 8,
      minY: 18,
      maxX: 32,
      maxY: 42
    });
  });

  it("is null without strokes", () => {
    expect(strokesBounds([])).toBeNull();
  });

  it("moves the strokes to the margin and sizes the drawing to them", () => {
    const result = cropStrokes([stroke([[100, 200], [150, 220]], 4), stroke([[120, 260]], 2)], 8);

    expect(result.width).toBe(70);
    expect(result.height).toBe(79);
    expect(result.strokes[0].points[0]).toEqual({ x: 10, y: 10 });
    expect(result.strokes[1].points[0]).toEqual({ x: 30, y: 70 });
  });

  it("returns an empty drawing for no strokes", () => {
    expect(cropStrokes([], 8)).toEqual({ strokes: [], width: 0, height: 0 });
  });
});

describe("strokeHit and eraseStrokesAt", () => {
  const line = stroke([[0, 0], [100, 0]], 4);

  it("hits within half the width plus tolerance", () => {
    expect(strokeHit(line, { x: 50, y: 5 }, 3)).toBe(true);
    expect(strokeHit(line, { x: 50, y: 6 }, 3)).toBe(false);
  });

  it("measures beyond the ends from the end point", () => {
    expect(strokeHit(line, { x: 104, y: 0 }, 3)).toBe(true);
    expect(strokeHit(line, { x: 106, y: 0 }, 3)).toBe(false);
  });

  it("hits a single dot", () => {
    expect(strokeHit(stroke([[10, 10]], 6), { x: 13, y: 14 }, 2)).toBe(true);
  });

  it("removes every touched stroke as a whole", () => {
    const crossing = stroke([[50, -20], [50, 20]], 2);
    const far = stroke([[0, 100], [10, 100]], 2);
    expect(eraseStrokesAt([line, crossing, far], { x: 50, y: 0 }, 2)).toEqual([far]);
  });

  it("returns the same array when nothing was hit", () => {
    const strokes = [line];
    expect(eraseStrokesAt(strokes, { x: 50, y: 50 }, 2)).toBe(strokes);
  });
});

describe("history", () => {
  const a = stroke([[0, 0]]);
  const b = stroke([[5, 5]]);

  it("undoes and redoes one gesture at a time", () => {
    let history = createHistory();
    history = commitHistory(history, [a]);
    history = commitHistory(history, [a, b]);

    history = undoHistory(history);
    expect(history.present).toEqual([a]);
    history = undoHistory(history);
    expect(history.present).toEqual([]);
    expect(undoHistory(history)).toBe(history);

    history = redoHistory(history);
    history = redoHistory(history);
    expect(history.present).toEqual([a, b]);
    expect(redoHistory(history)).toBe(history);
  });

  it("drops the redo branch on a new gesture", () => {
    let history = commitHistory(createHistory([a]), [a, b]);
    history = undoHistory(history);
    history = commitHistory(history, []);
    expect(history.future).toEqual([]);
  });

  it("ignores a gesture that changed nothing", () => {
    const history = createHistory([a]);
    expect(commitHistory(history, history.present)).toBe(history);
  });
});
