import { useCallback, useEffect, useRef, useState } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";

type UseZenModeOptions = {
  // Guards entering Zen mode (e.g. only when a document is open). Leaving is
  // always allowed.
  canEnter: () => boolean;
};

type UseZenModeResult = {
  isZenMode: boolean;
  enterZenMode: () => void;
  exitZenMode: () => void;
};

export function useZenMode({ canEnter }: UseZenModeOptions): UseZenModeResult {
  const [isZenMode, setIsZenMode] = useState(false);

  // Refs mirror the latest values so the capture-phase key handler stays
  // stable while still seeing current state.
  const isZenModeRef = useRef(isZenMode);
  isZenModeRef.current = isZenMode;
  const canEnterRef = useRef(canEnter);
  canEnterRef.current = canEnter;

  // Remembers whether the window was already full screen before entering, so
  // leaving Zen mode restores the previous state rather than always exiting
  // full screen.
  const wasFullscreenRef = useRef(false);

  const enterZenMode = useCallback(() => {
    if (isZenModeRef.current || !canEnterRef.current()) {
      return;
    }

    setIsZenMode(true);

    void (async () => {
      try {
        const appWindow = getCurrentWindow();
        wasFullscreenRef.current = await appWindow.isFullscreen();

        if (!wasFullscreenRef.current) {
          await appWindow.setFullscreen(true);
        }
      } catch {
        // Outside the Tauri shell (plain `npm run dev`) the native window API
        // is unavailable; Zen mode still works, just without full screen.
        wasFullscreenRef.current = false;
      }
    })();
  }, []);

  const exitZenMode = useCallback(() => {
    if (!isZenModeRef.current) {
      return;
    }

    setIsZenMode(false);

    void (async () => {
      try {
        if (!wasFullscreenRef.current) {
          await getCurrentWindow().setFullscreen(false);
        }
      } catch {
        // Nothing to restore outside the Tauri shell.
      }
    })();
  }, []);

  // Ctrl+Shift+Z toggles Zen mode. Registered in the capture phase so it wins
  // over the editor's redo binding (Ctrl+Shift+Z) and repurposes that combo.
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (
        (event.ctrlKey || event.metaKey) &&
        event.shiftKey &&
        !event.altKey &&
        (event.key.toLowerCase() === "z" || event.code === "KeyZ")
      ) {
        event.preventDefault();
        event.stopPropagation();

        if (isZenModeRef.current) {
          exitZenMode();
        } else {
          enterZenMode();
        }
      }
    };

    window.addEventListener("keydown", handleKeyDown, { capture: true });

    return () => window.removeEventListener("keydown", handleKeyDown, { capture: true });
  }, [enterZenMode, exitZenMode]);

  return { isZenMode, enterZenMode, exitZenMode };
}
