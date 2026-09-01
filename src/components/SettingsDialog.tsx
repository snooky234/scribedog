import { useEffect, useRef, useState } from "react";
import { AlertTriangle, Eye, EyeOff, Info, RefreshCw } from "lucide-react";
import { useTranslation } from "react-i18next";

import { Button } from "@/components/ui/button";
import { AssistantsSettings } from "@/components/AssistantsSettings";
import { LicensesDialog } from "@/components/LicensesDialog";
import { RagSettings } from "@/components/RagSettings";
import { ShortcutsSettings } from "@/components/ShortcutsSettings";
import { VersioningSettings } from "@/components/VersioningSettings";
import type { Assistant } from "@/store/useAssistantsStore";
import { useRagSettingsStore } from "@/store/useRagSettingsStore";
import { getPortableStatus, type PortableMode } from "@/lib/portable";

import {
  fetchAvailableModels,
  isCloudProvider,
  PROVIDER_DEFAULT_API_URL,
  PROVIDER_DISPLAY_NAME
} from "@/lib/aiClient";
import {
  APP_FONTS,
  APP_FONT_IDS,
  ensureFontStylesLoaded,
  FONT_SIZE_PT_MAX,
  FONT_SIZE_PT_MIN,
  FONT_SIZE_PT_STEP,
  getFontScale
} from "@/lib/fonts";
import { useEditorSettingsStore } from "@/store/useEditorSettingsStore";
import {
  AGENT_MAX_ITERATIONS_MAX,
  AGENT_MAX_ITERATIONS_MIN,
  AGENT_MAX_PLAN_STEPS_MAX,
  AGENT_MAX_PLAN_STEPS_MIN,
  AI_PROVIDERS,
  loadApiKeyForProvider,
  type AgentPlanningMode,
  type AiProvider,
  type AiSettings
} from "@/store/useAiSettingsStore";
import { persistLanguage, type SupportedLanguage } from "@/i18n";
import { type Theme, useThemeStore } from "@/store/useThemeStore";
import { DEFAULT_ACCENT_COLOR, useAccentColorStore } from "@/store/useAccentColorStore";
import { isValidHexColor } from "@/lib/color";
import { useUpdateSettingsStore } from "@/store/useUpdateSettingsStore";
import { isWindowsPlatform } from "@/lib/platform";
import { useAppVersion } from "@/hooks/useAppVersion";

export type SettingsTab = "general" | "shortcuts" | "fonts" | "ai" | "assistants" | "rag" | "versioning";

/** Tabs whose settings apply through their own store, without the Save button. */
const SELF_SAVING_TABS: SettingsTab[] = ["shortcuts", "fonts", "assistants", "rag", "versioning"];

/** The agent's own settings, split off so the dialog can reset them as one. */
type AgentSettings = Pick<
  AiSettings,
  | "agentFileAccess"
  | "agentAllowDelete"
  | "agentPlanning"
  | "agentCompactContext"
  | "agentMultiEdit"
  | "agentMaxIterations"
  | "agentMaxPlanSteps"
>;

function pickAgentSettings(settings: AiSettings): AgentSettings {
  return {
    agentFileAccess: settings.agentFileAccess,
    agentAllowDelete: settings.agentAllowDelete,
    agentPlanning: settings.agentPlanning,
    agentCompactContext: settings.agentCompactContext,
    agentMultiEdit: settings.agentMultiEdit,
    agentMaxIterations: settings.agentMaxIterations,
    agentMaxPlanSteps: settings.agentMaxPlanSteps
  };
}

function clampAgentNumber(raw: string, min: number, max: number, fallback: number): number {
  const parsed = Number.parseInt(raw, 10);

  return Number.isFinite(parsed) ? Math.min(max, Math.max(min, parsed)) : fallback;
}

/**
 * The vault agent's capabilities, behind a collapsed section.
 *
 * Seven switches are a lot for an app whose appeal is quiet — so they sit
 * folded away, with defaults nobody has to touch. Each one carries a line
 * saying which model class it realistically needs: without that the user cannot
 * tell whether their model can carry a capability, and ends up switching either
 * everything off or everything on. The numbers are deliberately orders of
 * magnitude plus the symptom to watch for, because model quality per parameter
 * keeps moving and a good 8B beats a poor 14B.
 */
