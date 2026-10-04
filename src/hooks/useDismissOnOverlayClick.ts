import { useRef } from "react";

/** Just enough of a mouse event to decide whether it belongs to the backdrop. */
type OverlayEvent = { target: EventTarget | null; currentTarget: EventTarget | null };

/** The press and the release both have to land on the backdrop itself. */
export function isOverlayDismissClick(event: OverlayEvent, pressedOnOverlay: boolean): boolean {
  return pressedOnOverlay && event.target === event.currentTarget;
}

/**
 * Props for a dialog's backdrop that dismiss it on a click *outside* the panel.
 *
 * A plain `onClick` on the backdrop is not enough: a click fires wherever the
 * pointer is released, so dragging a text selection out of the panel and
 * letting go over the backdrop would dismiss the dialog and throw the input
 * away. The backdrop therefore only counts a click whose press *started* on it.
 *
 * A null handler leaves the backdrop inert, which is how a dialog that is busy
 * (saving, downloading, reverting) refuses to be dismissed.
 */
export function useDismissOnOverlayClick(onDismiss: (() => void) | null) {
  const pressedOnOverlay = useRef(false);

  return {
    onMouseDown: (event: React.MouseEvent) => {
      pressedOnOverlay.current = event.target === event.currentTarget;
    },
    onClick: (event: React.MouseEvent) => {
      const startedOnOverlay = pressedOnOverlay.current;
      pressedOnOverlay.current = false;
      if (isOverlayDismissClick(event, startedOnOverlay)) {
        onDismiss?.();
      }
    }
  };
}
