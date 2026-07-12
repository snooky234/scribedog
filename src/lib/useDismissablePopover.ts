import { useEffect } from "react";

// Closes a button-opened popover (grid picker, context menu, ...) on
// click/right-click outside, on scroll, or with Escape. Mirrors the context
// menu behavior in FileTree.tsx, but without being tied to mouse events.
export function useDismissablePopover(active: boolean, onDismiss: () => void) {
  useEffect(() => {
    if (!active) {
      return;
    }

    const dismiss = () => onDismiss();

    window.addEventListener("click", dismiss);
    window.addEventListener("contextmenu", dismiss, true);
    window.addEventListener("scroll", dismiss, true);

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        dismiss();
      }
    };

    window.addEventListener("keydown", handleKeyDown);

    return () => {
      window.removeEventListener("click", dismiss);
      window.removeEventListener("contextmenu", dismiss, true);
      window.removeEventListener("scroll", dismiss, true);
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [active, onDismiss]);
}