function AgentSettingsSection({
  value,
  provider,
  onChange
}: {
  value: AgentSettings;
  provider: AiProvider;
  onChange: (patch: Partial<AgentSettings>) => void;
}) {
  const { t } = useTranslation();

  return (
    <details className="ai-dialog__section">
      <summary>{t("settingsDialog.agentSection")}</summary>

      {/* Only for the local providers: the capabilities below ask more of a
          model than a rewrite does, and a small local model is where they
          quietly fail. A cloud model carries them, so the note would only be
          noise there. */}
      {!isCloudProvider(provider) ? (
        <div className="ai-dialog__notice ai-dialog__notice--info" role="note">
          <Info className="ai-dialog__notice-icon" aria-hidden="true" />
          <p>{t("settingsDialog.agentModelNotice")}</p>
        </div>
      ) : null}

      <div className="ai-dialog__grid">
        <label className="ai-dialog__switch">
          <input
            type="checkbox"
            checked={value.agentFileAccess}
            onChange={(event) => onChange({ agentFileAccess: event.target.checked })}
          />
          <span>{t("settingsDialog.agentFileAccessLabel")}</span>
        </label>
        <p className="ai-dialog__hint">{t("settingsDialog.agentFileAccessHint")}</p>

        <label className="ai-dialog__switch">
          <input
            type="checkbox"
            checked={value.agentAllowDelete}
            disabled={!value.agentFileAccess}
            onChange={(event) => onChange({ agentAllowDelete: event.target.checked })}
          />
          <span>{t("settingsDialog.agentAllowDeleteLabel")}</span>
        </label>
        <p className="ai-dialog__hint">{t("settingsDialog.agentAllowDeleteHint")}</p>

        <label className="ai-dialog__field">
          <span>{t("settingsDialog.agentPlanningLabel")}</span>
          <select
            value={value.agentPlanning}
            onChange={(event) => onChange({ agentPlanning: event.target.value as AgentPlanningMode })}
          >
            <option value="off">{t("settingsDialog.agentPlanningOff")}</option>
            <option value="auto">{t("settingsDialog.agentPlanningAuto")}</option>
            <option value="model">{t("settingsDialog.agentPlanningModel")}</option>
          </select>
        </label>
        <p className="ai-dialog__hint">
          {value.agentPlanning === "model"
            ? t("settingsDialog.agentPlanningModelHint")
            : t("settingsDialog.agentPlanningAutoHint")}
        </p>

        <label className="ai-dialog__switch">
          <input
            type="checkbox"
            checked={value.agentMultiEdit}
            disabled={!value.agentFileAccess}
            onChange={(event) => onChange({ agentMultiEdit: event.target.checked })}
          />
          <span>{t("settingsDialog.agentMultiEditLabel")}</span>
        </label>
        <p className="ai-dialog__hint">{t("settingsDialog.agentMultiEditHint")}</p>

        <label className="ai-dialog__switch">
          <input
            type="checkbox"
            checked={value.agentCompactContext}
            onChange={(event) => onChange({ agentCompactContext: event.target.checked })}
          />
          <span>{t("settingsDialog.agentCompactContextLabel")}</span>
        </label>
        <p className="ai-dialog__hint">{t("settingsDialog.agentCompactContextHint")}</p>

        <label className="ai-dialog__field">
          <span>{t("settingsDialog.agentMaxIterationsLabel")}</span>
          <input
            type="number"
            min={AGENT_MAX_ITERATIONS_MIN}
            max={AGENT_MAX_ITERATIONS_MAX}
            step={1}
            value={value.agentMaxIterations}
            onChange={(event) =>
              onChange({
                agentMaxIterations: clampAgentNumber(
                  event.target.value,
                  AGENT_MAX_ITERATIONS_MIN,
                  AGENT_MAX_ITERATIONS_MAX,
                  value.agentMaxIterations
                )
              })
            }
          />
        </label>
        <p className="ai-dialog__hint">{t("settingsDialog.agentMaxIterationsHint")}</p>

        <label className="ai-dialog__field">
          <span>{t("settingsDialog.agentMaxPlanStepsLabel")}</span>
          <input
            type="number"
            min={AGENT_MAX_PLAN_STEPS_MIN}
            max={AGENT_MAX_PLAN_STEPS_MAX}
            step={1}
            value={value.agentMaxPlanSteps}
            onChange={(event) =>
              onChange({
                agentMaxPlanSteps: clampAgentNumber(
                  event.target.value,
                  AGENT_MAX_PLAN_STEPS_MIN,
                  AGENT_MAX_PLAN_STEPS_MAX,
                  value.agentMaxPlanSteps
                )
              })
            }
          />
        </label>
        <p className="ai-dialog__hint">{t("settingsDialog.agentMaxPlanStepsHint")}</p>
      </div>
    </details>
  );
}

