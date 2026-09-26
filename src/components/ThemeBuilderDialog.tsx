import { useEffect, useRef, useState, type ChangeEvent } from "react";
import { ChevronDown, ClipboardCopy, ClipboardPaste, Copy, Download, Eye, RotateCcw, Trash2, Upload } from "lucide-react";
import { useTranslation } from "react-i18next";

import { ThemePreview, type ThemePreviewView } from "@/components/theme/ThemePreview";
import { Button } from "@/components/ui/button";
import { isValidHexColor } from "@/lib/color";
import { allowFileAccess } from "@/lib/fileSystem";
import {
  BASE_COLOR_KEYS,
  DEFAULT_ADVANCED_COLORS,
  DEFAULT_BASE_COLORS,
  DEFAULT_PAPER_COLORS,
  type AdvancedColorKey,
  type BaseColorKey,
  type ThemeMode
} from "@/lib/theme/derive";
import {
  createThemeId,
  isValidThemeName,
  parseThemeJson,
  serializeTheme,
  themeFileName,
  themesEqual,
  THEME_NAME_MAX_LENGTH,
  uniqueThemeName,
  type CustomTheme,
  type ThemeParseError
} from "@/lib/theme/themeFormat";
import { findPresetTheme, PRESET_THEMES } from "@/lib/theme/presets";
import { platform, requireLocalFs } from "@/platform";
import {
  customThemeIdOf,
  customThemeKey,
  presetThemeIdOf,
  presetThemeKey,
  useThemeStore,
  type Theme
} from "@/store/useThemeStore";

type ThemeBuilderDialogProps = {
  open: boolean;
  onClose: () => void;
};

/** What the left column shows: a read-only template (Light, Dark or one of
 *  the shipped presets, by id), a saved custom theme (by id), or a new theme
 *  that has not been saved yet. */
type Selection = { kind: "template"; id: string } | { kind: "custom"; id: string } | { kind: "new" };

const TEMPLATE_IDS = ["light", "dark", ...PRESET_THEMES.map((preset) => preset.id)];

/** The app theme key a template is used under. */
function templateKey(id: string): Theme {
  return id === "light" || id === "dark" ? id : presetThemeKey(id);
}

type Notice = { tone: "error" | "info"; text: string };

const ADVANCED_GROUPS: { titleKey: string; keys: AdvancedColorKey[] }[] = [
  { titleKey: "themeBuilder.advancedStatus", keys: ["error", "success", "warning", "info"] },
  { titleKey: "themeBuilder.advancedHighlights", keys: ["marker", "findMatch", "findCurrent", "diffRemoved", "diffAdded"] },
  {
    titleKey: "themeBuilder.advancedCode",
    keys: ["codeComment", "codeKeyword", "codeString", "codeNumber", "codeFunction", "codeType", "codeVariable"]
  }
];

function templateTheme(id: string, name: string): CustomTheme {
  if (id === "light" || id === "dark") {
    return { id, name, mode: id, base: { ...DEFAULT_BASE_COLORS[id] } };
  }
  const preset = findPresetTheme(id) ?? PRESET_THEMES[0];
  return { ...preset, name };
}

/** Switching the base tone carries the colours the user picked, but a colour
 *  still at the old mode's default follows to the new mode's default, so a
 *  duplicated light template turned dark does not stay light. */
function switchMode(theme: CustomTheme, mode: ThemeMode): CustomTheme {
  const base = { ...theme.base };
  for (const key of BASE_COLOR_KEYS) {
    if (base[key] === DEFAULT_BASE_COLORS[theme.mode][key]) {
      base[key] = DEFAULT_BASE_COLORS[mode][key];
    }
  }
  return { ...theme, mode, base };
}

type ColorFieldProps = {
  label: string;
  hint?: string;
  value: string;
  disabled: boolean;
  onChange: (value: string) => void;
  /** Shown when the value can go back to an inherited one. */
  onReset?: () => void;
  resetLabel: string;
};

/** Swatch plus hex field, the same pair the accent colour setting uses. The
 *  text field only commits complete #rrggbb values. */
