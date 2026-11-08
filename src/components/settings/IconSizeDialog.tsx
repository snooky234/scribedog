import { useEffect, useMemo, useState } from "react";
import { RotateCcw } from "lucide-react";
import { useTranslation } from "react-i18next";

import { Button } from "@/components/ui/button";
import { useDismissOnOverlayClick } from "@/hooks/useDismissOnOverlayClick";
import { disposeIconScalePreview, loadIconScalePreview } from "@/lib/customFonts";
import { clampIconScale, ICON_SCALE_MAX, ICON_SCALE_MIN, ICON_SCALE_STEP } from "@/lib/fontImport";
import type { CustomFontDefinition } from "@/lib/fonts";
import { useCustomFontsStore } from "@/store/useCustomFontsStore";

const PREVIEW_ICON_COUNT = 6;

/** A handful of glyphs spread over the font's ranges, so the preview is not six neighbours. */
function sampleIcons(font: CustomFontDefinition): string[] {
  const starts = font.iconRanges.map(([start]) => start);

  if (starts.length === 0) {
    return [];
  }

  const step = Math.max(1, Math.floor(starts.length / PREVIEW_ICON_COUNT));

  return starts
    .filter((_, index) => index % step === 0)
    .slice(0, PREVIEW_ICON_COUNT)
    .map((codepoint) => String.fromCodePoint(codepoint));
}

/**
 * The icon size of one imported font. The slider only drives a preview face
 * (customFonts.ts); nothing is stored until Save, so Cancel leaves the font
 * as it was. The preview sets letters, digits and icons side by side, because
 * the point of the setting is how an icon looks next to its text.
 */
export function IconSizeDialog({ font, onClose }: { font: CustomFontDefinition; onClose: () => void }) {
  const { t } = useTranslation();
  const setIconScale = useCustomFontsStore((state) => state.setIconScale);
  const [scale, setScale] = useState(font.iconScale);
  const [previewFamily, setPreviewFamily] = useState<string | null>(null);
  const [bytes, setBytes] = useState<Uint8Array | null>(null);
  const [saving, setSaving] = useState(false);
  const [failed, setFailed] = useState(false);
  const dismissProps = useDismissOnOverlayClick(saving ? null : onClose);
  const icons = useMemo(() => sampleIcons(font), [font]);
  const label = font.label ?? font.familyName;

  // The settings dialog closes itself on Escape through a window listener;
  // this one has to take the key first, like the other dialogs opened from it.
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") {
        return;
      }

      event.preventDefault();
      event.stopPropagation();

      if (!saving) {
        onClose();
      }
    };

    window.addEventListener("keydown", handleKeyDown, true);

    return () => window.removeEventListener("keydown", handleKeyDown, true);
  }, [onClose, saving]);

  // The file is read once; a multi-megabyte font is not fetched per slider step.
  useEffect(() => {
    let cancelled = false;

    font
      .readStyle("normal")
      .then((data) => {
        if (!cancelled) {
          setBytes(data);
        }
      })
      .catch(() => undefined);

    return () => {
      cancelled = true;
      disposeIconScalePreview();
    };
  }, [font]);

  // A short pause before the face is rebuilt keeps a drag of the slider smooth.
  useEffect(() => {
    if (!bytes) {
      return;
    }

    let cancelled = false;
    const timer = window.setTimeout(() => {
      loadIconScalePreview(bytes, scale)
        .then((family) => {
          if (!cancelled) {
            setPreviewFamily(family);
          }
        })
        .catch(() => undefined);
    }, 60);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [bytes, scale]);

  const save = async () => {
    setSaving(true);
    setFailed(false);

    try {
      await setIconScale(font.id, scale);
      onClose();
    } catch (error) {
      console.error("Failed to store the icon size:", error);
      setFailed(true);
      setSaving(false);
    }
  };

  const iconStyle = previewFamily ? { fontFamily: `"${previewFamily}"` } : undefined;

  return (
    <div className="unsaved-dialog" role="presentation" {...dismissProps}>
      <div
        className="unsaved-dialog__panel icon-size-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="icon-size-title"
        onClick={(event) => event.stopPropagation()}
      >
        <h3 id="icon-size-title">{t("settingsDialog.iconSizeTitle", { name: label })}</h3>
        <p className="icon-size-dialog__intro">{t("settingsDialog.iconSizeIntro")}</p>

        <div className="font-setting__size-label">
          <label htmlFor="icon-size-slider">{t("settingsDialog.iconSizeLabel")}</label>
          <span className="icon-size-dialog__value">
            <span className="font-setting__size-value">{Math.round(scale * 100)} %</span>
            {scale !== 1 ? (
              <button
                type="button"
                className="font-setting__view-reset"
                onClick={() => setScale(1)}
                aria-label={t("settingsDialog.iconSizeReset")}
                title={t("settingsDialog.iconSizeReset")}
              >
                <RotateCcw className="size-3.5" aria-hidden="true" />
              </button>
            ) : null}
          </span>
        </div>

        <input
          id="icon-size-slider"
          type="range"
          min={ICON_SCALE_MIN}
          max={ICON_SCALE_MAX}
          step={ICON_SCALE_STEP}
          value={scale}
          onChange={(event) => setScale(clampIconScale(Number.parseFloat(event.target.value)))}
        />

        <div className="icon-size-dialog__preview" aria-hidden="true">
          <p>
            {t("settingsDialog.iconSizePreviewText")} 0123
            {icons.map((icon, index) => (
              <span key={index} className="icon-size-dialog__icon" style={iconStyle}>
                {icon}
              </span>
            ))}
          </p>
          <p>
            {icons.slice(0, 3).map((icon, index) => (
              <span key={index} style={iconStyle}>
                {icon}
              </span>
            ))}{" "}
            ABC abc
          </p>
        </div>

        <p className="icon-size-dialog__hint">{t("settingsDialog.iconSizeHint")}</p>
        {failed ? (
          <p className="icon-size-dialog__error" role="alert">
            {t("settingsDialog.iconSizeFailed")}
          </p>
        ) : null}

        <div className="unsaved-dialog__actions">
          <Button type="button" variant="outline" onClick={onClose} disabled={saving}>
            {t("common.cancel")}
          </Button>
          <Button type="button" onClick={() => void save()} disabled={saving || scale === font.iconScale}>
            {t("common.save")}
          </Button>
        </div>
      </div>
    </div>
  );
}