/**
 * Document font for editor and export alike. The preview renders the actual
 * face — which is the point of the box: a font name tells the user nothing,
 * and the difference between two serifs only shows in the letterforms.
 */
function FontSetting() {
  const { t } = useTranslation();
  const fontId = useEditorSettingsStore((state) => state.fontId);
  const setFontId = useEditorSettingsStore((state) => state.setFontId);
  const fontSizePt = useEditorSettingsStore((state) => state.fontSizePt);
  const setFontSizePt = useEditorSettingsStore((state) => state.setFontSizePt);

  // Every family's faces are needed at once here, since the list shows each
  // option in its own font rather than in the UI font.
  useEffect(() => {
    APP_FONT_IDS.forEach((id) => void ensureFontStylesLoaded(id));
  }, []);

  return (
    <div className="font-setting">
      <span className="font-setting__label">{t("settingsDialog.font")}</span>
      <p className="font-setting__hint">{t("settingsDialog.fontHint")}</p>

      <div className="font-setting__options" role="radiogroup" aria-label={t("settingsDialog.font")}>
        {APP_FONT_IDS.map((id) => {
          const definition = APP_FONTS[id];
          const label = definition.label ?? t("settingsDialog.fontSystem");
          const isSelected = id === fontId;

          return (
            <button
              key={id}
              type="button"
              role="radio"
              aria-checked={isSelected}
              className="font-setting__option"
              data-selected={isSelected ? "true" : undefined}
              onClick={() => setFontId(id)}
            >
              <span className="font-setting__name">{label}</span>
              <span
                className="font-setting__preview"
                style={{ fontFamily: definition.cssStack }}
                aria-hidden="true"
              >
                {t("settingsDialog.fontPreviewText")}
              </span>
            </button>
          );
        })}
      </div>

      <div className="font-setting__size">
        <label className="font-setting__size-label" htmlFor="settings-font-size">
          {t("settingsDialog.fontSize")}
          <output htmlFor="settings-font-size" className="font-setting__size-value">
            {t("settingsDialog.fontSizeValue", { size: fontSizePt })}
          </output>
        </label>

        <input
          id="settings-font-size"
          type="range"
          min={FONT_SIZE_PT_MIN}
          max={FONT_SIZE_PT_MAX}
          step={FONT_SIZE_PT_STEP}
          value={fontSizePt}
          onChange={(event) => setFontSizePt(Number.parseFloat(event.target.value))}
        />

        {/* Preview in the chosen family *and* size — the slider number alone
            does not tell anyone whether the text will read comfortably. */}
        <p
          className="font-setting__size-preview"
          style={{
            fontFamily: APP_FONTS[fontId].cssStack,
            fontSize: `calc(1rem * ${getFontScale(fontSizePt)})`
          }}
        >
          {t("settingsDialog.fontSizePreviewText")}
        </p>
      </div>
    </div>
  );
}

type SettingsDialogProps = {
  open: boolean;
  initialTab?: SettingsTab;
  settings: AiSettings;
  onSave: (settings: AiSettings) => void;
  onClose: () => void;
  onAssistantEditRequest: (assistant: Assistant | null) => void;
};