function ColorField({ label, hint, value, disabled, onChange, onReset, resetLabel }: ColorFieldProps) {
  const [text, setText] = useState(value);

  useEffect(() => {
    setText(value);
  }, [value]);

  return (
    <div className="theme-builder__color">
      <div className="theme-builder__color-label">
        <span>{label}</span>
        {hint ? <small>{hint}</small> : null}
      </div>
      <div className="theme-builder__color-inputs">
        <input
          type="color"
          className="theme-builder__swatch"
          value={value}
          disabled={disabled}
          aria-label={label}
          onChange={(event) => onChange(event.target.value.toLowerCase())}
        />
        <input
          type="text"
          className="theme-builder__hex"
          value={text}
          disabled={disabled}
          maxLength={7}
          spellCheck={false}
          aria-label={label}
          onChange={(event) => {
            const next = event.target.value.trim();
            setText(next);
            if (isValidHexColor(next)) {
              onChange(next.toLowerCase());
            }
          }}
          onBlur={() => setText(value)}
        />
        {onReset ? (
          <button
            type="button"
            className="ai-dialog__model-refresh theme-builder__reset"
            onClick={onReset}
            disabled={disabled}
            aria-label={resetLabel}
            title={resetLabel}
          >
            <RotateCcw size={14} />
          </button>
        ) : (
          <span className="theme-builder__reset-placeholder" />
        )}
      </div>
    </div>
  );
}

/**
 * Builds and edits custom colour themes. Opened from Settings → Appearance,
 * which closes while this is open (the AssistantEditDialog pattern). The
 * built-in light and dark themes are templates: read-only, their one action
 * is "Duplicate". Nothing here touches the app until "Save" or "Use"; the
 * preview on the right is fed by the draft alone, and "View in app" puts the
 * draft on the window only for as long as that view lasts.
 */
