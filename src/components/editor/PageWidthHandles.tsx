import { useEffect, useRef, useState } from "react";
import type { KeyboardEvent as ReactKeyboardEvent, PointerEvent as ReactPointerEvent } from "react";
import type { Editor as TipTapEditor } from "@tiptap/react";
import { useTranslation } from "react-i18next";

import { PAGE_WIDTH_MIN_EM, draggedPageWidth, steppedPageWidth } from "@/lib/editor/pageWidth";
import { ZEN_WIDTH_MAX, ZEN_WIDTH_MIN, ZEN_WIDTH_STEP, useEditorSettingsStore } from "@/store/useEditorSettingsStore";

// Where the grips go, relative to the layer: the page's side edges, and
// the part of its height that is in view.
type Edges = { left: number; right: number; top: number; bottom: number };

// The page's edges inside the editor card, to pull it narrower and back
// (lib/editor/pageWidth.ts), like the Zen column's. Outside the
// contenteditable on purpose: nothing may be added to ProseMirror's own DOM.
// The page is centred in the card, so its half-width is the pointer's
// distance from the card's centre, the same for either edge.
//
// In Zen mode the same grips set the Zen column's width instead (in pixels,
// no docking). Measured like here, they sit on the column wherever the
// scrollbar puts its centre, which the window's centre is not.
export function PageWidthHandles({ editor, zen = false }: { editor: TipTapEditor | null; zen?: boolean }) {
  const { t } = useTranslation();
  const pageWidthEm = useEditorSettingsStore((state) => state.pageWidthEm);
  const setPageWidthEm = useEditorSettingsStore((state) => state.setPageWidthEm);
  const zenWidth = useEditorSettingsStore((state) => state.zenWidth);
  const setZenWidth = useEditorSettingsStore((state) => state.setZenWidth);
  const layerRef = useRef<HTMLDivElement>(null);
  const [edges, setEdges] = useState<Edges | null>(null);
  const [surface, setSurface] = useState<HTMLElement | null>(null);

  // Read once the editor is there, not while rendering: the view is only
  // mounted after the first render.
  useEffect(() => {
    setSurface(editor?.view.dom ?? null);
  }, [editor]);

  useEffect(() => {
    const layer = layerRef.current;

    if (!surface || !layer) {
      return;
    }

    const measure = () => {
      const box = layer.getBoundingClientRect();
      const page = surface.getBoundingClientRect();
      setEdges({
        left: page.left - box.left,
        right: page.right - box.left,
        top: Math.max(0, page.top - box.top),
        bottom: Math.max(0, box.bottom - page.bottom)
      });
    };
    // Scrolling moves the page's top and bottom in and out of view.
    let frame = 0;
    const measureOnScroll = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(measure);
    };

    const observer = new ResizeObserver(measure);
    observer.observe(layer);
    observer.observe(surface);

    if (surface.parentElement) {
      observer.observe(surface.parentElement);
    }

    document.addEventListener("scroll", measureOnScroll, true);
    measure();

    return () => {
      observer.disconnect();
      document.removeEventListener("scroll", measureOnScroll, true);
      cancelAnimationFrame(frame);
    };
  }, [surface]);

  // The card the page sits in, and the text size its width is kept in.
  const cardMetrics = () => {
    const card = surface?.parentElement?.getBoundingClientRect();
    const fontSizePx = surface ? Number.parseFloat(getComputedStyle(surface).fontSize) : 0;

    return card ? { card, fontSizePx } : null;
  };

  const handlePointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) {
      return;
    }

    event.preventDefault();
    document.body.classList.add("is-resizing-page");

    const handlePointerMove = (moveEvent: PointerEvent) => {
      const metrics = cardMetrics();

      if (!metrics) {
        return;
      }

      const center = metrics.card.left + metrics.card.width / 2;
      const width = Math.abs(moveEvent.clientX - center) * 2;

      if (zen) {
        setZenWidth(width);
      } else {
        setPageWidthEm(draggedPageWidth(width, metrics.card.width, metrics.fontSizePx));
      }
    };

    const stopResizing = () => {
      document.body.classList.remove("is-resizing-page");
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", stopResizing);
    };

    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", stopResizing);
  };

  // `outward` is the arrow key that widens the page from this edge.
  const handleKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>, outward: "ArrowLeft" | "ArrowRight") => {
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") {
      return;
    }

    const metrics = cardMetrics();

    if (!metrics) {
      return;
    }

    event.preventDefault();
    const direction = event.key === outward ? 1 : -1;

    if (zen) {
      setZenWidth(zenWidth + direction * ZEN_WIDTH_STEP);
    } else {
      setPageWidthEm(steppedPageWidth(pageWidthEm, direction, metrics.card.width, metrics.fontSizePx));
    }
  };

  const handle = (edge: "left" | "right") => (
    <div
      className={`page-width-handle page-width-handle--${edge}`}
      style={edges ? { left: edges[edge], top: edges.top, bottom: edges.bottom } : { display: "none" }}
      role="separator"
      aria-orientation="vertical"
      aria-label={zen ? t("zenMode.resizeLabel") : t("pageWidth.resizeLabel")}
      title={zen ? undefined : t("pageWidth.resizeTooltip")}
      aria-valuemin={zen ? ZEN_WIDTH_MIN : PAGE_WIDTH_MIN_EM}
      aria-valuemax={zen ? ZEN_WIDTH_MAX : undefined}
      aria-valuenow={zen ? zenWidth : (pageWidthEm ?? undefined)}
      tabIndex={0}
      onPointerDown={handlePointerDown}
      onDoubleClick={zen ? undefined : () => setPageWidthEm(null)}
      onKeyDown={(event) => handleKeyDown(event, edge === "left" ? "ArrowLeft" : "ArrowRight")}
    >
      <span className="page-width-handle__grip" aria-hidden="true" />
    </div>
  );

  return (
    <div ref={layerRef} className={zen ? "page-width-handles page-width-handles--zen" : "page-width-handles"}>
      {handle("left")}
      {handle("right")}
    </div>
  );
}
