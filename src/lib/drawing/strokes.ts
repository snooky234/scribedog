/**
 * The vector model behind the drawing dialog: a drawing is an ordered list of
 * strokes, each one a polyline of raw pointer positions plus colour and width.
 * Everything here is pure, so the dialog only translates pointer events into
 * these calls and renders the result.
 */

export type DrawingPoint = { x: number; y: number };

export type DrawingStroke = {
  /** `#rrggbb`, anything else is rejected before it reaches the SVG. */
  color: string;
  /** Line width in drawing units (CSS pixels at 100 %). */
  width: number;
  points: DrawingPoint[];
};

export type DrawingBounds = { minX: number; minY: number; maxX: number; maxY: number };

export const HEX_COLOR_PATTERN = /^#[0-9a-f]{6}$/i;

/**
 * Pointer events fire far more often than a line needs points; points closer
 * than this to the previous one are dropped while drawing. Small enough that
 * slow, careful lines keep their shape.
 */
const MIN_POINT_DISTANCE = 0.75;

/** Coordinates are kept to one decimal: invisible on screen, half the file. */
export function roundCoordinate(value: number): number {
  return Math.round(value * 10) / 10;
}

export function createStroke(color: string, width: number, start: DrawingPoint): DrawingStroke {
  return {
    color,
    width,
    points: [{ x: roundCoordinate(start.x), y: roundCoordinate(start.y) }]
  };
}

/** Returns the stroke with the point appended, or the same stroke when the point is too close. */
export function appendPoint(stroke: DrawingStroke, point: DrawingPoint): DrawingStroke {
  const last = stroke.points[stroke.points.length - 1];
  const next = { x: roundCoordinate(point.x), y: roundCoordinate(point.y) };

  if (last && Math.hypot(next.x - last.x, next.y - last.y) < MIN_POINT_DISTANCE) {
    return stroke;
  }

  return { ...stroke, points: [...stroke.points, next] };
}

/**
 * Stylus pressure scales the chosen width: a light touch gives half of it, a
 * firm one one and a half times. Mouse and finger report no real pressure
 * (0.5 or 0 by spec), so the dialog only applies this for a pen.
 */
export function pressureWidth(baseWidth: number, pressures: number[]): number {
  const valid = pressures.filter((pressure) => pressure > 0 && pressure <= 1);

  if (valid.length === 0) {
    return baseWidth;
  }

  const average = valid.reduce((sum, pressure) => sum + pressure, 0) / valid.length;
  return roundCoordinate(baseWidth * (0.5 + average));
}

const formatNumber = (value: number) => String(roundCoordinate(value));

/**
 * SVG path data for a stroke. The raw points are smoothed with quadratic
 * curves through the midpoints between neighbours (each raw point becomes a
 * control point), which removes the polygon look of fast mouse lines without
 * moving the line away from where it was drawn. A single point becomes a
 * zero-length segment, which the round line cap paints as a dot.
 */
export function strokePathData(points: DrawingPoint[]): string {
  if (points.length === 0) {
    return "";
  }

  const [first] = points;
  const start = `M${formatNumber(first.x)} ${formatNumber(first.y)}`;

  if (points.length === 1) {
    return `${start}l0 0`;
  }

  if (points.length === 2) {
    return `${start}L${formatNumber(points[1].x)} ${formatNumber(points[1].y)}`;
  }

  const segments: string[] = [start];

  for (let index = 1; index < points.length - 1; index += 1) {
    const control = points[index];
    const next = points[index + 1];
    const midX = (control.x + next.x) / 2;
    const midY = (control.y + next.y) / 2;
    segments.push(
      `Q${formatNumber(control.x)} ${formatNumber(control.y)} ${formatNumber(midX)} ${formatNumber(midY)}`
    );
  }

  const last = points[points.length - 1];
  segments.push(`L${formatNumber(last.x)} ${formatNumber(last.y)}`);
  return segments.join("");
}

