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
 *
 * A drawing made on top of an image carries that image inside the file, as a
 * data URI in one marked `<image>` (`data-scribedog-background="1"`) under the
 * strokes. An SVG shown through `<img>` may not load anything else, so a
 * reference to the original file would stay blank in every viewer and in the
 * export; embedded, the file stands on its own and the original survives
 * unchanged in it. Such a drawing is not cropped: the image decides its size.
 */

export const DRAWING_MARKER_ATTRIBUTE = "data-scribedog-drawing";
export const DRAWING_BACKGROUND_ATTRIBUTE = "data-scribedog-background";

/**
 * The image a drawing was made on. `width`/`height` are the drawing's own
 * units (the image's natural size), whatever resolution the embedded data
 * itself has.
 */
export type DrawingBackground = { href: string; width: number; height: number };

export type ParsedDrawing = { strokes: DrawingStroke[]; background: DrawingBackground | null };

/** Raster formats a background may hold; anything else is not embedded or read back. */
const BACKGROUND_DATA_URI_PATTERN = /^data:image\/(?:png|jpeg|webp|gif);base64,[A-Za-z0-9+/]+=*$/;
const MAX_BACKGROUND_SIZE = 20000;

/** Space around the strokes when the drawing is cropped to what was drawn. */
export const DRAWING_MARGIN = 8;

const SVG_OPEN_TAG_PATTERN = /<svg\b[^>]*>/i;
const PATH_TAG_PATTERN = /<path\b[^>]*>/gi;
const IMAGE_TAG_PATTERN = /<image\b[^>]*>/gi;
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

/** Whether the background can be written into (and read back from) a drawing. */
export function isValidDrawingBackground(background: DrawingBackground): boolean {
  return (
    BACKGROUND_DATA_URI_PATTERN.test(background.href) &&
    Number.isInteger(background.width) &&
    Number.isInteger(background.height) &&
    background.width > 0 &&
    background.height > 0 &&
    background.width <= MAX_BACKGROUND_SIZE &&
    background.height <= MAX_BACKGROUND_SIZE
  );
}

function pathElement(stroke: DrawingStroke): string {
  const width = Math.min(MAX_STROKE_WIDTH, Math.max(0.1, roundCoordinate(stroke.width)));
  return (
    `  <path d="${strokePathData(stroke.points)}" fill="none" stroke="${stroke.color.toLowerCase()}"` +
    ` stroke-width="${width}" stroke-linecap="round" stroke-linejoin="round"` +
    ` data-points="${serializePoints(stroke.points)}"/>`
  );
}

function svgDocument(width: number, height: number, body: string[]): string {
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" ${DRAWING_MARKER_ATTRIBUTE}="1"` +
      ` width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">`,
    ...body,
    "</svg>",
    ""
  ].join("\n");
}

/**
 * The strokes as a standalone SVG. Without a background it is cropped to
 * their bounding box plus margin, with a transparent background so the
 * drawing sits on light and dark pages alike; with one it has the image's
 * size and the strokes keep their place on it (what lies outside is clipped
 * by the viewBox). Null when there is nothing to save: no strokes and no
 * background, or a background that does not pass validation.
 */
export function serializeDrawingSvg(
  strokes: DrawingStroke[],
  background: DrawingBackground | null = null
): string | null {
  const drawable = strokes.filter(
    (stroke) => stroke.points.length > 0 && HEX_COLOR_PATTERN.test(stroke.color)
  );

  if (background) {
    if (!isValidDrawingBackground(background)) {
      return null;
    }

    const { href, width, height } = background;
    return svgDocument(width, height, [
      `  <image ${DRAWING_BACKGROUND_ATTRIBUTE}="1" x="0" y="0" width="${width}" height="${height}" href="${href}"/>`,
      ...drawable.map(pathElement)
    ]);
  }

  const cropped = cropStrokes(drawable, DRAWING_MARGIN);

  if (cropped.strokes.length === 0) {
    return null;
  }

  return svgDocument(cropped.width, cropped.height, cropped.strokes.map(pathElement));
}

function readBackground(svgText: string): DrawingBackground | null | undefined {
  const tags = [...svgText.matchAll(IMAGE_TAG_PATTERN)].map((match) => match[0]);

  if (tags.length === 0) {
    return null;
  }

  const [tag] = tags;
  const openTag = svgText.match(SVG_OPEN_TAG_PATTERN)?.[0] ?? "";
  const viewBox = readAttribute(openTag, "viewBox")?.trim().split(/\s+/).map(Number);
  const href = readAttribute(tag, "href");
  const background = {
    href: href ?? "",
    width: Number(readAttribute(tag, "width")),
    height: Number(readAttribute(tag, "height"))
  };

  const fits =
    tags.length === 1 &&
    readAttribute(tag, DRAWING_BACKGROUND_ATTRIBUTE) === "1" &&
    Number(readAttribute(tag, "x") ?? "0") === 0 &&
    Number(readAttribute(tag, "y") ?? "0") === 0 &&
    viewBox?.length === 4 &&
    viewBox[0] === 0 &&
    viewBox[1] === 0 &&
    viewBox[2] === background.width &&
    viewBox[3] === background.height &&
    isValidDrawingBackground(background);

  // undefined: an image is there, but not one this model can carry over.
  return fits ? background : undefined;
}

/**
 * Reads a drawing back into strokes and, for a drawing made on an image, that
 * image. Returns null for anything that is not a ScribeDog drawing or that
 * holds a path or image the model cannot represent: editing such a file would
 * silently drop it on the next save.
 */
export function parseDrawingSvg(svgText: string): ParsedDrawing | null {
  if (!isScribeDogDrawingSvg(svgText)) {
    return null;
  }

  const background = readBackground(svgText);

  if (background === undefined) {
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

  return { strokes, background };
}
