import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Eraser, Pencil, Redo2, Trash2, Undo2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  appendPoint,
  commitHistory,
  createHistory,
  createStroke,
  eraseStrokesAt,
  HEX_COLOR_PATTERN,
  pressureWidth,
  redoHistory,
  strokePathData,
  undoHistory,
  type DrawingPoint,
  type DrawingStroke
} from "@/lib/drawing/strokes";
import { cn } from "@/lib/utils";
import { useEditorSettingsStore } from "@/store/useEditorSettingsStore";

type DrawingDialogProps = {
  /** "insert" puts a new image at the caret, "edit" overwrites an existing drawing. */
  mode: "insert" | "edit";
  initialStrokes: DrawingStroke[];
  /** While the file is written the dialog stays open but takes no input. */
  busy: boolean;
  onSubmit: (strokes: DrawingStroke[]) => void;
  onCancel: () => void;
};

type Tool = "pen" | "eraser";

const PEN_WIDTHS = [2, 4, 8, 16] as const;
// Stroke colours are content (they end up in the SVG file), not theme
// colours, so they are literal values rather than tokens.
const PEN_COLORS = [
  "#111827",
  "#6b7280",
  "#dc2626",
  "#ea580c",
  "#eab308",
  "#16a34a",
  "#2563eb",
  "#9333ea",
  "#f9fafb"
] as const;
const LIGHT_INK = PEN_COLORS[PEN_COLORS.length - 1];
const DARK_INK = PEN_COLORS[0];
const ERASER_RADIUS = 8;

// The last pen settings outlive the dialog for the session, so a second
// sketch does not start over with the defaults.
let rememberedColor: string | null = null;
let rememberedWidth: number = PEN_WIDTHS[1];

type Gesture =
  | { kind: "pen"; pointerId: number; stroke: DrawingStroke; pressures: number[]; usesPressure: boolean }
  | { kind: "eraser"; pointerId: number; strokes: DrawingStroke[]; last: DrawingPoint };

/**
 * Freehand sketching on an SVG surface. Every stroke is a vector object, so
 * what is shown here is exactly what gets saved, and the eraser removes a
 * touched stroke as a whole. The surface takes the window's size; the saved
 * image is cropped to the strokes (drawingSvg.ts). Undo/redo cover the
 * dialog only: once a drawing is applied, its file is replaced and the
 * editor's own undo has nothing to do with it.
 */
