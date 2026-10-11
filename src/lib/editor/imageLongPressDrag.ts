import type { EditorView } from "@tiptap/pm/view";

import { blockDropPosition, moveBlockNode } from "@/lib/editor/blockMove";
import { edgeStep, editorScrollContainer } from "@/lib/editor/dragAutoscroll";

// Moving an image with a finger: hold it, then drag it to where it should go.
// A mouse moves images through ProseMirror's own HTML5 drag and drop, which
// never starts on a touch screen (and the tap handler in ImageView keeps the
// compatibility mouse events away from it on purpose). A press is only a drag
// once it has stayed put for LONG_PRESS_MS: a finger that starts moving
// earlier is scrolling the note, and the browser keeps that scroll.
//
// Once the press has turned into a drag, the touchmove listener cancels the
// browser's scroll and the drag scrolls near the edges itself, like the table
// grips do. The drop lands where ProseMirror would put a native drop of the
// same node (blockMove.ts) and is one undo step. Being shorter than the
// browser's own long-press timeout, the press wins against the context menu,
// the image callout and the text selection a long press otherwise starts.

const LONG_PRESS_MS = 400;
// A finger is never perfectly still; more than this before the press is
// complete means the user is scrolling.
const LONG_PRESS_SLOP_PX = 8;
const GHOST_MAX_WIDTH_PX = 160;
// Space between the finger and the picture that follows it, so the finger
// does not cover it.
const GHOST_FINGER_GAP_PX = 24;
// Distance of the insertion line from a block edge when there is no
// neighbour on the other side to put it halfway to.
const INDICATOR_EDGE_GAP_PX = 4;

type Point = { x: number; y: number };

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function elementRect(view: EditorView, pos: number): DOMRect | null {
  const dom = view.nodeDOM(pos);
  return dom instanceof HTMLElement ? dom.getBoundingClientRect() : null;
}

/**
 * Starts watching a touch (or pen) press on an image. Returns a function that
 * drops the gesture without moving anything; calling it after the gesture has
 * ended does nothing.
 */
