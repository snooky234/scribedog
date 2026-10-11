import type { EditorView } from "@tiptap/pm/view";

// Shared by the pointer drags inside the editor (table grips, the long press
// on an image): near an edge of the scroll area the drag scrolls it.

// Distance from a scroll edge at which a drag starts scrolling, and the
// fastest step per frame.
const AUTOSCROLL_EDGE_PX = 40;
const AUTOSCROLL_MAX_STEP_PX = 14;

export function editorScrollContainer(view: EditorView): HTMLElement | null {
  return view.dom.closest<HTMLElement>(".editor-view__scroll");
}

// Scroll speed grows towards the edge; zero outside the edge zone.
export function edgeStep(position: number, start: number, end: number): number {
  if (position < start + AUTOSCROLL_EDGE_PX) {
    return -Math.ceil(((start + AUTOSCROLL_EDGE_PX - position) / AUTOSCROLL_EDGE_PX) * AUTOSCROLL_MAX_STEP_PX);
  }

  if (position > end - AUTOSCROLL_EDGE_PX) {
    return Math.ceil(((position - end + AUTOSCROLL_EDGE_PX) / AUTOSCROLL_EDGE_PX) * AUTOSCROLL_MAX_STEP_PX);
  }

  return 0;
}