function clampContextLength(value: string) {
  const parsedValue = Number.parseInt(value, 10);

  if (!Number.isFinite(parsedValue) || parsedValue <= 0) {
    return 4096;
  }

  return parsedValue;
}

export function SettingsDialog({
  open,
  initialTab = "general",
  settings,
  onSave,
  onClose,
  onAssistantEditRequest
}: SettingsDialogProps) {
  const { t, i18n } = useTranslation();
  const [activeTab, setActiveTab] = useState<SettingsTab>("general");
  const theme = useThemeStore((state) => state.theme);
  const setTheme = useThemeStore((state) => state.setTheme);
  const accentColor = useAccentColorStore((state) => state.accentColor);
  const setAccentColor = useAccentColorStore((state) => state.setAccentColor);
  const resetAccentColor = useAccentColorStore((state) => state.resetAccentColor);
  const [accentColorInput, setAccentColorInput] = useState(accentColor);
  const checkForUpdatesEnabled = useUpdateSettingsStore((state) => state.checkForUpdatesEnabled);
  const setCheckForUpdatesEnabled = useUpdateSettingsStore(
    (state) => state.setCheckForUpdatesEnabled
  );
  const appVersion = useAppVersion();

  const ragEnabled = useRagSettingsStore((state) => state.config.enabled);

  const [provider, setProvider] = useState(settings.provider);
  const [apiUrl, setApiUrl] = useState(settings.apiUrl);
  const [apiKey, setApiKey] = useState(settings.apiKey);
  const [showApiKey, setShowApiKey] = useState(false);
  const [model, setModel] = useState(settings.model);
  const [contextLength, setContextLength] = useState(String(settings.contextLength));
  const [thinkingMode, setThinkingMode] = useState(settings.thinkingMode);
  const [agent, setAgent] = useState<AgentSettings>(() => pickAgentSettings(settings));

  const [licensesOpen, setLicensesOpen] = useState(false);
  const [portableMode, setPortableMode] = useState<PortableMode>("off");
  const [portableConfigDir, setPortableConfigDir] = useState("");
  const [availableModels, setAvailableModels] = useState<string[]>([]);
  const [isLoadingModels, setIsLoadingModels] = useState(false);
  const [modelsError, setModelsError] = useState<string | null>(null);
  const modelsRequestIdRef = useRef(0);
  const apiKeyRequestIdRef = useRef(0);

  const loadModels = async (providerToUse: AiProvider, apiUrlToUse: string, apiKeyToUse: string) => {
    const requestId = ++modelsRequestIdRef.current;
    setIsLoadingModels(true);
    setModelsError(null);

    try {
      const models = await fetchAvailableModels(providerToUse, apiUrlToUse, apiKeyToUse);

      if (modelsRequestIdRef.current !== requestId) {
        return;
      }

      setAvailableModels(models);

      // A model from a different provider (e.g. "devstral-latest" from
      // Mistral) is usually invalid in the freshly loaded list — better to
      // auto-select the first available model than leave a dead model name.
      setModel((currentModel) => (models.length > 0 && !models.includes(currentModel) ? models[0] : currentModel));
    } catch (error) {
      if (modelsRequestIdRef.current !== requestId) {
        return;
      }

      setAvailableModels([]);
      setModelsError(error instanceof Error ? error.message : t("settingsDialog.modelsLoadError"));
    } finally {
      if (modelsRequestIdRef.current === requestId) {
        setIsLoadingModels(false);
      }
    }
  };

  useEffect(() => {
    if (!open) {
      return;
    }

    setActiveTab(initialTab);
    setProvider(settings.provider);
    setApiUrl(settings.apiUrl);
    setApiKey(settings.apiKey);
    setShowApiKey(false);
    setModel(settings.model);
    setContextLength(String(settings.contextLength));
    setThinkingMode(settings.thinkingMode);
    setAgent(pickAgentSettings(settings));
    setAvailableModels([]);
    setModelsError(null);
    void loadModels(settings.provider, settings.apiUrl, settings.apiKey);
  }, [open, settings, initialTab]);

  useEffect(() => {
    setAccentColorInput(accentColor);
  }, [accentColor]);

  useEffect(() => {
    if (!open) {
      return;
    }

    let active = true;

    void getPortableStatus().then((status) => {
      if (active) {
        setPortableMode(status.mode);
        setPortableConfigDir(status.configDir);
      }
    });

    return () => {
      active = false;
    };
  }, [open]);

  useEffect(() => {
    if (!open) {
      return;
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();

        // The licenses sit on top of this dialog, so Escape peels off one
        // layer at a time instead of closing both at once.
        if (licensesOpen) {
          setLicensesOpen(false);
          return;
        }

        onClose();
      }
    };

    window.addEventListener("keydown", handleKeyDown);

    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [open, onClose, licensesOpen]);

  if (!open) {
    return null;
  }

  const handleLanguageChange = (nextLanguage: SupportedLanguage) => {
    void i18n.changeLanguage(nextLanguage);
    persistLanguage(nextLanguage);
  };

  return (
    <>
    <div className="ai-dialog" role="presentation" onClick={onClose}>
      <div
        className="ai-dialog__panel ai-dialog__panel--settings"
        role="dialog"
        aria-modal="true"
        aria-labelledby="settings-title"
        onClick={(event) => event.stopPropagation()}
      >
        <h3 id="settings-title">{t("settingsDialog.title")}</h3>

        <div className="ai-dialog__tabs" role="tablist" aria-label={t("settingsDialog.tabsAriaLabel")}>
          <button
            type="button"
            role="tab"
            id="settings-tab-general"
            aria-selected={activeTab === "general"}
            aria-controls="settings-panel-general"
            className={
              activeTab === "general" ? "ai-dialog__tab ai-dialog__tab--active" : "ai-dialog__tab"
            }
            onClick={() => setActiveTab("general")}
          >
            {t("settingsDialog.tabGeneral")}
          </button>
          <button
            type="button"
            role="tab"
            id="settings-tab-shortcuts"
            aria-selected={activeTab === "shortcuts"}
            aria-controls="settings-panel-shortcuts"
            className={
              activeTab === "shortcuts" ? "ai-dialog__tab ai-dialog__tab--active" : "ai-dialog__tab"
            }
            onClick={() => setActiveTab("shortcuts")}
          >
            {t("settingsDialog.tabShortcuts")}
          </button>
          <button
            type="button"
            role="tab"
            id="settings-tab-fonts"
            aria-selected={activeTab === "fonts"}
            aria-controls="settings-panel-fonts"
            className={
              activeTab === "fonts" ? "ai-dialog__tab ai-dialog__tab--active" : "ai-dialog__tab"
            }
            onClick={() => setActiveTab("fonts")}
          >
            {t("settingsDialog.tabFonts")}
          </button>
          <button
            type="button"
            role="tab"
            id="settings-tab-ai"
            aria-selected={activeTab === "ai"}
            aria-controls="settings-panel-ai"
            className={activeTab === "ai" ? "ai-dialog__tab ai-dialog__tab--active" : "ai-dialog__tab"}
            onClick={() => setActiveTab("ai")}
          >
            {t("settingsDialog.tabAi")}
          </button>
          <button
            type="button"
            role="tab"
            id="settings-tab-assistants"
            aria-selected={activeTab === "assistants"}
            aria-controls="settings-panel-assistants"
            className={
              activeTab === "assistants" ? "ai-dialog__tab ai-dialog__tab--active" : "ai-dialog__tab"
            }
            onClick={() => setActiveTab("assistants")}
          >
            {t("settingsDialog.tabAssistants")}
          </button>
          <button
            type="button"
            role="tab"
            id="settings-tab-rag"
            aria-selected={activeTab === "rag"}
            aria-controls="settings-panel-rag"
            className={activeTab === "rag" ? "ai-dialog__tab ai-dialog__tab--active" : "ai-dialog__tab"}
            onClick={() => setActiveTab("rag")}
          >
            {t("settingsDialog.tabRag")}
          </button>
          <button
            type="button"
            role="tab"
            id="settings-tab-versioning"
            aria-selected={activeTab === "versioning"}
            aria-controls="settings-panel-versioning"
            className={
              activeTab === "versioning" ? "ai-dialog__tab ai-dialog__tab--active" : "ai-dialog__tab"
            }
            onClick={() => setActiveTab("versioning")}
          >
            {t("settingsDialog.tabVersioning")}
          </button>
        </div>

        {activeTab === "general" ? (
          <div id="settings-panel-general" role="tabpanel" aria-labelledby="settings-tab-general">
            <div className="ai-dialog__grid">
              <label className="ai-dialog__field">
                <span>{t("settingsDialog.language")}</span>
                <select
                  value={i18n.resolvedLanguage ?? i18n.language}
                  onChange={(event) => handleLanguageChange(event.target.value as SupportedLanguage)}
                >
                  <option value="de">{t("settingsDialog.languageGerman")}</option>
                  <option value="en">{t("settingsDialog.languageEnglish")}</option>
                  <option value="fr">{t("settingsDialog.languageFrench")}</option>
                  <option value="es">{t("settingsDialog.languageSpanish")}</option>
                  <option value="zh">{t("settingsDialog.languageChinese")}</option>
                  <option value="ja">{t("settingsDialog.languageJapanese")}</option>
                  <option value="pt">{t("settingsDialog.languagePortuguese")}</option>
                  <option value="ru">{t("settingsDialog.languageRussian")}</option>
                  <option value="it">{t("settingsDialog.languageItalian")}</option>
                  <option value="uk">{t("settingsDialog.languageUkrainian")}</option>
                </select>
              </label>

              <label className="ai-dialog__field">
                <span>{t("settingsDialog.theme")}</span>
                <select
                  value={theme}
                  onChange={(event) => setTheme(event.target.value as Theme)}
                >
                  <option value="system">{t("settingsDialog.themeSystem")}</option>
                  <option value="light">{t("settingsDialog.themeLight")}</option>
                  <option value="dark">{t("settingsDialog.themeDark")}</option>
                </select>
              </label>

              <label className="ai-dialog__field">
                <span>{t("settingsDialog.accentColor")}</span>
                <div className="accent-color-setting">
                  <input
                    type="color"
                    className="accent-color-setting__swatch"
                    value={accentColor}
                    onChange={(event) => setAccentColor(event.target.value)}
                    aria-label={t("settingsDialog.accentColor")}
                  />
                  <input
                    type="text"
                    className="accent-color-setting__hex"
                    value={accentColorInput}
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
                    className="ai-dialog__link"
                    onClick={resetAccentColor}
                    disabled={accentColor.toLowerCase() === DEFAULT_ACCENT_COLOR}
                  >
                    {t("settingsDialog.accentColorReset")}
                  </button>
                </div>
                <span className="ai-dialog__model-hint">{t("settingsDialog.accentColorHint")}</span>
              </label>

              {isWindowsPlatform() && (
                <label className="ai-dialog__switch">
                  <input
                    type="checkbox"
                    checked={checkForUpdatesEnabled}
                    onChange={(event) => setCheckForUpdatesEnabled(event.target.checked)}
                  />
                  <span>{t("settingsDialog.checkForUpdates")}</span>
                </label>
              )}
            </div>

            {portableMode === "on" ? (
              <p className="ai-dialog__model-hint">
                {t("settingsDialog.portableMode", { path: portableConfigDir })}
              </p>
            ) : null}

            {portableMode === "readOnly" ? (
              <div className="ai-dialog__notice">
                <AlertTriangle className="ai-dialog__notice-icon" aria-hidden="true" />
                <p>{t("settingsDialog.portableReadOnly")}</p>
              </div>
            ) : null}

            <p className="ai-dialog__version">
              {appVersion ? (
                <>
                  {t("settingsDialog.version", { version: appVersion })}
                  {" · "}
                </>
              ) : null}
              <button
                type="button"
                className="ai-dialog__link"
                onClick={() => setLicensesOpen(true)}
              >
                {t("settingsDialog.openSourceLicenses")}
              </button>
            </p>
          </div>
        ) : activeTab === "shortcuts" ? (
          <div id="settings-panel-shortcuts" role="tabpanel" aria-labelledby="settings-tab-shortcuts">
            <ShortcutsSettings />
          </div>
        ) : activeTab === "fonts" ? (
          <div id="settings-panel-fonts" role="tabpanel" aria-labelledby="settings-tab-fonts">
            <FontSetting />
          </div>
        ) : activeTab === "versioning" ? (
          <div id="settings-panel-versioning" role="tabpanel" aria-labelledby="settings-tab-versioning">
            <VersioningSettings />
          </div>
        ) : activeTab === "rag" ? (
          <div id="settings-panel-rag" role="tabpanel" aria-labelledby="settings-tab-rag">
            <RagSettings pendingProvider={provider} />
          </div>
        ) : activeTab === "assistants" ? (
          <div id="settings-panel-assistants" role="tabpanel" aria-labelledby="settings-tab-assistants">
            <AssistantsSettings onEditRequest={onAssistantEditRequest} />
          </div>
        ) : (
          <div id="settings-panel-ai" role="tabpanel" aria-labelledby="settings-tab-ai">
            <div className="ai-dialog__grid">
              <label className="ai-dialog__field">
                <span>{t("settingsDialog.provider")}</span>
                <select
                  value={provider}
                  onChange={(event) => {
                    const nextProvider = event.target.value as AiProvider;
                    const nextApiUrl = PROVIDER_DEFAULT_API_URL[nextProvider];

                    // The model list is per provider and gets reloaded; the model
                    // field itself is left untouched so briefly checking out another
                    // provider doesn't discard an already-set model (see Toolbar.tsx
                    // for the fix against mixed model lists from multiple providers).
                    // The API key, unlike the model, is stored per provider (see
                    // useAiSettingsStore) — leaving the previous provider's key
                    // showing here would risk it being saved under the new
                    // provider on Save, so it's cleared until the new provider's
                    // own stored key (if any) has loaded.
                    const requestId = ++apiKeyRequestIdRef.current;

                    setProvider(nextProvider);
                    setApiUrl(nextApiUrl);
                    setApiKey("");
                    setAvailableModels([]);
                    setModelsError(null);

                    void loadApiKeyForProvider(nextProvider).then((storedApiKey) => {
                      if (apiKeyRequestIdRef.current !== requestId) {
                        return;
                      }

                      setApiKey(storedApiKey);
                      void loadModels(nextProvider, nextApiUrl, storedApiKey);
                    });
                  }}
                >
                  {AI_PROVIDERS.map((providerOption) => (
                    <option key={providerOption} value={providerOption}>
                      {PROVIDER_DISPLAY_NAME[providerOption]}
                    </option>
                  ))}
                </select>
              </label>

              <label className="ai-dialog__field">
                <span>{t("settingsDialog.apiUrl")}</span>
                <input
                  type="url"
                  value={apiUrl}
                  onChange={(event) => setApiUrl(event.target.value)}
                  onBlur={() => void loadModels(provider, apiUrl, apiKey)}
                  placeholder={PROVIDER_DEFAULT_API_URL[provider]}
                />
              </label>

              {isCloudProvider(provider) ? (
                <label className="ai-dialog__field ai-dialog__field--full">
                  <span>{t("settingsDialog.apiKey")}</span>
                  <div className="ai-dialog__model-field">
                    <input
                      type={showApiKey ? "text" : "password"}
                      value={apiKey}
                      autoComplete="off"
                      onChange={(event) => setApiKey(event.target.value)}
                      onBlur={() => void loadModels(provider, apiUrl, apiKey)}
                      placeholder={t("settingsDialog.apiKeyPlaceholder")}
                    />
                    <button
                      type="button"
                      className="ai-dialog__model-refresh"
                      onClick={() => setShowApiKey((value) => !value)}
                      aria-label={t(showApiKey ? "settingsDialog.hideApiKey" : "settingsDialog.showApiKey")}
                      title={t(showApiKey ? "settingsDialog.hideApiKey" : "settingsDialog.showApiKey")}
                    >
                      {showApiKey ? <EyeOff size={16} /> : <Eye size={16} />}
                    </button>
                  </div>
                  <span className="ai-dialog__model-hint">{t("settingsDialog.apiKeyHint")}</span>
                </label>
              ) : null}

              {isCloudProvider(provider) ? (
                <div className="ai-dialog__field--full ai-dialog__notice" role="note">
                  <AlertTriangle className="ai-dialog__notice-icon" aria-hidden="true" />
                  <p>
                    {t(ragEnabled ? "settingsDialog.cloudProviderNoticeRag" : "settingsDialog.cloudProviderNotice", {
                      provider: PROVIDER_DISPLAY_NAME[provider]
                    })}
                  </p>
                </div>
              ) : null}

              <label className="ai-dialog__field">
                <span>{t("settingsDialog.model")}</span>
                <div className="ai-dialog__model-field">
                  {availableModels.length > 0 ? (
                    <select value={model} onChange={(event) => setModel(event.target.value)}>
                      {!availableModels.includes(model) && model ? (
                        <option value={model}>{model}</option>
                      ) : null}
                      {availableModels.map((availableModel) => (
                        <option key={availableModel} value={availableModel}>
                          {availableModel}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <input
                      type="text"
                      value={model}
                      onChange={(event) => setModel(event.target.value)}
                      placeholder={t("settingsDialog.modelPlaceholder")}
                    />
                  )}
                  <button
                    type="button"
                    className="ai-dialog__model-refresh"
                    onClick={() => void loadModels(provider, apiUrl, apiKey)}
                    disabled={isLoadingModels}
                    aria-label={t("settingsDialog.refreshModels")}
                    title={t("settingsDialog.refreshModels")}
                  >
                    <RefreshCw
                      size={16}
                      className={isLoadingModels ? "ai-dialog__model-refresh-icon--spinning" : undefined}
                    />
                  </button>
                </div>
                {modelsError ? (
                  <span className="ai-dialog__model-hint ai-dialog__model-hint--error">{modelsError}</span>
                ) : isLoadingModels ? (
                  <span className="ai-dialog__model-hint">{t("settingsDialog.loadingModels")}</span>
                ) : null}
              </label>

              <label className="ai-dialog__field">
                <span>{t("settingsDialog.contextLength")}</span>
                <input
                  type="number"
                  min={1}
                  step={1}
                  value={contextLength}
                  onChange={(event) => setContextLength(event.target.value)}
                />
              </label>

              <label className="ai-dialog__field">
                <span>{t("settingsDialog.thinking")}</span>
                <select
                  value={thinkingMode}
                  onChange={(event) => setThinkingMode(event.target.value === "off" ? "off" : "default")}
                >
                  <option value="default">{t("settingsDialog.thinkingOn")}</option>
                  <option value="off">{t("settingsDialog.thinkingOff")}</option>
                </select>
              </label>
            </div>

            <AgentSettingsSection
              value={agent}
              provider={provider}
              onChange={(patch) => setAgent((current) => ({ ...current, ...patch }))}
            />
          </div>
        )}

        {/* Fonts, assistants, versioning and the knowledge base save themselves
            immediately via their own stores, so the AI-settings footer would
            only mislead on those tabs — on the knowledge base tab it would even
            look like the button that applies its connection. */}
        <div className="ai-dialog__actions">
          <Button type="button" variant="outline" onClick={onClose}>
            {SELF_SAVING_TABS.includes(activeTab) ? t("common.close") : t("common.cancel")}
          </Button>
          <Button
            type="button"
            hidden={SELF_SAVING_TABS.includes(activeTab)}
            onClick={() => {
              onSave({
                provider,
                apiUrl: apiUrl.trim(),
                apiKey: apiKey.trim(),
                model: model.trim(),
                contextLength: clampContextLength(contextLength),
                thinkingMode,
                ...agent
              });
            }}
          >
            {t("common.save")}
          </Button>
        </div>
      </div>
    </div>

    <LicensesDialog open={licensesOpen} onClose={() => setLicensesOpen(false)} />
    </>
  );
}