/** The area the strokes cover, including half their width. Null for no strokes. */
export function strokesBounds(strokes: DrawingStroke[]): DrawingBounds | null {
  let bounds: DrawingBounds | null = null;

  for (const stroke of strokes) {
    const half = stroke.width / 2;

    for (const { x, y } of stroke.points) {
      if (!bounds) {
        bounds = { minX: x - half, minY: y - half, maxX: x + half, maxY: y + half };
        continue;
      }

      bounds.minX = Math.min(bounds.minX, x - half);
      bounds.minY = Math.min(bounds.minY, y - half);
      bounds.maxX = Math.max(bounds.maxX, x + half);
      bounds.maxY = Math.max(bounds.maxY, y + half);
    }
  }

  return bounds;
}

/**
 * Moves the strokes so their bounding box starts at `margin` and returns the
 * size of the cropped drawing. The dialog's surface is as large as the
 * window, the inserted image only as large as what was drawn on it. Because
 * the strokes themselves move (not just the viewBox), a drawing reopened on
 * a smaller screen starts at the top left instead of off-canvas.
 */
export function cropStrokes(
  strokes: DrawingStroke[],
  margin: number
): { strokes: DrawingStroke[]; width: number; height: number } {
  const bounds = strokesBounds(strokes);

  if (!bounds) {
    return { strokes: [], width: 0, height: 0 };
  }

  const offsetX = margin - bounds.minX;
  const offsetY = margin - bounds.minY;

  return {
    strokes: strokes.map((stroke) => ({
      ...stroke,
      points: stroke.points.map(({ x, y }) => ({
        x: roundCoordinate(x + offsetX),
        y: roundCoordinate(y + offsetY)
      }))
    })),
    width: Math.ceil(bounds.maxX - bounds.minX + margin * 2),
    height: Math.ceil(bounds.maxY - bounds.minY + margin * 2)
  };
}

function distanceToSegment(point: DrawingPoint, start: DrawingPoint, end: DrawingPoint): number {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const lengthSquared = dx * dx + dy * dy;

  if (lengthSquared === 0) {
    return Math.hypot(point.x - start.x, point.y - start.y);
  }

  const t = Math.max(0, Math.min(1, ((point.x - start.x) * dx + (point.y - start.y) * dy) / lengthSquared));
  return Math.hypot(point.x - (start.x + t * dx), point.y - (start.y + t * dy));
}

/**
 * Whether the point touches the stroke. Measured against the raw polyline,
 * not the smoothed curve: the two are at most a fraction of a pixel apart,
 * well inside the tolerance.
 */
export function strokeHit(stroke: DrawingStroke, point: DrawingPoint, tolerance: number): boolean {
  const reach = stroke.width / 2 + tolerance;
  const { points } = stroke;

  if (points.length === 1) {
    return Math.hypot(point.x - points[0].x, point.y - points[0].y) <= reach;
  }

  for (let index = 1; index < points.length; index += 1) {
    if (distanceToSegment(point, points[index - 1], points[index]) <= reach) {
      return true;
    }
  }

  return false;
}

/** The strokes the eraser at this point does *not* touch. Same array when nothing was hit. */
export function eraseStrokesAt(
  strokes: DrawingStroke[],
  point: DrawingPoint,
  tolerance: number
): DrawingStroke[] {
  const remaining = strokes.filter((stroke) => !strokeHit(stroke, point, tolerance));
  return remaining.length === strokes.length ? strokes : remaining;
}

/**
 * Undo/redo inside the dialog. One entry per finished gesture: a drawn
 * stroke, one eraser drag (however many strokes it took) or "clear all".
 */
export type DrawingHistory = {
  past: DrawingStroke[][];
  present: DrawingStroke[];
  future: DrawingStroke[][];
};

export function createHistory(strokes: DrawingStroke[] = []): DrawingHistory {
  return { past: [], present: strokes, future: [] };
}

export function commitHistory(history: DrawingHistory, next: DrawingStroke[]): DrawingHistory {
  if (next === history.present) {
    return history;
  }

  return { past: [...history.past, history.present], present: next, future: [] };
}

export function undoHistory(history: DrawingHistory): DrawingHistory {
  const previous = history.past[history.past.length - 1];

  if (!previous) {
    return history;
  }

  return {
    past: history.past.slice(0, -1),
    present: previous,
    future: [history.present, ...history.future]
  };
}

export function redoHistory(history: DrawingHistory): DrawingHistory {
  const [next, ...rest] = history.future;

  if (!next) {
    return history;
  }

  return { past: [...history.past, history.present], present: next, future: rest };
}
