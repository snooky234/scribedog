import { useEffect, useRef, useState } from "react";
import { Eye, EyeOff, RefreshCw } from "lucide-react";
import { useTranslation } from "react-i18next";
import { resolveResource } from "@tauri-apps/api/path";
import { openPath } from "@tauri-apps/plugin-opener";

import { Button } from "@/components/ui/button";
import { AssistantsSettings } from "@/components/AssistantsSettings";
import type { Assistant } from "@/store/useAssistantsStore";

import {
  fetchAvailableModels,
  isCloudProvider,
  PROVIDER_DEFAULT_API_URL,
  PROVIDER_DISPLAY_NAME
} from "@/lib/aiClient";
import { AI_PROVIDERS, type AiProvider, type AiSettings } from "@/store/useAiSettingsStore";
import { persistLanguage, type SupportedLanguage } from "@/i18n";
import { type Theme, useThemeStore } from "@/store/useThemeStore";
import { useUpdateSettingsStore } from "@/store/useUpdateSettingsStore";
import { isWindowsPlatform } from "@/lib/platform";
import { useAppVersion } from "@/hooks/useAppVersion";

export type SettingsTab = "general" | "ai" | "assistants";

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
  const checkForUpdatesEnabled = useUpdateSettingsStore((state) => state.checkForUpdatesEnabled);
  const setCheckForUpdatesEnabled = useUpdateSettingsStore(
    (state) => state.setCheckForUpdatesEnabled
  );
  const appVersion = useAppVersion();

  const [provider, setProvider] = useState(settings.provider);
  const [apiUrl, setApiUrl] = useState(settings.apiUrl);
  const [apiKey, setApiKey] = useState(settings.apiKey);
  const [showApiKey, setShowApiKey] = useState(false);
  const [model, setModel] = useState(settings.model);
  const [contextLength, setContextLength] = useState(String(settings.contextLength));
  const [thinkingMode, setThinkingMode] = useState(settings.thinkingMode);

  const [availableModels, setAvailableModels] = useState<string[]>([]);
  const [isLoadingModels, setIsLoadingModels] = useState(false);
  const [modelsError, setModelsError] = useState<string | null>(null);
  const modelsRequestIdRef = useRef(0);

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
    setAvailableModels([]);
    setModelsError(null);
    void loadModels(settings.provider, settings.apiUrl, settings.apiKey);
  }, [open, settings, initialTab]);

  useEffect(() => {
    if (!open) {
      return;
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
      }
    };

    window.addEventListener("keydown", handleKeyDown);

    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [open, onClose]);

  if (!open) {
    return null;
  }

  const handleOpenLicenses = async () => {
    const licensesPath = await resolveResource("THIRD_PARTY_LICENSES.md");
    await openPath(licensesPath);
  };

  const handleLanguageChange = (nextLanguage: SupportedLanguage) => {
    void i18n.changeLanguage(nextLanguage);
    persistLanguage(nextLanguage);
  };

  return (
    <div className="ai-dialog" role="presentation" onClick={onClose}>
      <div
        className="ai-dialog__panel"
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
                onClick={() => void handleOpenLicenses()}
              >
                {t("settingsDialog.openSourceLicenses")}
              </button>
            </p>
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
                    setProvider(nextProvider);
                    setApiUrl(nextApiUrl);
                    setAvailableModels([]);
                    setModelsError(null);
                    void loadModels(nextProvider, nextApiUrl, apiKey);
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
                <p className="ai-dialog__field--full ai-dialog__notice">
                  {t("settingsDialog.cloudProviderNotice", { provider: PROVIDER_DISPLAY_NAME[provider] })}
                </p>
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
          </div>
        )}

        {/* Assistants save themselves immediately via their own store, so the
            AI-settings footer would only mislead on that tab. */}
        <div className="ai-dialog__actions">
          <Button type="button" variant="outline" onClick={onClose}>
            {activeTab === "assistants" ? t("common.close") : t("common.cancel")}
          </Button>
          <Button
            type="button"
            hidden={activeTab === "assistants"}
            onClick={() => {
              onSave({
                provider,
                apiUrl: apiUrl.trim(),
                apiKey: apiKey.trim(),
                model: model.trim(),
                contextLength: clampContextLength(contextLength),
                thinkingMode
              });
            }}
          >
            {t("common.save")}
          </Button>
        </div>
      </div>
    </div>
  );
}