export function startImageLongPress(
  view: EditorView,
  event: PointerEvent,
  getPos: () => number | undefined,
  wrapper: HTMLElement,
  image: HTMLImageElement | null
): () => void {
  const pointerId = event.pointerId;
  const start: Point = { x: event.clientX, y: event.clientY };
  let last = start;
  let dragging = false;
  let finished = false;
  let drop: number | null = null;
  let frame = 0;
  let ghost: HTMLImageElement | null = null;
  let ghostSize = { width: 0, height: 0 };
  let indicator: HTMLElement | null = null;

  const placeGhost = () => {
    if (ghost) {
      const left = last.x - ghostSize.width / 2;
      const top = last.y - ghostSize.height - GHOST_FINGER_GAP_PX;
      ghost.style.transform = `translate(${left}px, ${top}px)`;
    }
  };

  // Works out where the image would land under `point` and draws the
  // insertion line there. Null when it would stay where it is.
  const showDrop = (point: Point): number | null => {
    const from = getPos();
    const surface = view.dom.getBoundingClientRect();
    // Outside the text column (the page margin, the toolbar) still means the
    // nearest place in the note, not no drop at all.
    const hit = view.posAtCoords({
      left: clamp(point.x, surface.left + 1, surface.right - 1),
      top: clamp(point.y, surface.top + 1, surface.bottom - 1)
    });
    const target = from === undefined || !hit ? null : blockDropPosition(view.state.doc, from, hit.pos);

    if (!indicator) {
      return target;
    }

    if (target === null) {
      indicator.hidden = true;
      return null;
    }

    const $target = view.state.doc.resolve(target);
    const after = $target.nodeAfter ? elementRect(view, target) : null;
    const before = $target.nodeBefore ? elementRect(view, target - $target.nodeBefore.nodeSize) : null;
    const y =
      before && after
        ? (before.bottom + after.top) / 2
        : after
          ? after.top - INDICATOR_EDGE_GAP_PX
          : before
            ? before.bottom + INDICATOR_EDGE_GAP_PX
            : null;
    // The line spans the container the image would land in: the text column
    // at the top level, a list item or a quote further in.
    const container = $target.depth === 0 ? view.dom : view.nodeDOM($target.before());

    if (y === null || !(container instanceof HTMLElement)) {
      indicator.hidden = true;
      return target;
    }

    const box = container.getBoundingClientRect();
    const style = getComputedStyle(container);
    const left = box.left + (Number.parseFloat(style.paddingLeft) || 0);
    const right = box.right - (Number.parseFloat(style.paddingRight) || 0);

    indicator.hidden = false;
    indicator.style.transform = `translate(${left}px, ${y}px)`;
    indicator.style.width = `${Math.max(0, right - left)}px`;
    return target;
  };

  const tick = () => {
    const scroller = editorScrollContainer(view);

    if (scroller) {
      const rect = scroller.getBoundingClientRect();
      scroller.scrollTop += edgeStep(last.y, rect.top, rect.bottom);
    }

    drop = showDrop(last);
    frame = requestAnimationFrame(tick);
  };

  const begin = () => {
    if (getPos() === undefined || !view.editable) {
      finish(false);
      return;
    }

    dragging = true;
    wrapper.dataset.dragging = "";

    if (typeof navigator.vibrate === "function") {
      navigator.vibrate(10);
    }

    if (image) {
      const rect = image.getBoundingClientRect();
      const scale = rect.width > GHOST_MAX_WIDTH_PX ? GHOST_MAX_WIDTH_PX / rect.width : 1;
      ghostSize = { width: rect.width * scale, height: rect.height * scale };
      ghost = image.cloneNode() as HTMLImageElement;
      ghost.removeAttribute("style");
      ghost.removeAttribute("title");
      ghost.className = "image-drag-ghost";
      ghost.alt = "";
      ghost.setAttribute("aria-hidden", "true");
      ghost.style.width = `${ghostSize.width}px`;
      ghost.style.height = `${ghostSize.height}px`;
      document.body.append(ghost);
      placeGhost();
    }

    indicator = document.createElement("div");
    indicator.className = "image-drag-indicator";
    indicator.hidden = true;
    document.body.append(indicator);

    frame = requestAnimationFrame(tick);
  };

  const timer = window.setTimeout(begin, LONG_PRESS_MS);

  const onPointerMove = (moveEvent: PointerEvent) => {
    if (moveEvent.pointerId !== pointerId) {
      return;
    }

    last = { x: moveEvent.clientX, y: moveEvent.clientY };

    if (dragging) {
      placeGhost();
    } else if (Math.hypot(last.x - start.x, last.y - start.y) > LONG_PRESS_SLOP_PX) {
      finish(false);
    }
  };

  const onPointerUp = (upEvent: PointerEvent) => {
    if (upEvent.pointerId !== pointerId) {
      return;
    }

    // The drop under the finger where it was lifted, not where the last
    // animation frame saw it.
    if (dragging) {
      last = { x: upEvent.clientX, y: upEvent.clientY };
      drop = showDrop(last);
    }

    finish(true);
  };

  const onPointerCancel = (cancelEvent: PointerEvent) => {
    if (cancelEvent.pointerId === pointerId) {
      finish(false);
    }
  };

  // Only a drag holds the page still; before that the touch may scroll.
  const onTouchMove = (touchEvent: TouchEvent) => {
    if (dragging && touchEvent.cancelable) {
      touchEvent.preventDefault();
    }
  };

  // What a long press does by itself: the context menu, a native drag of the
  // picture, a text selection starting in the editor.
  const suppress = (nativeEvent: Event) => {
    nativeEvent.preventDefault();
  };

  // The sidebar swipe (useSidebarSwipe) reads the touch's start and end on
  // the window; a sideways drag of an image must not open the file list. A
  // capturing listener on the window runs before that one and ends the
  // event there. It stays for the touchend that follows the pointerup, and a
  // new touch removes it in case that touchend never reaches the window.
  const swallowTouchEnd = (touchEvent: TouchEvent) => {
    touchEvent.stopPropagation();
    removeTouchEndSwallow();
  };

  const removeTouchEndSwallow = () => {
    window.removeEventListener("touchend", swallowTouchEnd, true);
    window.removeEventListener("touchcancel", removeTouchEndSwallow, true);
    window.removeEventListener("touchstart", removeTouchEndSwallow, true);
  };

  const finish = (commit: boolean) => {
    if (finished) {
      return;
    }

    finished = true;
    window.clearTimeout(timer);
    cancelAnimationFrame(frame);
    window.removeEventListener("pointermove", onPointerMove);
    window.removeEventListener("pointerup", onPointerUp);
    window.removeEventListener("pointercancel", onPointerCancel);
    window.removeEventListener("touchmove", onTouchMove);
    window.removeEventListener("contextmenu", suppress, true);
    window.removeEventListener("dragstart", suppress, true);
    window.removeEventListener("selectstart", suppress, true);
    ghost?.remove();
    indicator?.remove();
    delete wrapper.dataset.dragging;

    if (dragging) {
      window.addEventListener("touchend", swallowTouchEnd, true);
      window.addEventListener("touchcancel", removeTouchEndSwallow, true);
      window.addEventListener("touchstart", removeTouchEndSwallow, true);
    }

    const from = getPos();

    if (!commit || !dragging || drop === null || from === undefined) {
      return;
    }

    const tr = moveBlockNode(view.state, from, drop);

    if (tr) {
      view.dispatch(tr);
    }
  };

  window.addEventListener("pointermove", onPointerMove);
  window.addEventListener("pointerup", onPointerUp);
  window.addEventListener("pointercancel", onPointerCancel);
  window.addEventListener("touchmove", onTouchMove, { passive: false });
  window.addEventListener("contextmenu", suppress, true);
  window.addEventListener("dragstart", suppress, true);
  window.addEventListener("selectstart", suppress, true);

  return () => finish(false);
}
