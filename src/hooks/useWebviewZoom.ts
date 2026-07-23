import { useEffect } from "react";
import { getCurrentWebview } from "@tauri-apps/api/webview";

import { useEditorSettingsStore } from "@/store/useEditorSettingsStore";

export function useWebviewZoom(): void {
  const zoomLevel = useEditorSettingsStore((state) => state.zoomLevel);

  useEffect(() => {
    // Native webview zoom behaves like browser zoom: the layout reflows and
    // viewport units adapt, unlike CSS zoom on the body (which leaves 100vh
    // at its unscaled size and produces empty space when zooming out).
    void getCurrentWebview()
      .setZoom(1 + zoomLevel / 100)
      .catch(() => {
        // Outside the Tauri shell (plain `npm run dev`) fall back to CSS zoom.
        document.body.style.setProperty("zoom", String(1 + zoomLevel / 100));
      });
  }, [zoomLevel]);
}
