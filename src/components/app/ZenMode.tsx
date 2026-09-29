import { ArrowLeft } from "lucide-react";
import { useTranslation } from "react-i18next";

import { useFontZoom } from "@/hooks/useFontZoom";
import { cn } from "@/lib/utils";
import { useEditorSettingsStore } from "@/store/useEditorSettingsStore";

type ZenModeProps = {
  onExit: () => void;
  isDirty: boolean;
};

export function ZenMode({ onExit, isDirty }: ZenModeProps) {
  const { t } = useTranslation();
  const readoutSizePt = useFontZoom("zen", true);
  // The readout floats over the page; on the paper surface it takes the
  // page's palette (tokens.css).
  const paperSurface = useEditorSettingsStore((state) => state.paperSurface);

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

      {readoutSizePt !== null ? (
        <output className={cn("zen-font-readout", paperSurface && "paper-palette")} aria-live="polite">
          {t("settingsDialog.fontSizeValue", { size: readoutSizePt })}
        </output>
      ) : null}

      {isDirty ? (
        <span
          className="zen-dirty"
          title={t("fileTree.unsavedChanges")}
          aria-label={t("fileTree.unsavedChanges")}
        />
      ) : null}
    </>
  );
}
