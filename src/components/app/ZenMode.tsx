import { ArrowLeft } from "lucide-react";
import { useTranslation } from "react-i18next";

import { useZenFontZoom } from "@/hooks/useZenFontZoom";

type ZenModeProps = {
  onExit: () => void;
  isDirty: boolean;
};

export function ZenMode({ onExit, isDirty }: ZenModeProps) {
  const { t } = useTranslation();
  const readoutSizePt = useZenFontZoom(true);

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
        <output className="zen-font-readout" aria-live="polite">
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
