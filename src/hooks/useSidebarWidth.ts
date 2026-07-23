import { useState } from "react";
import type { KeyboardEvent as ReactKeyboardEvent, PointerEvent as ReactPointerEvent } from "react";

const SIDEBAR_WIDTH_STORAGE_KEY = "scribedog-sidebar-width";
const MIN_SIDEBAR_WIDTH = 220;
const MAX_SIDEBAR_WIDTH = 560;
const DEFAULT_SIDEBAR_WIDTH = 320;
const SIDEBAR_KEYBOARD_STEP = 16;

export const SIDEBAR_MIN_WIDTH = MIN_SIDEBAR_WIDTH;
export const SIDEBAR_MAX_WIDTH = MAX_SIDEBAR_WIDTH;

function clampSidebarWidth(width: number): number {
  return Math.min(MAX_SIDEBAR_WIDTH, Math.max(MIN_SIDEBAR_WIDTH, width));
}

function getInitialSidebarWidth(): number {
  try {
    const stored = window.localStorage.getItem(SIDEBAR_WIDTH_STORAGE_KEY);
    const parsed = stored ? Number(stored) : NaN;

    if (!Number.isNaN(parsed)) {
      return clampSidebarWidth(parsed);
    }
  } catch {
    // localStorage may be unavailable in some environments.
  }

  return DEFAULT_SIDEBAR_WIDTH;
}

function persistSidebarWidth(width: number): void {
  try {
    window.localStorage.setItem(SIDEBAR_WIDTH_STORAGE_KEY, String(width));
  } catch {
    // localStorage may be unavailable in some environments.
  }
}

export function useSidebarWidth() {
  const [sidebarWidth, setSidebarWidth] = useState<number>(getInitialSidebarWidth);
  const [isResizingSidebar, setIsResizingSidebar] = useState(false);

  const handleResizeStart = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) {
      return;
    }

    event.preventDefault();
    const startX = event.clientX;
    const startWidth = sidebarWidth;
    setIsResizingSidebar(true);
    document.body.classList.add("is-resizing-sidebar");

    const handlePointerMove = (moveEvent: PointerEvent) => {
      setSidebarWidth(clampSidebarWidth(startWidth + (moveEvent.clientX - startX)));
    };

    const stopResizing = () => {
      setIsResizingSidebar(false);
      document.body.classList.remove("is-resizing-sidebar");
      setSidebarWidth((currentWidth) => {
        persistSidebarWidth(currentWidth);
        return currentWidth;
      });
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", stopResizing);
    };

    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", stopResizing);
  };

  const handleResizeKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (event.key === "ArrowLeft") {
      event.preventDefault();
      setSidebarWidth((currentWidth) => {
        const nextWidth = clampSidebarWidth(currentWidth - SIDEBAR_KEYBOARD_STEP);
        persistSidebarWidth(nextWidth);
        return nextWidth;
      });
    } else if (event.key === "ArrowRight") {
      event.preventDefault();
      setSidebarWidth((currentWidth) => {
        const nextWidth = clampSidebarWidth(currentWidth + SIDEBAR_KEYBOARD_STEP);
        persistSidebarWidth(nextWidth);
        return nextWidth;
      });
    }
  };

  return {
    sidebarWidth,
    isResizingSidebar,
    handleResizeStart,
    handleResizeKeyDown
  };
}