export function DrawingDialog({ mode, initialStrokes, busy, onSubmit, onCancel }: DrawingDialogProps) {
  const { t } = useTranslation();
  const paperSurface = useEditorSettingsStore((state) => state.paperSurface);
  const [history, setHistory] = useState(() => createHistory(initialStrokes));
  const [tool, setTool] = useState<Tool>("pen");
  const [color, setColor] = useState(() => {
    if (rememberedColor) {
      return rememberedColor;
    }

    // Ink that is visible on the page the drawing will sit on: the dark UI
    // shows light ink, unless the editor is set to the light paper surface.
    const darkPage = document.documentElement.classList.contains("dark") && !paperSurface;
    return darkPage ? LIGHT_INK : DARK_INK;
  });
  const [width, setWidth] = useState(rememberedWidth);
  const [liveStroke, setLiveStroke] = useState<DrawingStroke | null>(null);
  const [eraseDraft, setEraseDraft] = useState<DrawingStroke[] | null>(null);
  const [eraserHover, setEraserHover] = useState<DrawingPoint | null>(null);
  const surfaceRef = useRef<SVGSVGElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const gestureRef = useRef<Gesture | null>(null);

  const isDirty = history.present !== initialStrokes;
  const canSubmit = !busy && history.present.length > 0 && (mode === "insert" || isDirty);
  const visibleStrokes = eraseDraft ?? history.present;

  useEffect(() => {
    rememberedColor = color;
    rememberedWidth = width;
  }, [color, width]);

  // Focus moves into the dialog so the editor's keymap stops receiving keys.
  useEffect(() => {
    panelRef.current?.focus();
  }, []);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      const mod = event.ctrlKey || event.metaKey;
      const key = event.key.toLowerCase();

      if (mod && key === "z") {
        event.preventDefault();
        event.stopPropagation();
        setHistory((current) => (event.shiftKey ? redoHistory(current) : undoHistory(current)));
        return;
      }

      if (mod && key === "y") {
        event.preventDefault();
        event.stopPropagation();
        setHistory(redoHistory);
        return;
      }

      // Escape only closes a dialog that holds nothing new: a sketch is too
      // much work to lose to a key pressed out of habit.
      if (event.key === "Escape" && !isDirty && !busy) {
        event.preventDefault();
        event.stopPropagation();
        onCancel();
      }
    };

    window.addEventListener("keydown", handleKeyDown, true);
    return () => window.removeEventListener("keydown", handleKeyDown, true);
  }, [busy, isDirty, onCancel]);

  const toSurfacePoint = (event: { clientX: number; clientY: number }): DrawingPoint => {
    const rect = surfaceRef.current?.getBoundingClientRect();
    return { x: event.clientX - (rect?.left ?? 0), y: event.clientY - (rect?.top ?? 0) };
  };

  const handlePointerDown = (event: React.PointerEvent<SVGSVGElement>) => {
    // A second finger while drawing is ignored rather than starting a second
    // stroke; a right or middle click does nothing.
    if (busy || gestureRef.current || (event.pointerType === "mouse" && event.button !== 0)) {
      return;
    }

    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    const point = toSurfacePoint(event);
    // The eraser end of a stylus reports button 5.
    const erasing = tool === "eraser" || event.button === 5;

    if (erasing) {
      const strokes = eraseStrokesAt(history.present, point, ERASER_RADIUS);
      gestureRef.current = { kind: "eraser", pointerId: event.pointerId, strokes, last: point };
      setEraseDraft(strokes);
      return;
    }

    const usesPressure = event.pointerType === "pen";
    const stroke = createStroke(color, width, point);
    gestureRef.current = {
      kind: "pen",
      pointerId: event.pointerId,
      stroke,
      pressures: usesPressure ? [event.pressure] : [],
      usesPressure
    };
    setLiveStroke(usesPressure ? { ...stroke, width: pressureWidth(width, [event.pressure]) } : stroke);
  };

  const handlePointerMove = (event: React.PointerEvent<SVGSVGElement>) => {
    const gesture = gestureRef.current;

    if (tool === "eraser" && event.pointerType !== "touch") {
      setEraserHover(toSurfacePoint(event));
    }

    if (!gesture || gesture.pointerId !== event.pointerId) {
      return;
    }

    // Coalesced events carry the positions the browser merged into this one
    // frame; without them a fast line turns into a polygon.
    const coalesced = event.nativeEvent.getCoalescedEvents?.() ?? [];
    const samples = coalesced.length > 0 ? coalesced : [event.nativeEvent];

    if (gesture.kind === "pen") {
      for (const sample of samples) {
        gesture.stroke = appendPoint(gesture.stroke, toSurfacePoint(sample));

        if (gesture.usesPressure) {
          gesture.pressures.push(sample.pressure);
        }
      }

      setLiveStroke({
        ...gesture.stroke,
        width: gesture.usesPressure ? pressureWidth(width, gesture.pressures) : gesture.stroke.width
      });
      return;
    }

    // The eraser checks the way between two events too, in steps smaller
    // than its radius, so a quick swipe cannot jump over a thin line.
    for (const sample of samples) {
      const point = toSurfacePoint(sample);
      const distance = Math.hypot(point.x - gesture.last.x, point.y - gesture.last.y);
      const steps = Math.max(1, Math.ceil(distance / ERASER_RADIUS));

      for (let step = 1; step <= steps; step += 1) {
        const ratio = step / steps;
        gesture.strokes = eraseStrokesAt(
          gesture.strokes,
          {
            x: gesture.last.x + (point.x - gesture.last.x) * ratio,
            y: gesture.last.y + (point.y - gesture.last.y) * ratio
          },
          ERASER_RADIUS
        );
      }

      gesture.last = point;
    }

    setEraseDraft(gesture.strokes);
  };

  const finishGesture = (event: React.PointerEvent<SVGSVGElement>, cancelled: boolean) => {
    const gesture = gestureRef.current;

    if (!gesture || gesture.pointerId !== event.pointerId) {
      return;
    }

    gestureRef.current = null;

    if (!cancelled) {
      if (gesture.kind === "pen") {
        const stroke = gesture.usesPressure
          ? { ...gesture.stroke, width: pressureWidth(width, gesture.pressures) }
          : gesture.stroke;
        setHistory((current) => commitHistory(current, [...current.present, stroke]));
      } else {
        setHistory((current) => commitHistory(current, gesture.strokes));
      }
    }

    setLiveStroke(null);
    setEraseDraft(null);
  };

  const selectColor = (next: string) => {
    if (HEX_COLOR_PATTERN.test(next)) {
      setColor(next.toLowerCase());
      setTool("pen");
    }
  };

  const title = t(mode === "edit" ? "drawing.titleEdit" : "drawing.title");

  return (
    <div className="drawing-dialog" role="presentation">
      <div
        ref={panelRef}
        className="drawing-dialog__panel"
        role="dialog"
        aria-modal="true"
        aria-label={title}
        tabIndex={-1}
      >
        <div className="drawing-dialog__toolbar">
          <h3 className="drawing-dialog__title">{title}</h3>

          <div className="drawing-dialog__group" role="group" aria-label={t("drawing.toolLabel")}>
            <Button
              type="button"
              size="icon-sm"
              variant={tool === "pen" ? "default" : "outline"}
              aria-pressed={tool === "pen"}
              aria-label={t("drawing.pen")}
              title={t("drawing.pen")}
              onClick={() => setTool("pen")}
            >
              <Pencil />
            </Button>
            <Button
              type="button"
              size="icon-sm"
              variant={tool === "eraser" ? "default" : "outline"}
              aria-pressed={tool === "eraser"}
              aria-label={t("drawing.eraser")}
              title={t("drawing.eraserTitle")}
              onClick={() => setTool("eraser")}
            >
              <Eraser />
            </Button>
          </div>

          <div className="drawing-dialog__group" role="group" aria-label={t("drawing.widthLabel")}>
            {PEN_WIDTHS.map((penWidth) => (
              <button
                key={penWidth}
                type="button"
                className="drawing-dialog__width"
                aria-pressed={width === penWidth}
                aria-label={t("drawing.widthOption", { width: penWidth })}
                title={t("drawing.widthOption", { width: penWidth })}
                onClick={() => {
                  setWidth(penWidth);
                  setTool("pen");
                }}
              >
                <span
                  className="drawing-dialog__width-dot"
                  style={{ width: Math.min(penWidth, 14) + 2, height: Math.min(penWidth, 14) + 2 }}
                />
              </button>
            ))}
          </div>

          <div className="drawing-dialog__group" role="group" aria-label={t("drawing.colorLabel")}>
            {PEN_COLORS.map((penColor) => (
              <button
                key={penColor}
                type="button"
                className="drawing-dialog__swatch"
                style={{ background: penColor }}
                aria-pressed={color === penColor}
                aria-label={penColor}
                title={penColor}
                onClick={() => selectColor(penColor)}
              />
            ))}
            <input
              type="color"
              className="drawing-dialog__color-input"
              value={color}
              aria-label={t("drawing.customColor")}
              title={t("drawing.customColor")}
              onChange={(event) => selectColor(event.target.value)}
            />
          </div>

          <div className="drawing-dialog__group">
            <Button
              type="button"
              size="icon-sm"
              variant="outline"
              aria-label={t("drawing.undo")}
              title={`${t("drawing.undo")} (${t("common.keys.ctrl")}+Z)`}
              disabled={busy || history.past.length === 0}
              onClick={() => setHistory(undoHistory)}
            >
              <Undo2 />
            </Button>
            <Button
              type="button"
              size="icon-sm"
              variant="outline"
              aria-label={t("drawing.redo")}
              title={`${t("drawing.redo")} (${t("common.keys.ctrl")}+Y)`}
              disabled={busy || history.future.length === 0}
              onClick={() => setHistory(redoHistory)}
            >
              <Redo2 />
            </Button>
            <Button
              type="button"
              size="icon-sm"
              variant="outline"
              aria-label={t("drawing.clear")}
              title={t("drawing.clear")}
              disabled={busy || history.present.length === 0}
              onClick={() => setHistory((current) => commitHistory(current, []))}
            >
              <Trash2 />
            </Button>
          </div>
        </div>

        <svg
          ref={surfaceRef}
          className={cn(
            "drawing-dialog__surface",
            tool === "eraser" && "drawing-dialog__surface--eraser",
            paperSurface && "paper-palette"
          )}
          role="img"
          aria-label={t("drawing.surfaceLabel")}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={(event) => finishGesture(event, false)}
          onPointerCancel={(event) => finishGesture(event, true)}
          onPointerLeave={() => setEraserHover(null)}
        >
          {[...visibleStrokes, ...(liveStroke ? [liveStroke] : [])].map((stroke, index) => (
            <path
              key={index}
              d={strokePathData(stroke.points)}
              fill="none"
              stroke={stroke.color}
              strokeWidth={stroke.width}
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          ))}
          {tool === "eraser" && eraserHover ? (
            <circle
              className="drawing-dialog__eraser-ring"
              cx={eraserHover.x}
              cy={eraserHover.y}
              r={ERASER_RADIUS}
            />
          ) : null}
        </svg>

        <div className="drawing-dialog__footer">
          <p className="drawing-dialog__hint">
            {t(mode === "edit" ? "drawing.hintEdit" : "drawing.hint")}
          </p>
          <div className="drawing-dialog__actions">
            <Button type="button" variant="outline" disabled={busy} onClick={onCancel}>
              {t("common.cancel")}
            </Button>
            <Button type="button" disabled={!canSubmit} onClick={() => onSubmit(history.present)}>
              {t(mode === "edit" ? "drawing.apply" : "drawing.insert")}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
