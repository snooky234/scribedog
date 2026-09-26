import { useEffect, useState } from "react";
import { Palette, RotateCcw } from "lucide-react";
import { useTranslation } from "react-i18next";

import { SettingRow } from "@/components/settings/SettingRow";
import { Button } from "@/components/ui/button";
import { isValidHexColor } from "@/lib/color";
import { findPresetTheme, PRESET_THEMES } from "@/lib/theme/presets";
import { OUTLINE_DEPTH_MAX, OUTLINE_DEPTH_MIN } from "@/lib/editor/documentOutline";
import { DEFAULT_ACCENT_COLOR, useAccentColorStore } from "@/store/useAccentColorStore";
import { useEditorSettingsStore, type TableWidth } from "@/store/useEditorSettingsStore";
import {
  customThemeIdOf,
  customThemeKey,
  presetThemeIdOf,
  presetThemeKey,
  type Theme,
  useThemeStore
} from "@/store/useThemeStore";

type AppearanceSettingsProps = {
  /** Opens the theme builder (settings close while it is open). */
  onThemeBuilderRequest: () => void;
};

/**
 * Theme, paper surface, accent colour and outline depth. All of them apply
 * through their own stores the moment they change. A custom theme brings its
 * own accent colour; while one is active, the accent field edits that
 * theme's accent instead of the app-wide setting. A shipped template is
 * read-only, so with one active the field shows its accent and is locked.
 */
