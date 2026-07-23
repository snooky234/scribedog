import type { KeyboardEvent as ReactKeyboardEvent, PointerEvent as ReactPointerEvent } from "react";
import { ArrowLeft } from "lucide-react";
import { useTranslation } from "react-i18next";

import {
  ZEN_WIDTH_MAX,
  ZEN_WIDTH_MIN,
  ZEN_WIDTH_STEP,
  useEditorSettingsStore
} from "@/store/useEditorSettingsStore";

type ZenModeProps = {
  onExit: () => void;
  isDirty: boolean;
};

export function ZenMode({ onExit, isDirty }: ZenModeProps) {
  const { t } = useTranslation();
  const zenWidth = useEditorSettingsStore((state) => state.zenWidth);
  const setZenWidth = useEditorSettingsStore((state) => state.setZenWidth);

  // The text column is centred on the viewport, so its half-width equals the
  // pointer's distance from the horizontal centre — the same math for either
  // edge handle.
  const handleResizeStart = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) {
      return;
    }

    event.preventDefault();
    document.body.classList.add("is-resizing-zen");

    const handlePointerMove = (moveEvent: PointerEvent) => {
      const halfWidth = Math.abs(moveEvent.clientX - window.innerWidth / 2);
      setZenWidth(halfWidth * 2);
    };

    const stopResizing = () => {
      document.body.classList.remove("is-resizing-zen");
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", stopResizing);
    };

    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", stopResizing);
  };

  // Arrow keys nudge the column width. `direction` is +1 for the handle whose
  // "outward" key is ArrowRight (the right edge) and -1 for the left edge.
  const handleResizeKeyDown = (
    event: ReactKeyboardEvent<HTMLDivElement>,
    direction: 1 | -1
  ) => {
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") {
      return;
    }

    event.preventDefault();
    const sign = event.key === "ArrowRight" ? 1 : -1;
    setZenWidth(zenWidth + direction * sign * ZEN_WIDTH_STEP);
  };

  return (
    <>
      <button
        type="button"
        className="zen-exit"
        onClick={onExit}
        aria-label={t("zenMode.exitLabel")}
        title={t("zenMode.exitTooltip")}
      >
        <ArrowLeft className="size-5" />
      </button>

      {isDirty ? (
        <span
          className="zen-dirty"
          title={t("fileTree.unsavedChanges")}
          aria-label={t("fileTree.unsavedChanges")}
        />
      ) : null}

      <div
        className="zen-resizer zen-resizer--left"
        role="separator"
        aria-orientation="vertical"
        aria-label={t("zenMode.resizeLabel")}
        aria-valuenow={zenWidth}
        aria-valuemin={ZEN_WIDTH_MIN}
        aria-valuemax={ZEN_WIDTH_MAX}
        tabIndex={0}
        onPointerDown={handleResizeStart}
        onKeyDown={(event) => handleResizeKeyDown(event, -1)}
      >
        <span className="zen-resizer__grip" aria-hidden="true" />
      </div>

      <div
        className="zen-resizer zen-resizer--right"
        role="separator"
        aria-orientation="vertical"
        aria-label={t("zenMode.resizeLabel")}
        aria-valuenow={zenWidth}
        aria-valuemin={ZEN_WIDTH_MIN}
        aria-valuemax={ZEN_WIDTH_MAX}
        tabIndex={0}
        onPointerDown={handleResizeStart}
        onKeyDown={(event) => handleResizeKeyDown(event, 1)}
      >
        <span className="zen-resizer__grip" aria-hidden="true" />
      </div>
    </>
  );
}
