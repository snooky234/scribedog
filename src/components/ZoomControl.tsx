import { useRef, useState } from "react";
import { createPortal } from "react-dom";

import { Minus, Plus, ZoomIn } from "lucide-react";
import { useTranslation } from "react-i18next";

import { Button } from "@/components/ui/button";
import { useDismissablePopover } from "@/lib/useDismissablePopover";
import { usePopoverOverflowAlign } from "@/lib/usePopoverOverflowAlign";
import {
  ZOOM_MAX,
  ZOOM_MIN,
  ZOOM_STEP,
  useEditorSettingsStore
} from "@/store/useEditorSettingsStore";

export function formatZoomLevel(level: number): string {
  return `${level > 0 ? "+" : ""}${level} %`;
}

export function ZoomControl() {
  const { t } = useTranslation();
  const zoomLevel = useEditorSettingsStore((state) => state.zoomLevel);
  const setZoomLevel = useEditorSettingsStore((state) => state.setZoomLevel);
  const [anchor, setAnchor] = useState<{ top: number; left: number; right: number } | null>(null);
  const [align, setAlign] = useState<"left" | "right">("left");
  const popoverRef = useRef<HTMLDivElement>(null);

  const isOpen = anchor !== null;

  const close = () => {
    setAnchor(null);
  };

  useDismissablePopover(isOpen, close);
  usePopoverOverflowAlign(anchor, popoverRef, setAlign);

  return (
    <>
      <Button
        type="button"
        size="icon-sm"
        variant="outline"
        aria-label={t("zoomControl.button")}
        aria-expanded={isOpen}
        title={t("zoomControl.buttonTitle")}
        onMouseDown={(event) => {
          event.preventDefault();
        }}
        onClick={(event) => {
          // Prevents the same click that opens the popover from immediately
          // reaching the window listener in useDismissablePopover and
          // closing it again (self-dismiss).
          event.stopPropagation();

          if (isOpen) {
            close();
            return;
          }

          const rect = event.currentTarget.getBoundingClientRect();
          setAlign("left");
          setAnchor({ top: rect.bottom + 6, left: rect.left, right: window.innerWidth - rect.right });
        }}
      >
        <ZoomIn />
      </Button>

      {anchor
        ? createPortal(
            <div
              ref={popoverRef}
              className="editor-popover zoom-control"
              role="group"
              aria-label={t("zoomControl.button")}
              style={align === "right" ? { top: anchor.top, right: anchor.right } : { top: anchor.top, left: anchor.left }}
              onClick={(event) => event.stopPropagation()}
            >
              <Button
                type="button"
                size="icon-sm"
                variant="outline"
                aria-label={t("zoomControl.zoomOut")}
                title={t("zoomControl.zoomOut")}
                disabled={zoomLevel <= ZOOM_MIN}
                onClick={() => setZoomLevel(zoomLevel - ZOOM_STEP)}
              >
                <Minus />
              </Button>
              <button
                type="button"
                className="zoom-control__value"
                aria-label={t("zoomControl.reset")}
                title={t("zoomControl.reset")}
                onClick={() => setZoomLevel(0)}
              >
                {formatZoomLevel(zoomLevel)}
              </button>
              <Button
                type="button"
                size="icon-sm"
                variant="outline"
                aria-label={t("zoomControl.zoomIn")}
                title={t("zoomControl.zoomIn")}
                disabled={zoomLevel >= ZOOM_MAX}
                onClick={() => setZoomLevel(zoomLevel + ZOOM_STEP)}
              >
                <Plus />
              </Button>
            </div>,
            document.body
          )
        : null}
    </>
  );
}
