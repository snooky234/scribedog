import { useState } from "react";
import type { KeyboardEvent as ReactKeyboardEvent, PointerEvent as ReactPointerEvent } from "react";

const CHAT_WIDTH_STORAGE_KEY = "scribedog-chat-width";
const MIN_CHAT_WIDTH = 300;
const MAX_CHAT_WIDTH = 640;
const DEFAULT_CHAT_WIDTH = 380;
const CHAT_KEYBOARD_STEP = 16;

export const CHAT_MIN_WIDTH = MIN_CHAT_WIDTH;
export const CHAT_MAX_WIDTH = MAX_CHAT_WIDTH;

function clampChatWidth(width: number): number {
  return Math.min(MAX_CHAT_WIDTH, Math.max(MIN_CHAT_WIDTH, width));
}

function getInitialChatWidth(): number {
  try {
    const stored = window.localStorage.getItem(CHAT_WIDTH_STORAGE_KEY);
    const parsed = stored ? Number(stored) : NaN;

    if (!Number.isNaN(parsed)) {
      return clampChatWidth(parsed);
    }
  } catch {
    // localStorage may be unavailable in some environments.
  }

  return DEFAULT_CHAT_WIDTH;
}

function persistChatWidth(width: number): void {
  try {
    window.localStorage.setItem(CHAT_WIDTH_STORAGE_KEY, String(width));
  } catch {
    // localStorage may be unavailable in some environments.
  }
}

// Mirrors useSidebarWidth, but the resizer sits on the chat panel's left
// edge rather than its right: dragging it left grows the panel (it eats into
// the editor's space), dragging it right shrinks it — the opposite sign from
// the sidebar's resizer, which sits on the sidebar's right edge.
export function useChatWidth() {
  const [chatWidth, setChatWidth] = useState<number>(getInitialChatWidth);
  const [isResizingChat, setIsResizingChat] = useState(false);

  const handleChatResizeStart = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) {
      return;
    }

    event.preventDefault();
    const startX = event.clientX;
    const startWidth = chatWidth;
    setIsResizingChat(true);
    document.body.classList.add("is-resizing-chat");

    const handlePointerMove = (moveEvent: PointerEvent) => {
      setChatWidth(clampChatWidth(startWidth - (moveEvent.clientX - startX)));
    };

    const stopResizing = () => {
      setIsResizingChat(false);
      document.body.classList.remove("is-resizing-chat");
      setChatWidth((currentWidth) => {
        persistChatWidth(currentWidth);
        return currentWidth;
      });
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", stopResizing);
    };

    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", stopResizing);
  };

  const handleChatResizeKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (event.key === "ArrowLeft") {
      event.preventDefault();
      setChatWidth((currentWidth) => {
        const nextWidth = clampChatWidth(currentWidth + CHAT_KEYBOARD_STEP);
        persistChatWidth(nextWidth);
        return nextWidth;
      });
    } else if (event.key === "ArrowRight") {
      event.preventDefault();
      setChatWidth((currentWidth) => {
        const nextWidth = clampChatWidth(currentWidth - CHAT_KEYBOARD_STEP);
        persistChatWidth(nextWidth);
        return nextWidth;
      });
    }
  };

  return {
    chatWidth,
    isResizingChat,
    handleChatResizeStart,
    handleChatResizeKeyDown
  };
}
