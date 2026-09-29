import { useEffect, useRef } from "react";

import { isCloseRequestFromPrintPreview } from "@/lib/printSession";
import { platform } from "@/platform";
import { flushDrafts } from "@/store/appStore/drafts";

/**
 * Writes pending drafts (store/appStore/drafts.ts) the moment the window
 * stops being the one the user is looking at: focus lost, tab or window
 * hidden, page unloading. Those are the moments before a kill, a crash, a
 * shutdown, so a draft still waiting on its timer would be the one that is
 * lost. The debounce itself stays; this only shortens it when it matters.
 *
 * `pagehide` covers the browser edition's tab close. The desktop's close
 * button is a native event: the window is held until the flush has settled
 * and then destroyed, flush failed or not, because the app must always let
 * itself be closed. Nothing else is asked at that point; the drafts are what
 * make the question unnecessary. `onBeforeClose` runs first, for the save
 * that auto-save would have made a moment later. The one request dropped is
 * a click made while the print preview blocked the page (printSession.ts).
 */
export function useDraftFlush({ onBeforeClose }: { onBeforeClose?: () => Promise<void> } = {}): void {
  // The close handler is registered once; the ref keeps it on the latest
  // callback without re-registering on every render.
  const onBeforeCloseRef = useRef(onBeforeClose);
  onBeforeCloseRef.current = onBeforeClose;

  useEffect(() => {
    const flush = () => {
      void flushDrafts();
    };
    const onVisibilityChange = () => {
      if (document.visibilityState === "hidden") {
        flush();
      }
    };

    window.addEventListener("blur", flush);
    window.addEventListener("pagehide", flush);
    document.addEventListener("visibilitychange", onVisibilityChange);

    let removeCloseHandler: (() => void) | null = null;
    let disposed = false;

    void platform.window
      .onCloseRequested(async () => {
        // A click on the close button while the print preview was open,
        // delivered only now that it is closed (printSession.ts).
        if (isCloseRequestFromPrintPreview()) {
          return false;
        }

        await onBeforeCloseRef.current?.().catch(() => undefined);
        await flushDrafts();
      })
      .then((remove) => {
        if (disposed) {
          remove();
        } else {
          removeCloseHandler = remove;
        }
      })
      .catch(() => undefined);

    return () => {
      disposed = true;
      removeCloseHandler?.();
      window.removeEventListener("blur", flush);
      window.removeEventListener("pagehide", flush);
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, []);
}
