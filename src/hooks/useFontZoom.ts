import { useEffect, useState } from "react";

import {
  applyWheelZoom,
  distanceBetween,
  isZoomWheel,
  pinchedFontSizePt,
  type WheelZoomState
} from "@/lib/zenFontZoom";
import { useEditorSettingsStore } from "@/store/useEditorSettingsStore";

/** How long the size readout stays on screen after the last gesture. */
const READOUT_MS = 900;

/**
 * Reader-style text zoom: Ctrl+wheel (Cmd+wheel on a Mac) resizes the
 * document text and nothing else, and in Zen mode a two-finger pinch on a
 * touch screen does too. The gestures are claimed here so the webview does
 * not zoom the page instead, which is also why the touch listener is not
 * passive.
 *
 * `"zen"` writes `zenFontSizePt`, which only the Zen column reads. `"view"`
 * writes `viewFontSizePt` for the normal editor, only for a wheel over the
 * editor itself, and without the pinch: there it would fight scrolling and
 * selecting text on a tablet. Neither reaches the exports, which keep the
 * document size from the settings. Returns the size to show in a readout
 * while a gesture is in progress, `null` once it has faded.
 */
export function useFontZoom(mode: "zen" | "view", enabled: boolean): number | null {
  const [readoutSizePt, setReadoutSizePt] = useState<number | null>(null);

  useEffect(() => {
    if (!enabled) {
      return;
    }

    let readoutTimer: ReturnType<typeof setTimeout> | null = null;

    const currentSizePt = () => {
      const { zenFontSizePt, viewFontSizePt, fontSizePt } = useEditorSettingsStore.getState();
      return (mode === "zen" ? zenFontSizePt : viewFontSizePt) ?? fontSizePt;
    };

    const commit = (sizePt: number) => {
      const store = useEditorSettingsStore.getState();

      if (mode === "zen") {
        store.setZenFontSizePt(sizePt);
      } else {
        store.setViewFontSizePt(sizePt);
      }

      setReadoutSizePt(currentSizePt());

      if (readoutTimer !== null) {
        clearTimeout(readoutTimer);
      }

      readoutTimer = setTimeout(() => {
        setReadoutSizePt(null);
      }, READOUT_MS);
    };

    // The pinch is measured against its own start, not incrementally, so a
    // finger jitter does not drift the size.
    let pinchStart: { distance: number; sizePt: number } | null = null;

    const touchDistance = (touches: TouchList) =>
      distanceBetween(
        { x: touches[0].clientX, y: touches[0].clientY },
        { x: touches[1].clientX, y: touches[1].clientY }
      );

    const handleTouchStart = (event: TouchEvent) => {
      if (event.touches.length === 2) {
        pinchStart = { distance: touchDistance(event.touches), sizePt: currentSizePt() };
      } else {
        pinchStart = null;
      }
    };

    const handleTouchMove = (event: TouchEvent) => {
      if (!pinchStart || event.touches.length !== 2) {
        return;
      }

      event.preventDefault();
      commit(pinchedFontSizePt(pinchStart.sizePt, pinchStart.distance, touchDistance(event.touches)));
    };

    const handleTouchEnd = () => {
      pinchStart = null;
    };

    let wheel: WheelZoomState = { sizePt: currentSizePt(), carry: 0 };

    const handleWheel = (event: WheelEvent) => {
      if (!isZoomWheel(event)) {
        return;
      }

      // Over the sidebar, the chat or a dialog the wheel is not about the note.
      if (mode === "view" && !(event.target instanceof Element && event.target.closest(".editor-view__scroll"))) {
        return;
      }

      event.preventDefault();
      // Re-read the size in case a pinch or the settings changed it meanwhile.
      wheel = applyWheelZoom({ ...wheel, sizePt: currentSizePt() }, event.deltaY);
      commit(wheel.sizePt);
    };

    // Safari's own pinch event; preventing it is what keeps the page still.
    const preventGesture = (event: Event) => {
      event.preventDefault();
    };

    const pinch = mode === "zen";

    if (pinch) {
      document.addEventListener("touchstart", handleTouchStart, { passive: true });
      document.addEventListener("touchmove", handleTouchMove, { passive: false });
      document.addEventListener("touchend", handleTouchEnd);
      document.addEventListener("touchcancel", handleTouchEnd);
      document.addEventListener("gesturestart", preventGesture);
    }

    document.addEventListener("wheel", handleWheel, { passive: false });

    return () => {
      if (readoutTimer !== null) {
        clearTimeout(readoutTimer);
      }

      document.removeEventListener("touchstart", handleTouchStart);
      document.removeEventListener("touchmove", handleTouchMove);
      document.removeEventListener("touchend", handleTouchEnd);
      document.removeEventListener("touchcancel", handleTouchEnd);
      document.removeEventListener("wheel", handleWheel);
      document.removeEventListener("gesturestart", preventGesture);
      setReadoutSizePt(null);
    };
  }, [mode, enabled]);

  return readoutSizePt;
}