export function ThemeBuilderDialog({ open, onClose }: ThemeBuilderDialogProps) {
  const { t } = useTranslation();
  const activeTheme = useThemeStore((state) => state.theme);
  const resolvedTheme = useThemeStore((state) => state.resolvedTheme);
  const customThemes = useThemeStore((state) => state.customThemes);
  const saveCustomTheme = useThemeStore((state) => state.saveCustomTheme);
  const deleteCustomTheme = useThemeStore((state) => state.deleteCustomTheme);
  const setTheme = useThemeStore((state) => state.setTheme);
  const previewAppearance = useThemeStore((state) => state.previewAppearance);

  const [selection, setSelection] = useState<Selection>({ kind: "template", id: "light" });
  const [draft, setDraft] = useState<CustomTheme>(() => templateTheme("light", ""));
  const [previewView, setPreviewView] = useState<ThemePreviewView>("app");
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [viewingInApp, setViewingInApp] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [pasteOpen, setPasteOpen] = useState(false);
  const [pasteText, setPasteText] = useState("");
  const [notice, setNotice] = useState<Notice | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const templateName = (id: string) =>
    id === "light"
      ? t("settingsDialog.themeLight")
      : id === "dark"
        ? t("settingsDialog.themeDark")
        : t(`themeBuilder.presets.${id}`, { defaultValue: findPresetTheme(id)?.name ?? id });

  const select = (next: Selection) => {
    setSelection(next);
    setConfirmingDelete(false);
    setNotice(null);
    if (next.kind === "template") {
      setDraft(templateTheme(next.id, templateName(next.id)));
    } else if (next.kind === "custom") {
      const stored = useThemeStore.getState().customThemes.find((entry) => entry.id === next.id);
      if (stored) {
        setDraft(stored);
      }
    }
  };

  // Opening starts on the theme the app wears: the active custom theme or
  // preset, or the template of the current mode.
  useEffect(() => {
    if (!open) {
      return;
    }
    const activeId = customThemeIdOf(activeTheme);
    const presetId = presetThemeIdOf(activeTheme);
    select(
      activeId
        ? { kind: "custom", id: activeId }
        : { kind: "template", id: presetId && findPresetTheme(presetId) ? presetId : resolvedTheme }
    );
    setAdvancedOpen(false);
    setViewingInApp(false);
    setPasteOpen(false);
    setPasteText("");
    // Only on opening; later store changes are this dialog's own doing.
  }, [open]);

  const close = () => {
    if (viewingInApp) {
      previewAppearance(null);
    }
    onClose();
  };

  useEffect(() => {
    if (!open) {
      return;
    }
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        if (viewingInApp) {
          previewAppearance(null);
          setViewingInApp(false);
        } else {
          onClose();
        }
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [open, onClose, viewingInApp, previewAppearance]);

  const saved = selection.kind === "custom" ? customThemes.find((entry) => entry.id === selection.id) : undefined;
  const editable = selection.kind !== "template";
  const dirty = selection.kind === "new" || (saved !== undefined && !themesEqual(saved, draft));
  const nameValid = isValidThemeName(draft.name);
  const isActive =
    selection.kind === "template"
      ? activeTheme === templateKey(selection.id) || (activeTheme === "system" && resolvedTheme === selection.id)
      : selection.kind === "custom" && activeTheme === customThemeKey(selection.id);

  const selectValue =
    selection.kind === "template"
      ? `template:${selection.id}`
      : selection.kind === "custom"
        ? `custom:${selection.id}`
        : "__new";

  if (!open) {
    return null;
  }

  const update = (patch: Partial<CustomTheme>) => setDraft((current) => ({ ...current, ...patch }));

  const setBaseColor = (key: BaseColorKey, value: string) =>
    setDraft((current) => ({ ...current, base: { ...current.base, [key]: value } }));

  const setAdvancedColor = (key: AdvancedColorKey, value: string | undefined) =>
    setDraft((current) => {
      const advanced = { ...current.advanced };
      if (value === undefined) {
        delete advanced[key];
      } else {
        advanced[key] = value;
      }
      return { ...current, advanced: Object.keys(advanced).length > 0 ? advanced : undefined };
    });

  const duplicate = () => {
    const copy: CustomTheme = {
      ...draft,
      id: createThemeId(),
      name: uniqueThemeName(
        t("themeBuilder.copyName", { name: draft.name }).slice(0, THEME_NAME_MAX_LENGTH),
        customThemes.map((entry) => entry.name)
      )
    };
    setDraft(copy);
    setSelection({ kind: "new" });
    setConfirmingDelete(false);
    setNotice(null);
  };

  const save = () => {
    if (!editable || !nameValid) {
      return;
    }
    const theme: CustomTheme = { ...draft, name: draft.name.trim() };
    saveCustomTheme(theme);
    setDraft(theme);
    setSelection({ kind: "custom", id: theme.id });
    setNotice({ tone: "info", text: t("themeBuilder.saved") });
  };

  const remove = () => {
    if (selection.kind !== "custom") {
      return;
    }
    if (!confirmingDelete) {
      setConfirmingDelete(true);
      return;
    }
    deleteCustomTheme(selection.id);
    select({ kind: "template", id: draft.mode });
  };

  const use = () => {
    if (selection.kind === "template") {
      setTheme(templateKey(selection.id));
    } else if (selection.kind === "custom" && !dirty) {
      setTheme(customThemeKey(selection.id));
    }
  };

  const viewInApp = () => {
    previewAppearance(draft);
    setViewingInApp(true);
  };

  const backFromApp = () => {
    previewAppearance(null);
    setViewingInApp(false);
  };

  // ---- export / import ----------------------------------------------------

  const exportToFile = async () => {
    if (!platform.downloads) {
      return;
    }
    try {
      const done = await platform.downloads.saveFile({
        fileName: themeFileName(draft),
        data: serializeTheme(draft),
        mimeType: "application/json"
      });
      if (done) {
        setNotice({ tone: "info", text: t("themeBuilder.exported") });
      }
    } catch (error) {
      setNotice({ tone: "error", text: t("themeBuilder.exportFailed", { error: String(error) }) });
    }
  };

  const exportToClipboard = async () => {
    try {
      await navigator.clipboard.writeText(serializeTheme(draft));
      setNotice({ tone: "info", text: t("themeBuilder.copied") });
    } catch {
      setNotice({ tone: "error", text: t("themeBuilder.clipboardWriteFailed") });
    }
  };

  const parseErrorText = (error: ThemeParseError) => t(`themeBuilder.importErrors.${error}`);

  /** An imported theme always becomes a new entry: a fresh id so it cannot
   *  overwrite one of the user's themes, and a numbered name on a clash. */
  const importJson = (raw: string): boolean => {
    const result = parseThemeJson(raw);
    if (!result.ok) {
      setNotice({ tone: "error", text: parseErrorText(result.error) });
      return false;
    }
    const theme: CustomTheme = {
      ...result.theme,
      id: createThemeId(),
      name: uniqueThemeName(result.theme.name, customThemes.map((entry) => entry.name))
    };
    saveCustomTheme(theme);
    setDraft(theme);
    setSelection({ kind: "custom", id: theme.id });
    setConfirmingDelete(false);
    setNotice({ tone: "info", text: t("themeBuilder.imported", { name: theme.name }) });
    return true;
  };

  // The desktop picks through the native dialog and reads from disk; the
  // browser has neither, so it uses a file input. One button either way.
  const nativeImport = platform.dialogs !== null && platform.localFs !== null;

  const importFromFile = async () => {
    if (!nativeImport || !platform.dialogs) {
      fileInputRef.current?.click();
      return;
    }
    const [path] = await platform.dialogs.chooseFiles({
      title: t("themeBuilder.importFileTitle"),
      filters: [{ name: t("themeBuilder.importFileFilter"), extensions: ["json"] }]
    });
    if (!path) {
      return;
    }
    try {
      await allowFileAccess(path).catch(() => undefined);
      importJson(await requireLocalFs().readTextFile(path));
    } catch (error) {
      setNotice({ tone: "error", text: t("themeBuilder.importReadFailed", { error: String(error) }) });
    }
  };

  const handleFileInput = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) {
      return;
    }
    try {
      importJson(await file.text());
    } catch (error) {
      setNotice({ tone: "error", text: t("themeBuilder.importReadFailed", { error: String(error) }) });
    }
  };

  // Reading the clipboard needs a permission some webviews and browsers do
  // not grant; then the JSON goes into a text field instead.
  const importFromClipboard = async () => {
    try {
      const text = await navigator.clipboard.readText();
      if (text.trim()) {
        importJson(text);
        return;
      }
    } catch {
      // Fall through to the paste field.
    }
    setPasteOpen(true);
  };

  // ---- render --------------------------------------------------------------

  if (viewingInApp) {
    return (
      <div className="theme-builder__app-view" role="dialog" aria-label={t("themeBuilder.viewInApp")}>
        <span>{t("themeBuilder.viewingInApp", { name: draft.name || t("themeBuilder.unnamed") })}</span>
        <Button type="button" size="sm" onClick={backFromApp}>
          {t("themeBuilder.backToBuilder")}
        </Button>
      </div>
    );
  }

  const baseLabels: Record<BaseColorKey, { label: string; hint: string }> = {
    background: { label: t("themeBuilder.colors.background"), hint: t("themeBuilder.colors.backgroundHint") },
    surface: { label: t("themeBuilder.colors.surface"), hint: t("themeBuilder.colors.surfaceHint") },
    text: { label: t("themeBuilder.colors.text"), hint: t("themeBuilder.colors.textHint") },
    muted: { label: t("themeBuilder.colors.muted"), hint: t("themeBuilder.colors.mutedHint") },
    chrome: { label: t("themeBuilder.colors.chrome"), hint: t("themeBuilder.colors.chromeHint") },
    accent: { label: t("themeBuilder.colors.accent"), hint: t("themeBuilder.colors.accentHint") }
  };

  const paper = draft.paper ?? DEFAULT_PAPER_COLORS;
  // Without a Zen page of its own, Zen mode shows the theme's window and text.
  const zenInherited = { background: draft.base.background, text: draft.base.text };
  const zen = draft.zen ?? zenInherited;
  // The paper sheet only exists in a dark theme.
  const shownView: ThemePreviewView = previewView === "paper" && draft.mode !== "dark" ? "app" : previewView;
  const resetLabel = t("themeBuilder.resetColor");

  return (
    <div className="ai-dialog" role="presentation" onClick={close}>
      <div
        className="ai-dialog__panel ai-dialog__panel--theme-builder"
        role="dialog"
        aria-modal="true"
        aria-labelledby="theme-builder-title"
        onClick={(event) => event.stopPropagation()}
      >
        <h3 id="theme-builder-title">{t("themeBuilder.title")}</h3>
        <div className="theme-builder__scroll">
          <p className="theme-builder__intro">{t("themeBuilder.intro")}</p>

          <div className="theme-builder__body">
            <div className="theme-builder__form">
              <label className="ai-dialog__field">
                <span>{t("themeBuilder.theme")}</span>
                <select
                  value={selectValue}
                  onChange={(event) => {
                    const value = event.target.value;
                    if (value.startsWith("template:")) {
                      select({ kind: "template", id: value.slice("template:".length) });
                    } else if (value.startsWith("custom:")) {
                      select({ kind: "custom", id: value.slice("custom:".length) });
                    }
                  }}
                >
                  <optgroup label={t("themeBuilder.templates")}>
                    {TEMPLATE_IDS.map((id) => (
                      <option key={id} value={`template:${id}`}>
                        {templateName(id)}
                      </option>
                    ))}
                  </optgroup>
                  {customThemes.length > 0 || selection.kind === "new" ? (
                    <optgroup label={t("themeBuilder.customThemes")}>
                      {customThemes.map((entry) => (
                        <option key={entry.id} value={`custom:${entry.id}`}>
                          {entry.name}
                        </option>
                      ))}
                      {selection.kind === "new" ? (
                        <option value="__new">{draft.name || t("themeBuilder.unnamed")}</option>
                      ) : null}
                    </optgroup>
                  ) : null}
                </select>
              </label>

              {!editable ? <p className="theme-builder__hint">{t("themeBuilder.templateHint")}</p> : null}

              <div className="theme-builder__row">
                <label className="ai-dialog__field theme-builder__name">
                  <span>{t("themeBuilder.name")}</span>
                  <input
                    type="text"
                    value={draft.name}
                    disabled={!editable}
                    maxLength={THEME_NAME_MAX_LENGTH}
                    placeholder={t("themeBuilder.namePlaceholder")}
                    onChange={(event) => update({ name: event.target.value })}
                  />
                </label>
                <label className="ai-dialog__field theme-builder__mode">
                  <span>{t("themeBuilder.mode")}</span>
                  <select
                    value={draft.mode}
                    disabled={!editable}
                    onChange={(event) => setDraft((current) => switchMode(current, event.target.value as ThemeMode))}
                  >
                    <option value="light">{t("themeBuilder.modeLight")}</option>
                    <option value="dark">{t("themeBuilder.modeDark")}</option>
                  </select>
                </label>
              </div>
              <p className="theme-builder__hint">{t("themeBuilder.modeHint")}</p>

              <div className="theme-builder__section-title">{t("themeBuilder.baseColors")}</div>
              <div className="theme-builder__colors">
                {BASE_COLOR_KEYS.map((key) => (
                  <ColorField
                    key={key}
                    label={baseLabels[key].label}
                    hint={baseLabels[key].hint}
                    value={draft.base[key]}
                    disabled={!editable}
                    onChange={(value) => setBaseColor(key, value)}
                    onReset={
                      editable && draft.base[key] !== DEFAULT_BASE_COLORS[draft.mode][key]
                        ? () => setBaseColor(key, DEFAULT_BASE_COLORS[draft.mode][key])
                        : undefined
                    }
                    resetLabel={resetLabel}
                  />
                ))}
              </div>

              {draft.mode === "dark" ? (
                <>
                  <div className="theme-builder__section-title">{t("themeBuilder.paper")}</div>
                  <p className="theme-builder__hint">{t("themeBuilder.paperHint")}</p>
                  <div className="theme-builder__colors">
                    {(["background", "text"] as const).map((key) => (
                      <ColorField
                        key={key}
                        label={key === "background" ? t("themeBuilder.paperBackground") : t("themeBuilder.paperText")}
                        value={paper[key]}
                        disabled={!editable}
                        onChange={(value) => {
                          update({ paper: { ...paper, [key]: value } });
                          setPreviewView("paper");
                        }}
                        onReset={
                          editable && draft.paper && draft.paper[key] !== DEFAULT_PAPER_COLORS[key]
                            ? () => {
                                const next = { ...paper, [key]: DEFAULT_PAPER_COLORS[key] };
                                const isDefault =
                                  next.background === DEFAULT_PAPER_COLORS.background &&
                                  next.text === DEFAULT_PAPER_COLORS.text;
                                update({ paper: isDefault ? undefined : next });
                              }
                            : undefined
                        }
                        resetLabel={resetLabel}
                      />
                    ))}
                  </div>
                </>
              ) : null}

              <div className="theme-builder__section-title">{t("themeBuilder.zen")}</div>
              <p className="theme-builder__hint">{t("themeBuilder.zenHint")}</p>
              <div className="theme-builder__colors">
                {(["background", "text"] as const).map((key) => (
                  <ColorField
                    key={key}
                    label={key === "background" ? t("themeBuilder.zenBackground") : t("themeBuilder.zenText")}
                    value={zen[key]}
                    disabled={!editable}
                    onChange={(value) => {
                      update({ zen: { ...zen, [key]: value } });
                      setPreviewView("zen");
                    }}
                    onReset={
                      editable && draft.zen && draft.zen[key] !== zenInherited[key]
                        ? () => {
                            const next = { ...zen, [key]: zenInherited[key] };
                            const inherited =
                              next.background === zenInherited.background && next.text === zenInherited.text;
                            update({ zen: inherited ? undefined : next });
                          }
                        : undefined
                    }
                    resetLabel={t("themeBuilder.resetZen")}
                  />
                ))}
              </div>

              <button
                type="button"
                className="theme-builder__advanced-toggle"
                aria-expanded={advancedOpen}
                onClick={() => setAdvancedOpen((value) => !value)}
              >
                <ChevronDown size={16} className={advancedOpen ? "theme-builder__chevron--open" : undefined} />
                {t("themeBuilder.advanced")}
              </button>
              {advancedOpen ? (
                <div className="theme-builder__advanced">
                  <p className="theme-builder__hint">{t("themeBuilder.advancedHint")}</p>
                  {ADVANCED_GROUPS.map((group) => (
                    <div key={group.titleKey}>
                      <div className="theme-builder__group-title">{t(group.titleKey)}</div>
                      <div className="theme-builder__colors">
                        {group.keys.map((key) => (
                          <ColorField
                            key={key}
                            label={t(`themeBuilder.advancedColors.${key}`)}
                            value={draft.advanced?.[key] ?? DEFAULT_ADVANCED_COLORS[draft.mode][key]}
                            disabled={!editable}
                            onChange={(value) => setAdvancedColor(key, value)}
                            onReset={editable && draft.advanced?.[key] ? () => setAdvancedColor(key, undefined) : undefined}
                            resetLabel={t("themeBuilder.resetAdvanced")}
                          />
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              ) : null}

              <div className="theme-builder__transfer">
                <div className="theme-builder__section-title">{t("themeBuilder.transfer")}</div>
                <p className="theme-builder__hint">{t("themeBuilder.transferHint")}</p>
                <div className="theme-builder__transfer-buttons">
                  {platform.downloads ? (
                    <Button type="button" variant="outline" size="sm" disabled={!editable} onClick={() => void exportToFile()}>
                      <Download />
                      {t("themeBuilder.exportFile")}
                    </Button>
                  ) : null}
                  <Button type="button" variant="outline" size="sm" disabled={!editable} onClick={() => void exportToClipboard()}>
                    <ClipboardCopy />
                    {t("themeBuilder.exportClipboard")}
                  </Button>
                  <Button type="button" variant="outline" size="sm" onClick={() => void importFromFile()}>
                    <Upload />
                    {t("themeBuilder.importFile")}
                  </Button>
                  <Button type="button" variant="outline" size="sm" onClick={() => void importFromClipboard()}>
                    <ClipboardPaste />
                    {t("themeBuilder.importClipboard")}
                  </Button>
                </div>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="application/json,.json"
                  hidden
                  onChange={(event) => void handleFileInput(event)}
                />
                {pasteOpen ? (
                  <div className="theme-builder__paste">
                    <label className="ai-dialog__field">
                      <span>{t("themeBuilder.pasteLabel")}</span>
                      <textarea
                        value={pasteText}
                        spellCheck={false}
                        placeholder={t("themeBuilder.pastePlaceholder")}
                        onChange={(event) => setPasteText(event.target.value)}
                      />
                    </label>
                    <div className="theme-builder__paste-actions">
                      <Button type="button" variant="outline" size="sm" onClick={() => setPasteOpen(false)}>
                        {t("common.cancel")}
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        disabled={!pasteText.trim()}
                        onClick={() => {
                          if (importJson(pasteText)) {
                            setPasteOpen(false);
                            setPasteText("");
                          }
                        }}
                      >
                        {t("themeBuilder.pasteImport")}
                      </Button>
                    </div>
                  </div>
                ) : null}
              </div>
            </div>

            <div className="theme-builder__preview">
              <ThemePreview theme={draft} view={shownView} />
              <div className="theme-builder__preview-options">
                <div className="theme-builder__view-switch" role="group" aria-label={t("themeBuilder.previewView")}>
                  {(["app", "paper", "zen"] as const).map((view) => (
                    <button
                      key={view}
                      type="button"
                      aria-pressed={shownView === view}
                      disabled={view === "paper" && draft.mode !== "dark"}
                      title={view === "paper" && draft.mode !== "dark" ? t("themeBuilder.viewPaperDarkOnly") : undefined}
                      onClick={() => setPreviewView(view)}
                    >
                      {t(`themeBuilder.view.${view}`)}
                    </button>
                  ))}
                </div>
                <Button type="button" variant="outline" size="sm" onClick={viewInApp}>
                  <Eye />
                  {t("themeBuilder.viewInApp")}
                </Button>
              </div>
            </div>
          </div>
        </div>

        {notice ? (
          <p className={`theme-builder__notice theme-builder__notice--${notice.tone}`} role="status">
            {notice.text}
          </p>
        ) : null}

        <div className="theme-builder__actions">
          {selection.kind === "custom" ? (
            <Button type="button" variant="destructive" onClick={remove}>
              <Trash2 />
              {confirmingDelete ? t("themeBuilder.confirmDelete") : t("themeBuilder.delete")}
            </Button>
          ) : null}
          <Button type="button" variant="outline" onClick={duplicate} className="theme-builder__duplicate">
            <Copy />
            {t("themeBuilder.duplicate")}
          </Button>
          <span className="theme-builder__actions-spacer" />
          {dirty ? <span className="theme-builder__dirty">{t("themeBuilder.unsaved")}</span> : null}
          <Button type="button" variant="outline" onClick={close}>
            {t("common.close")}
          </Button>
          {editable ? (
            <Button type="button" variant="outline" disabled={!dirty || !nameValid} onClick={save}>
              {t("common.save")}
            </Button>
          ) : null}
          <Button
            type="button"
            disabled={isActive || (selection.kind !== "template" && dirty)}
            title={selection.kind !== "template" && dirty ? t("themeBuilder.useNeedsSave") : undefined}
            onClick={use}
          >
            {isActive ? t("themeBuilder.inUse") : t("themeBuilder.use")}
          </Button>
        </div>
      </div>
    </div>
  );
}
