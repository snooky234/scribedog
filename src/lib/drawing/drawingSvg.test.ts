import { describe, expect, it } from "vitest";

import { isScribeDogDrawingSvg, parseDrawingSvg, serializeDrawingSvg } from "./drawingSvg";
import type { DrawingStroke } from "./strokes";

const strokes: DrawingStroke[] = [
  {
    color: "#1D4ED8",
    width: 4,
    points: [
      { x: 100, y: 100 },
      { x: 140, y: 120 },
      { x: 180, y: 100 }
    ]
  },
  { color: "#dc2626", width: 8, points: [{ x: 120, y: 160 }] }
];

describe("serializeDrawingSvg", () => {
  it("writes a marked, cropped SVG with one path per stroke", () => {
    const svg = serializeDrawingSvg(strokes)!;

    expect(svg).toContain('data-scribedog-drawing="1"');
    expect(svg).toContain('width="100" height="82" viewBox="0 0 100 82"');
    expect(svg.match(/<path /g)).toHaveLength(2);
    expect(svg).toContain('stroke="#1d4ed8" stroke-width="4"');
    expect(svg).toContain('data-points="10,10 50,30 90,10"');
    expect(svg).not.toContain("background");
  });

  it("returns null when nothing was drawn", () => {
    expect(serializeDrawingSvg([])).toBeNull();
  });

  it("drops strokes whose colour is not a plain hex value", () => {
    const svg = serializeDrawingSvg([
      { color: '"/><script>alert(1)</script>', width: 2, points: [{ x: 0, y: 0 }] },
      strokes[1]
    ])!;

    expect(svg).not.toContain("script");
    expect(svg.match(/<path /g)).toHaveLength(1);
  });
});

describe("parseDrawingSvg", () => {
  it("round-trips the strokes, moved to the margin", () => {
    const parsed = parseDrawingSvg(serializeDrawingSvg(strokes)!)!;

    expect(parsed).toHaveLength(2);
    expect(parsed[0]).toEqual({
      color: "#1d4ed8",
      width: 4,
      points: [
        { x: 10, y: 10 },
        { x: 50, y: 30 },
        { x: 90, y: 10 }
      ]
    });
    expect(parsed[1]).toEqual({ color: "#dc2626", width: 8, points: [{ x: 30, y: 70 }] });
  });

  it("is stable when saved again", () => {
    const once = serializeDrawingSvg(strokes)!;
    expect(serializeDrawingSvg(parseDrawingSvg(once)!)).toBe(once);
  });

  it("refuses an SVG without the marker", () => {
    expect(parseDrawingSvg('<svg xmlns="http://www.w3.org/2000/svg"><path d="M0 0"/></svg>')).toBeNull();
  });

  it("refuses a marked SVG with a path it cannot represent", () => {
    const foreign =
      '<svg xmlns="http://www.w3.org/2000/svg" data-scribedog-drawing="1"><path d="M0 0L5 5" stroke="#000000" stroke-width="2"/></svg>';
    expect(parseDrawingSvg(foreign)).toBeNull();
  });

  it("refuses broken point lists", () => {
    const broken =
      '<svg data-scribedog-drawing="1"><path stroke="#000000" stroke-width="2" data-points="1,2 x,3"/></svg>';
    expect(parseDrawingSvg(broken)).toBeNull();
  });

  it("reads an empty marked drawing as no strokes", () => {
    expect(parseDrawingSvg('<svg data-scribedog-drawing="1"></svg>')).toEqual([]);
  });
});

describe("isScribeDogDrawingSvg", () => {
  it("looks only at the root element", () => {
    expect(isScribeDogDrawingSvg('<?xml version="1.0"?>\n<svg data-scribedog-drawing="1" width="1">')).toBe(true);
    expect(isScribeDogDrawingSvg('<svg><g data-scribedog-drawing="1"></g></svg>')).toBe(false);
    expect(isScribeDogDrawingSvg("not an svg")).toBe(false);
  });
});
