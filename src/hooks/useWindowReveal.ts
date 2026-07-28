import { useEffect } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";

/** The window is created hidden (`visible: false` in tauri.conf.json) so the
 *  light default webview background never flashes before the themed UI is
 *  there. Reveal it once React has committed and the browser has painted that
 *  first frame. A Rust-side timeout shows it anyway if this never runs. */
export function useWindowReveal(): void {
  useEffect(() => {
    let cancelled = false;

    const frame = requestAnimationFrame(() => {
      if (cancelled) {
        return;
      }

      void (async () => {
        try {
          const window = getCurrentWindow();
          await window.show();
          await window.setFocus();
        } catch {
          // Outside the Tauri shell (plain `npm run dev`) there is no window.
        }
      })();
    });

    return () => {
      cancelled = true;
      cancelAnimationFrame(frame);
    };
  }, []);
}
