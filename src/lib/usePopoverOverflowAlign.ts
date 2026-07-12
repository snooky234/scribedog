import { useLayoutEffect, type RefObject } from "react";

// Flips a popover from left- to right-aligned relative to its anchor button
// if it would otherwise overflow the right edge of the viewport. Some
// popover contents (e.g. the emoji-mart custom element) only reach their
// final width asynchronously after mount, so a single measurement right
// after mount isn't enough — a ResizeObserver re-checks every time the
// popover's size settles. `anchor` is only used as an effect dependency to
// re-measure whenever the popover (re)opens at a new position.
export function usePopoverOverflowAlign(
  anchor: unknown,
  ref: RefObject<HTMLElement | null>,
  setAlign: (align: "left" | "right") => void
) {
  useLayoutEffect(() => {
    if (!anchor || !ref.current) {
      return;
    }

    const element = ref.current;

    const checkOverflow = () => {
      const rect = element.getBoundingClientRect();
      if (rect.right > window.innerWidth) {
        setAlign("right");
      }
    };

    checkOverflow();

    const observer = new ResizeObserver(checkOverflow);
    observer.observe(element);

    return () => observer.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [anchor]);
}
