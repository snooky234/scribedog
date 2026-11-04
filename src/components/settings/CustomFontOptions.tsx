import { useEffect, useRef, useState, type ReactNode } from "react";
import { Trash2, Upload } from "lucide-react";
import { useTranslation } from "react-i18next";

import { Button } from "@/components/ui/button";
import type { FontImportReport } from "@/lib/customFonts";
import { ensureFontStylesLoaded, type CustomFontId } from "@/lib/fonts";
import { fontIdForName } from "@/lib/fontImport";
import { useCustomFontsStore } from "@/store/useCustomFontsStore";
import { useEditorSettingsStore } from "@/store/useEditorSettingsStore";

/**
 * The grid of font cards and the import below it. The cards of the fonts the
 * user imported sit in the same grid as the bundled ones, behind them: a font
 * is a font, wherever it came from. Importing is its own row under the grid,
 * set apart, because a card among the cards is not seen as something to press.
 */
export function CustomFontOptions({ label, children }: { label: string; children: ReactNode }) {
  const { t } = useTranslation();
  const fontId = useEditorSettingsStore((state) => state.fontId);
  const setFontId = useEditorSettingsStore((state) => state.setFontId);
  const fonts = useCustomFontsStore((state) => state.fonts);
  const vaultPath = useCustomFontsStore((state) => state.vaultPath);
  const importFiles = useCustomFontsStore((state) => state.importFiles);
  const removeFont = useCustomFontsStore((state) => state.remove);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [confirmId, setConfirmId] = useState<CustomFontId | null>(null);
  const [report, setReport] = useState<FontImportReport | null>(null);
  const [failed, setFailed] = useState(false);
  const [busy, setBusy] = useState(false);

  // The cards show each option in its own face, like the bundled ones.
  useEffect(() => {
    fonts.forEach((font) => void ensureFontStylesLoaded(font.id));
  }, [fonts]);

  const importSelected = async (files: FileList | null) => {
    if (!files || files.length === 0) {
      return;
    }

    setBusy(true);
    setFailed(false);
    setReport(null);

    try {
      const inputs = await Promise.all(
        Array.from(files).map(async (file) => ({ name: file.name, bytes: new Uint8Array(await file.arrayBuffer()) }))
      );
      const result = await importFiles(inputs);

      setReport(result);

      // One family imported: the user wants to see it, so it is selected.
      if (result && result.imported.length === 1) {
        const id = fontIdForName(result.imported[0]);
        void ensureFontStylesLoaded(id);
        setFontId(id);
      }
    } catch (error) {
      console.error("Failed to import fonts:", error);
      setFailed(true);
    } finally {
      setBusy(false);

      if (fileInputRef.current) {
        fileInputRef.current.value = "";
      }
    }
  };

  const remove = async (id: CustomFontId) => {
    setConfirmId(null);
    setReport(null);

    try {
      await removeFont(id);

      if (fontId === id) {
        setFontId("system");
      }
    } catch (error) {
      console.error("Failed to remove font:", error);
      setFailed(true);
    }
  };

  return (
    <>
      <div className="font-setting__options" role="radiogroup" aria-label={label}>
      {children}
      {fonts.map((font) => {
        const label = font.label ?? font.familyName;

        if (confirmId === font.id) {
          return (
            <div key={font.id} className="font-setting__option font-setting__option--confirm" role="group" aria-label={label}>
              <span className="font-setting__name">{t("settingsDialog.fontRemoveConfirm", { name: label })}</span>
              <span className="font-setting__confirm-actions">
                <Button type="button" variant="outline" size="sm" onClick={() => setConfirmId(null)}>
                  {t("common.cancel")}
                </Button>
                <Button type="button" variant="destructive" size="sm" onClick={() => void remove(font.id)}>
                  {t("settingsDialog.fontRemove")}
                </Button>
              </span>
            </div>
          );
        }

        const isSelected = font.id === fontId;

        return (
          <div key={font.id} className="font-setting__custom">
            <button
              type="button"
              role="radio"
              aria-checked={isSelected}
              className="font-setting__option"
              data-selected={isSelected ? "true" : undefined}
              onClick={() => setFontId(font.id)}
            >
              <span className="font-setting__name">
                {label}
                {font.hasIcons ? <span className="font-setting__badge">{t("settingsDialog.fontHasIcons")}</span> : null}
              </span>
              <span className="font-setting__preview" style={{ fontFamily: font.cssStack }} aria-hidden="true">
                {t("settingsDialog.fontPreviewText")}
              </span>
            </button>
            <button
              type="button"
              className="font-setting__delete"
              onClick={() => setConfirmId(font.id)}
              aria-label={t("settingsDialog.fontRemoveLabel", { name: label })}
              title={t("settingsDialog.fontRemoveLabel", { name: label })}
            >
              <Trash2 className="size-3.5" aria-hidden="true" />
            </button>
          </div>
        );
      })}

      </div>

      <div className="font-setting__import">
        <Button
          type="button"
          size="sm"
          disabled={!vaultPath || busy}
          onClick={() => fileInputRef.current?.click()}
        >
          <Upload aria-hidden="true" />
          {t("settingsDialog.fontImport")}
        </Button>
        <span className="font-setting__import-hint">
          {vaultPath ? t("settingsDialog.fontImportFormats") : t("settingsDialog.fontImportNoFolder")}
        </span>
      </div>
      <input
        ref={fileInputRef}
        type="file"
        multiple
        hidden
        accept=".ttf,.woff,font/ttf,font/woff"
        onChange={(event) => void importSelected(event.target.files)}
      />

      {report || failed ? (
        <div className="font-setting__status" role="status" data-tone={failed || report?.imported.length === 0 ? "error" : undefined}>
          {failed ? <p>{t("settingsDialog.fontImportFailed")}</p> : null}
          {report && report.imported.length > 0 ? (
            <p>{t("settingsDialog.fontImported", { names: report.imported.join(", ") })}</p>
          ) : null}
          {report?.rejected.map((entry) => (
            <p key={entry.fileName}>
              {t("settingsDialog.fontRejected", {
                file: entry.fileName,
                reason: t(`settingsDialog.fontRejection.${entry.reason}`)
              })}
            </p>
          ))}
        </div>
      ) : null}
    </>
  );
}
