import {
  HEX_COLOR_PATTERN,
  cropStrokes,
  roundCoordinate,
  strokePathData,
  type DrawingPoint,
  type DrawingStroke
} from "@/lib/drawing/strokes";

/**
 * A drawing is saved as an ordinary SVG image in `images/`, so every viewer
 * shows it and the note stays plain Markdown. Two additions make it editable
 * again: the root carries `data-scribedog-drawing="1"` (only such files are
 * offered for editing; a foreign SVG with gradients, text or groups would be
 * destroyed by a dialog that only knows strokes), and every `<path>` carries
 * its raw points in `data-points`, so reopening does not have to reverse the
 * smoothed path data. Other viewers ignore both attributes.
 */

export const DRAWING_MARKER_ATTRIBUTE = "data-scribedog-drawing";

/** Space around the strokes when the drawing is cropped to what was drawn. */
export const DRAWING_MARGIN = 8;

const SVG_OPEN_TAG_PATTERN = /<svg\b[^>]*>/i;
const PATH_TAG_PATTERN = /<path\b[^>]*>/gi;
const MAX_STROKE_WIDTH = 200;

function readAttribute(tag: string, name: string): string | null {
  const match = tag.match(new RegExp(`\\s${name}\\s*=\\s*"([^"]*)"`, "i"));
  return match ? match[1] : null;
}

function serializePoints(points: DrawingPoint[]): string {
  return points.map(({ x, y }) => `${x},${y}`).join(" ");
}

function parsePoints(value: string): DrawingPoint[] | null {
  const points: DrawingPoint[] = [];

  for (const pair of value.trim().split(/\s+/)) {
    const [x, y, extra] = pair.split(",");

    if (extra !== undefined) {
      return null;
    }

    const parsedX = Number(x);
    const parsedY = Number(y);

    if (!Number.isFinite(parsedX) || !Number.isFinite(parsedY)) {
      return null;
    }

    points.push({ x: roundCoordinate(parsedX), y: roundCoordinate(parsedY) });
  }

  return points.length > 0 ? points : null;
}

/** Whether the file is a drawing this app wrote (and can therefore edit without loss). */
export function isScribeDogDrawingSvg(svgText: string): boolean {
  const openTag = svgText.match(SVG_OPEN_TAG_PATTERN)?.[0];
  return openTag ? readAttribute(openTag, DRAWING_MARKER_ATTRIBUTE) === "1" : false;
}

/**
 * The strokes as a standalone SVG, cropped to their bounding box plus
 * margin, with a transparent background so the drawing sits on light and
 * dark pages alike. Null when there is nothing to save.
 */
export function serializeDrawingSvg(strokes: DrawingStroke[]): string | null {
  const drawable = strokes.filter(
    (stroke) => stroke.points.length > 0 && HEX_COLOR_PATTERN.test(stroke.color)
  );
  const cropped = cropStrokes(drawable, DRAWING_MARGIN);

  if (cropped.strokes.length === 0) {
    return null;
  }

  const paths = cropped.strokes.map((stroke) => {
    const width = Math.min(MAX_STROKE_WIDTH, Math.max(0.1, roundCoordinate(stroke.width)));
    return (
      `  <path d="${strokePathData(stroke.points)}" fill="none" stroke="${stroke.color.toLowerCase()}"` +
      ` stroke-width="${width}" stroke-linecap="round" stroke-linejoin="round"` +
      ` data-points="${serializePoints(stroke.points)}"/>`
    );
  });

  return [
    `<svg xmlns="http://www.w3.org/2000/svg" ${DRAWING_MARKER_ATTRIBUTE}="1"` +
      ` width="${cropped.width}" height="${cropped.height}" viewBox="0 0 ${cropped.width} ${cropped.height}">`,
    ...paths,
    "</svg>",
    ""
  ].join("\n");
}

/**
 * Reads a drawing back into strokes. Returns null for anything that is not a
 * ScribeDog drawing or that holds a path the model cannot represent: editing
 * such a file would silently drop that path on the next save.
 */
export function parseDrawingSvg(svgText: string): DrawingStroke[] | null {
  if (!isScribeDogDrawingSvg(svgText)) {
    return null;
  }

  const strokes: DrawingStroke[] = [];

  for (const match of svgText.matchAll(PATH_TAG_PATTERN)) {
    const tag = match[0];
    const color = readAttribute(tag, "stroke");
    const width = Number(readAttribute(tag, "stroke-width"));
    const rawPoints = readAttribute(tag, "data-points");
    const points = rawPoints === null ? null : parsePoints(rawPoints);

    if (!color || !HEX_COLOR_PATTERN.test(color) || !Number.isFinite(width) || width <= 0 || !points) {
      return null;
    }

    strokes.push({ color: color.toLowerCase(), width: Math.min(MAX_STROKE_WIDTH, width), points });
  }

  return strokes;
}