export function AppearanceSettings({ onThemeBuilderRequest }: AppearanceSettingsProps) {
  const { t } = useTranslation();
  const theme = useThemeStore((state) => state.theme);
  const setTheme = useThemeStore((state) => state.setTheme);
  const customThemes = useThemeStore((state) => state.customThemes);
  const saveCustomTheme = useThemeStore((state) => state.saveCustomTheme);
  const activeCustomId = customThemeIdOf(theme);
  const activeCustomTheme = customThemes.find((entry) => entry.id === activeCustomId) ?? null;
  const activePresetId = presetThemeIdOf(theme);
  const activePreset = activePresetId ? findPresetTheme(activePresetId) : null;
  const presetName = (id: string) =>
    t(`themeBuilder.presets.${id}`, { defaultValue: findPresetTheme(id)?.name ?? id });
  const paperSurface = useEditorSettingsStore((state) => state.paperSurface);
  const setPaperSurface = useEditorSettingsStore((state) => state.setPaperSurface);
  const tableWidth = useEditorSettingsStore((state) => state.tableWidth);
  const setTableWidth = useEditorSettingsStore((state) => state.setTableWidth);
  const outlineMaxDepth = useEditorSettingsStore((state) => state.outlineMaxDepth);
  const setOutlineMaxDepth = useEditorSettingsStore((state) => state.setOutlineMaxDepth);
  const settingAccentColor = useAccentColorStore((state) => state.accentColor);
  const setSettingAccentColor = useAccentColorStore((state) => state.setAccentColor);
  const resetSettingAccentColor = useAccentColorStore((state) => state.resetAccentColor);

  const accentColor = activePreset
    ? activePreset.base.accent
    : activeCustomTheme
      ? activeCustomTheme.base.accent
      : settingAccentColor;
  const accentLocked = activePreset !== null;
  const setAccentColor = (color: string) => {
    if (!isValidHexColor(color)) {
      return;
    }
    if (activeCustomTheme) {
      saveCustomTheme({ ...activeCustomTheme, base: { ...activeCustomTheme.base, accent: color.toLowerCase() } });
    } else {
      setSettingAccentColor(color);
    }
  };
  const resetAccentColor = () =>
    activeCustomTheme ? setAccentColor(DEFAULT_ACCENT_COLOR) : resetSettingAccentColor();
  const [accentColorInput, setAccentColorInput] = useState(accentColor);

  useEffect(() => {
    setAccentColorInput(accentColor);
  }, [accentColor]);

  return (
    <div className="ai-dialog__grid">
      <SettingRow label={t("settingsDialog.theme")}>
        <select value={theme} onChange={(event) => setTheme(event.target.value as Theme)}>
          <option value="system">{t("settingsDialog.themeSystem")}</option>
          <option value="light">{t("settingsDialog.themeLight")}</option>
          <option value="dark">{t("settingsDialog.themeDark")}</option>
          {PRESET_THEMES.map((preset) => (
            <option key={preset.id} value={presetThemeKey(preset.id)}>
              {presetName(preset.id)}
            </option>
          ))}
          {customThemes.length > 0 ? (
            <optgroup label={t("settingsDialog.themeCustomGroup")}>
              {customThemes.map((entry) => (
                <option key={entry.id} value={customThemeKey(entry.id)}>
                  {entry.name}
                </option>
              ))}
            </optgroup>
          ) : null}
        </select>
      </SettingRow>

      <SettingRow
        label={t("settingsDialog.themeBuilder")}
        hint={t("settingsDialog.themeBuilderShort")}
        info={t("settingsDialog.themeBuilderHint")}
      >
        <Button type="button" variant="outline" onClick={onThemeBuilderRequest}>
          <Palette />
          {t("settingsDialog.themeBuilderOpen")}
        </Button>
      </SettingRow>

      <SettingRow
        label={t("settingsDialog.accentColor")}
        hint={
          activePreset
            ? t("settingsDialog.accentColorPresetShort", { name: presetName(activePreset.id) })
            : activeCustomTheme
              ? t("settingsDialog.accentColorThemeShort", { name: activeCustomTheme.name })
              : t("settingsDialog.accentColorShort")
        }
        info={t("settingsDialog.accentColorHint")}
      >
        {({ id, describedBy }) => (
          <div className="accent-color-setting">
            <input
              id={id}
              type="color"
              className="accent-color-setting__swatch"
              value={accentColor}
              disabled={accentLocked}
              onChange={(event) => setAccentColor(event.target.value)}
              aria-describedby={describedBy}
            />
            <input
              type="text"
              className="accent-color-setting__hex"
              value={accentColorInput}
              disabled={accentLocked}
              onChange={(event) => {
                const nextValue = event.target.value;
                setAccentColorInput(nextValue);
                if (isValidHexColor(nextValue)) {
                  setAccentColor(nextValue);
                }
              }}
              onBlur={() => setAccentColorInput(accentColor)}
              spellCheck={false}
              maxLength={7}
              aria-label={t("settingsDialog.accentColorHex")}
            />
            <button
              type="button"
              className="ai-dialog__model-refresh"
              onClick={resetAccentColor}
              disabled={accentLocked || accentColor.toLowerCase() === DEFAULT_ACCENT_COLOR}
              aria-label={t("settingsDialog.accentColorReset")}
              title={t("settingsDialog.accentColorReset")}
            >
              <RotateCcw size={16} />
            </button>
          </div>
        )}
      </SettingRow>

      <SettingRow
        layout="switch"
        label={t("settingsDialog.paperSurface")}
        hint={t("settingsDialog.paperSurfaceShort")}
        info={t("settingsDialog.paperSurfaceHint")}
      >
        <input type="checkbox" checked={paperSurface} onChange={(event) => setPaperSurface(event.target.checked)} />
      </SettingRow>

      <SettingRow
        label={t("settingsDialog.tableWidth")}
        hint={t("settingsDialog.tableWidthShort")}
        info={t("settingsDialog.tableWidthHint")}
      >
        <select value={tableWidth} onChange={(event) => setTableWidth(event.target.value as TableWidth)}>
          <option value="full">{t("settingsDialog.tableWidthFull")}</option>
          <option value="content">{t("settingsDialog.tableWidthContent")}</option>
        </select>
      </SettingRow>

      <SettingRow label={t("settingsDialog.outlineDepth")} hint={t("settingsDialog.outlineDepthShort")}>
        <select value={outlineMaxDepth} onChange={(event) => setOutlineMaxDepth(Number.parseInt(event.target.value, 10))}>
          {Array.from({ length: OUTLINE_DEPTH_MAX - OUTLINE_DEPTH_MIN + 1 }, (_, offset) => OUTLINE_DEPTH_MIN + offset).map(
            (level) => (
              <option key={level} value={level}>
                {level === OUTLINE_DEPTH_MAX
                  ? t("settingsDialog.outlineDepthAll")
                  : level === OUTLINE_DEPTH_MIN
                    ? t("settingsDialog.outlineDepthTop")
                    : t("settingsDialog.outlineDepthUpTo", { level })}
              </option>
            )
          )}
        </select>
      </SettingRow>
    </div>
  );
}
