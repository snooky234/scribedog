import { useEffect, type RefObject } from "react";

/**
 * Whether a scroll event should close a popover. The listener runs in the
 * capture phase on window, so it also sees the popover's own content
 * scrolling (a long menu, the version list, a phone sheet); only scrolling
 * outside the popover closes it.
 */
export function isScrollOutside(target: EventTarget | null, container: HTMLElement | null): boolean {
  return !(container && target instanceof Node && container.contains(target));
}

// Closes a button-opened popover (grid picker, context menu, ...) on
// click/right-click outside, on scroll, or with Escape.
//
// The scroll listener runs in the capture phase so it sees scrolling of any
// ancestor, but that also catches the popover's own content scrolling, since
// capture-phase listeners on window see every scroll event regardless of
// bubbling. containerRef names the popover element, so a scroll inside it
// keeps it open: on a phone the popovers become sheets with a height limit,
// and a sheet that closed on the first swipe could never be scrolled.
export function useDismissablePopover(
  active: boolean,
  onDismiss: () => void,
  containerRef?: RefObject<HTMLElement | null>
) {
  useEffect(() => {
    if (!active) {
      return;
    }

    const dismiss = () => onDismiss();

    const dismissOnScroll = (event: Event) => {
      if (isScrollOutside(event.target, containerRef?.current ?? null)) {
        dismiss();
      }
    };

    window.addEventListener("click", dismiss);
    // Capture phase: must run before a new right-click on a target (bubble
    // phase) opens a fresh menu, otherwise this handler would immediately
    // close the new one again.
    window.addEventListener("contextmenu", dismiss, true);
    window.addEventListener("scroll", dismissOnScroll, true);

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        dismiss();
      }
    };

    window.addEventListener("keydown", handleKeyDown);

    return () => {
      window.removeEventListener("click", dismiss);
      window.removeEventListener("contextmenu", dismiss, true);
      window.removeEventListener("scroll", dismissOnScroll, true);
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [active, onDismiss, containerRef]);
}
