import { useEffect, useRef, useState } from "react";
import { AlertTriangle, Eye, EyeOff, Info, RefreshCw } from "lucide-react";
import { useTranslation } from "react-i18next";

import { Button } from "@/components/ui/button";
import { AssistantsSettings } from "@/components/AssistantsSettings";
import { AccountSettings } from "@/components/web/AccountSettings";
import { RemoteVaultsSettings } from "@/components/remote/RemoteVaultsSettings";
import { LicensesDialog } from "@/components/LicensesDialog";
import { RagSettings } from "@/components/RagSettings";
import { AppearanceSettings } from "@/components/settings/AppearanceSettings";
import { InfoPopover } from "@/components/settings/InfoPopover";
import { SettingRow } from "@/components/settings/SettingRow";
import { SettingsNav } from "@/components/settings/SettingsNav";
import { SettingsPage } from "@/components/settings/SettingsPage";
import { AI_SETTINGS_TABS, SELF_SAVING_TABS, type SettingsTab } from "@/components/settings/settingsTabs";
import { VaultScopeHeader } from "@/components/settings/VaultScopeHeader";
import { VaultSettings } from "@/components/settings/VaultSettings";
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
import { useChatStore } from "@/store/useChatStore";
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
import { useUpdateSettingsStore } from "@/store/useUpdateSettingsStore";
import { describeAiError, localOriginInstruction } from "@/lib/localEndpointHint";
import { isWindowsPlatform } from "@/lib/platform";
import { platform } from "@/platform";
import { isSecretRef } from "@/platform/secretRef";
import type { CredentialsStatus } from "@/platform/types";
import { useAppVersion } from "@/hooks/useAppVersion";

export type { SettingsTab } from "@/components/settings/settingsTabs";

/** Nothing to report where the OS keeps the keys; see CredentialsApi. */
const READY_CREDENTIALS: CredentialsStatus = { state: "ready", discardedAt: null };

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
      <summary>
        <h5 className="settings-section__title">{t("settingsDialog.agentSection")}</h5>
      </summary>

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

      {/* The model-class line stays visible under every switch here (not
          behind the (i) like elsewhere): it is part of the switch, not
          documentation — see the note above. */}
      <div className="ai-dialog__grid">
        <SettingRow
          layout="switch"
          label={t("settingsDialog.agentFileAccessLabel")}
          hint={t("settingsDialog.agentFileAccessHint")}
        >
          <input
            type="checkbox"
            checked={value.agentFileAccess}
            onChange={(event) => onChange({ agentFileAccess: event.target.checked })}
          />
        </SettingRow>

        <SettingRow
          layout="switch"
          label={t("settingsDialog.agentAllowDeleteLabel")}
          hint={t("settingsDialog.agentAllowDeleteHint")}
        >
          <input
            type="checkbox"
            checked={value.agentAllowDelete}
            disabled={!value.agentFileAccess}
            onChange={(event) => onChange({ agentAllowDelete: event.target.checked })}
          />
        </SettingRow>

        <SettingRow
          full
          label={t("settingsDialog.agentPlanningLabel")}
          hint={
            value.agentPlanning === "model"
              ? t("settingsDialog.agentPlanningModelHint")
              : t("settingsDialog.agentPlanningAutoHint")
          }
        >
          <select
            value={value.agentPlanning}
            onChange={(event) => onChange({ agentPlanning: event.target.value as AgentPlanningMode })}
          >
            <option value="off">{t("settingsDialog.agentPlanningOff")}</option>
            <option value="auto">{t("settingsDialog.agentPlanningAuto")}</option>
            <option value="model">{t("settingsDialog.agentPlanningModel")}</option>
          </select>
        </SettingRow>

        <SettingRow
          layout="switch"
          label={t("settingsDialog.agentMultiEditLabel")}
          hint={t("settingsDialog.agentMultiEditHint")}
        >
          <input
            type="checkbox"
            checked={value.agentMultiEdit}
            disabled={!value.agentFileAccess}
            onChange={(event) => onChange({ agentMultiEdit: event.target.checked })}
          />
        </SettingRow>

        <SettingRow
          layout="switch"
          label={t("settingsDialog.agentCompactContextLabel")}
          hint={t("settingsDialog.agentCompactContextHint")}
        >
          <input
            type="checkbox"
            checked={value.agentCompactContext}
            onChange={(event) => onChange({ agentCompactContext: event.target.checked })}
          />
        </SettingRow>

        <SettingRow
          label={t("settingsDialog.agentMaxIterationsLabel")}
          hint={t("settingsDialog.agentMaxIterationsHint")}
        >
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
        </SettingRow>

        <SettingRow
          label={t("settingsDialog.agentMaxPlanStepsLabel")}
          hint={t("settingsDialog.agentMaxPlanStepsHint")}
        >
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
        </SettingRow>
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
      {/* Two settings, not two areas: labelled like every other setting row,
          since a section heading right under the page title "Fonts" would
          say the same word twice. */}
      <div className="font-setting__head">
        <span className="font-setting__label">{t("settingsDialog.font")}</span>
        <InfoPopover text={t("settingsDialog.fontHint")} />
      </div>
      <p className="font-setting__hint">{t("settingsDialog.fontShort")}</p>

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
  onThemeBuilderRequest: () => void;
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
  initialTab = "application",
  settings,
  onSave,
  onClose,
  onAssistantEditRequest,
  onThemeBuilderRequest
}: SettingsDialogProps) {
  const { t, i18n } = useTranslation();
  const [activeTab, setActiveTab] = useState<SettingsTab>("application");
  const checkForUpdatesEnabled = useUpdateSettingsStore((state) => state.checkForUpdatesEnabled);
  const setCheckForUpdatesEnabled = useUpdateSettingsStore(
    (state) => state.setCheckForUpdatesEnabled
  );
  const appVersion = useAppVersion();
  const reopenLastNote = useEditorSettingsStore((state) => state.reopenLastNote);
  const pasteMarkdown = useEditorSettingsStore((state) => state.pasteMarkdown);
  const setPasteMarkdown = useEditorSettingsStore((state) => state.setPasteMarkdown);
  const aiFeaturesVisible = useEditorSettingsStore((state) => state.aiFeaturesVisible);
  const setAiFeaturesVisible = useEditorSettingsStore((state) => state.setAiFeaturesVisible);
  const setReopenLastNote = useEditorSettingsStore((state) => state.setReopenLastNote);
  const restoreWorkingSet = useEditorSettingsStore((state) => state.restoreWorkingSet);
  const setRestoreWorkingSet = useEditorSettingsStore((state) => state.setRestoreWorkingSet);
  const autoAdmitWorkingSet = useEditorSettingsStore((state) => state.autoAdmitWorkingSet);
  const setAutoAdmitWorkingSet = useEditorSettingsStore((state) => state.setAutoAdmitWorkingSet);

  const ragEnabled = useRagSettingsStore((state) => state.config.enabled);

  const [provider, setProvider] = useState(settings.provider);
  const [apiUrl, setApiUrl] = useState(settings.apiUrl);
  const [apiKey, setApiKey] = useState(settings.apiKey);
  const [showApiKey, setShowApiKey] = useState(false);
  const [model, setModel] = useState(settings.model);
  const [contextLength, setContextLength] = useState(String(settings.contextLength));
  const [thinkingMode, setThinkingMode] = useState(settings.thinkingMode);
  const [agent, setAgent] = useState<AgentSettings>(() => pickAgentSettings(settings));

  // In the server edition the field never holds the key itself, only a
  // placeholder standing for "one is stored" (see platform/secretRef.ts).
  const isApiKeyStored = isSecretRef(apiKey);

  const [licensesOpen, setLicensesOpen] = useState(false);
  const [portableMode, setPortableMode] = useState<PortableMode>("off");
  const [portableConfigDir, setPortableConfigDir] = useState("");
  const [credentialsStatus, setCredentialsStatus] = useState<CredentialsStatus>(READY_CREDENTIALS);
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
      setModelsError(
        error instanceof Error
          ? await describeAiError(error, { provider: providerToUse, apiUrl: apiUrlToUse })
          : t("settingsDialog.modelsLoadError")
      );
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

    // A request for an AI page while those pages are hidden lands on the
    // page with the switch that brings them back.
    const aiHidden = !useEditorSettingsStore.getState().aiFeaturesVisible;
    setActiveTab(aiHidden && AI_SETTINGS_TABS.includes(initialTab) ? "application" : initialTab);
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

    // Hidden AI features reach out to no endpoint, not even for the model list.
    if (!aiHidden) {
      void loadModels(settings.provider, settings.apiUrl, settings.apiKey);
    }
  }, [open, settings, initialTab]);

  // Where the keys live can be in a state worth reporting: the server
  // edition keeps them encrypted and needs a fresh sign-in to read them
  // after a password change, and loses them to a password reset.
  useEffect(() => {
    if (!open) {
      return;
    }

    let active = true;

    void platform.credentials
      .getStatus()
      .then((status) => {
        if (active) {
          setCredentialsStatus(status);
        }
      })
      .catch(() => {
        if (active) {
          setCredentialsStatus(READY_CREDENTIALS);
        }
      });

    return () => {
      active = false;
    };
  }, [open, apiKey]);

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

        {/* Navigation on the left, the active panel on the right. Only the
            panel scrolls: the title above and the actions below stay put,
            so the way out of the dialog is on screen whatever entry is open
            and however long it is. */}
        <div className="settings-body">
          <SettingsNav activeTab={activeTab} onSelect={setActiveTab} />

          <div className="ai-dialog__scroll">
            {activeTab === "application" ? (
              <SettingsPage tab="application">
                <div className="ai-dialog__grid">
                  <SettingRow label={t("settingsDialog.language")}>
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
                  </SettingRow>

                  <SettingRow
                    layout="switch"
                    label={t("settingsDialog.reopenLastNote")}
                    hint={t("settingsDialog.reopenLastNoteShort")}
                  >
                    <input
                      type="checkbox"
                      checked={reopenLastNote}
                      onChange={(event) => setReopenLastNote(event.target.checked)}
                    />
                  </SettingRow>

                  <SettingRow
                    layout="switch"
                    label={t("settingsDialog.autoAdmitWorkingSet")}
                    hint={t("settingsDialog.autoAdmitWorkingSetShort")}
                    info={t("settingsDialog.autoAdmitWorkingSetHint")}
                  >
                    <input
                      type="checkbox"
                      checked={autoAdmitWorkingSet}
                      onChange={(event) => setAutoAdmitWorkingSet(event.target.checked)}
                    />
                  </SettingRow>

                  <SettingRow
                    layout="switch"
                    label={t("settingsDialog.restoreWorkingSet")}
                    hint={t("settingsDialog.restoreWorkingSetShort")}
                    info={t("settingsDialog.restoreWorkingSetHint")}
                  >
                    <input
                      type="checkbox"
                      checked={restoreWorkingSet}
                      onChange={(event) => setRestoreWorkingSet(event.target.checked)}
                    />
                  </SettingRow>

                  <SettingRow
                    layout="switch"
                    label={t("settingsDialog.pasteMarkdown")}
                    hint={t("settingsDialog.pasteMarkdownShort")}
                  >
                    <input
                      type="checkbox"
                      checked={pasteMarkdown}
                      onChange={(event) => setPasteMarkdown(event.target.checked)}
                    />
                  </SettingRow>

                  <SettingRow
                    layout="switch"
                    label={t("settingsDialog.showAiFeatures")}
                    hint={t("settingsDialog.showAiFeaturesShort")}
                    info={t("settingsDialog.showAiFeaturesHint")}
                  >
                    <input
                      type="checkbox"
                      checked={aiFeaturesVisible}
                      onChange={(event) => {
                        setAiFeaturesVisible(event.target.checked);

                        if (!event.target.checked) {
                          useChatStore.getState().closePanel();
                        }
                      }}
                    />
                  </SettingRow>

                  {platform.features.updater && isWindowsPlatform() ? (
                    <SettingRow
                      layout="switch"
                      label={t("settingsDialog.checkForUpdates")}
                      hint={t("settingsDialog.checkForUpdatesShort")}
                      info={t("settingsDialog.checkForUpdatesHint")}
                    >
                      <input
                        type="checkbox"
                        checked={checkForUpdatesEnabled}
                        onChange={(event) => setCheckForUpdatesEnabled(event.target.checked)}
                      />
                    </SettingRow>
                  ) : null}
                </div>

                {portableMode === "on" ? (
                  <div className="ai-dialog__notice ai-dialog__notice--info" role="note">
                    <Info className="ai-dialog__notice-icon" aria-hidden="true" />
                    <p>{t("settingsDialog.portableMode", { path: portableConfigDir })}</p>
                  </div>
                ) : null}

                {portableMode === "readOnly" ? (
                  <div className="ai-dialog__notice" role="note">
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
              </SettingsPage>
            ) : activeTab === "appearance" ? (
              <SettingsPage tab="appearance">
                <AppearanceSettings onThemeBuilderRequest={onThemeBuilderRequest} />
              </SettingsPage>
            ) : activeTab === "fonts" ? (
              <SettingsPage tab="fonts">
                <FontSetting />
              </SettingsPage>
            ) : activeTab === "shortcuts" ? (
              <SettingsPage tab="shortcuts">
                <ShortcutsSettings />
              </SettingsPage>
            ) : activeTab === "assistants" ? (
              <SettingsPage tab="assistants">
                <AssistantsSettings onEditRequest={onAssistantEditRequest} />
              </SettingsPage>
            ) : activeTab === "rag" ? (
              <SettingsPage tab="rag">
                <VaultScopeHeader />
                <RagSettings pendingProvider={provider} />
              </SettingsPage>
            ) : activeTab === "versioning" ? (
              <SettingsPage tab="versioning">
                <VersioningSettings />
              </SettingsPage>
            ) : activeTab === "vault" ? (
              <SettingsPage tab="vault">
                <VaultSettings />
              </SettingsPage>
            ) : activeTab === "account" ? (
              <SettingsPage tab="account">
                <AccountSettings />
              </SettingsPage>
            ) : activeTab === "server" ? (
              <SettingsPage tab="server">
                <RemoteVaultsSettings />
              </SettingsPage>
            ) : (
              <SettingsPage tab="ai">
                {/* Two areas on this page: the connection to the model, and
                    the agent's capabilities folded away below. */}
                <h5 className="settings-section__title">{t("settingsDialog.connectionSection")}</h5>

                <div className="ai-dialog__grid">
                  <SettingRow label={t("settingsDialog.provider")}>
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
                  </SettingRow>

                  <SettingRow label={t("settingsDialog.apiUrl")}>
                    <input
                      type="url"
                      value={apiUrl}
                      onChange={(event) => setApiUrl(event.target.value)}
                      onBlur={() => void loadModels(provider, apiUrl, apiKey)}
                      placeholder={PROVIDER_DEFAULT_API_URL[provider]}
                    />
                  </SettingRow>

                  {isCloudProvider(provider) ? (
                    <SettingRow
                      full
                      label={t("settingsDialog.apiKey")}
                      hint={
                        platform.features.session
                          ? t("settingsDialog.apiKeyServerHint")
                          : t("settingsDialog.apiKeyShort")
                      }
                    >
                      {({ id, describedBy }) => (
                        <>
                          <div className="ai-dialog__model-field">
                            {/* A stored key the server keeps to itself shows as an
                                empty field with a "stored" placeholder: there is no
                                value to display, and typing replaces it. */}
                            <input
                              id={id}
                              type={showApiKey && !isApiKeyStored ? "text" : "password"}
                              value={isApiKeyStored ? "" : apiKey}
                              autoComplete="off"
                              onChange={(event) => setApiKey(event.target.value)}
                              onBlur={() => void loadModels(provider, apiUrl, apiKey)}
                              placeholder={
                                isApiKeyStored ? t("settingsDialog.apiKeyStored") : t("settingsDialog.apiKeyPlaceholder")
                              }
                              aria-describedby={describedBy}
                              data-testid="api-key"
                            />
                            {isApiKeyStored ? null : (
                              <button
                                type="button"
                                className="ai-dialog__model-refresh"
                                onClick={() => setShowApiKey((value) => !value)}
                                aria-label={t(showApiKey ? "settingsDialog.hideApiKey" : "settingsDialog.showApiKey")}
                                title={t(showApiKey ? "settingsDialog.hideApiKey" : "settingsDialog.showApiKey")}
                              >
                                {showApiKey ? <EyeOff size={16} /> : <Eye size={16} />}
                              </button>
                            )}
                          </div>
                          {credentialsStatus.state === "locked" ? (
                            <span className="ai-dialog__error" role="status">
                              {t("settingsDialog.apiKeyLocked")}
                            </span>
                          ) : credentialsStatus.discardedAt ? (
                            <span className="ai-dialog__error" role="status">
                              {t("settingsDialog.apiKeyDiscarded")}
                            </span>
                          ) : null}
                        </>
                      )}
                    </SettingRow>
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

                  {/* In the browser the tab itself talks to a local model server,
                      so the server has to accept this page's origin, which the
                      user has to set up once. Said here, where the URL is entered,
                      not only after the first failed request. */}
                  {!isCloudProvider(provider) && platform.localModels ? (
                    <div className="ai-dialog__field--full ai-dialog__notice ai-dialog__notice--info" role="note">
                      <Info className="ai-dialog__notice-icon" aria-hidden="true" />
                      <p>
                        {t("settingsDialog.localProviderBrowserHint", {
                          provider: PROVIDER_DISPLAY_NAME[provider],
                          origin: platform.localModels.origin,
                          instruction: localOriginInstruction(provider, platform.localModels.origin)
                        })}
                      </p>
                    </div>
                  ) : null}

                  <SettingRow
                    label={t("settingsDialog.model")}
                    hint={
                      modelsError ? (
                        <span className="ai-dialog__model-hint--error">{modelsError}</span>
                      ) : isLoadingModels ? (
                        t("settingsDialog.loadingModels")
                      ) : undefined
                    }
                  >
                    {({ id, describedBy }) => (
                      <div className="ai-dialog__model-field">
                        {availableModels.length > 0 ? (
                          <select
                            id={id}
                            value={model}
                            onChange={(event) => setModel(event.target.value)}
                            aria-describedby={describedBy}
                          >
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
                            id={id}
                            type="text"
                            value={model}
                            onChange={(event) => setModel(event.target.value)}
                            placeholder={t("settingsDialog.modelPlaceholder")}
                            aria-describedby={describedBy}
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
                    )}
                  </SettingRow>

                  <SettingRow label={t("settingsDialog.contextLength")} hint={t("settingsDialog.contextLengthShort")}>
                    <input
                      type="number"
                      min={1}
                      step={1}
                      value={contextLength}
                      onChange={(event) => setContextLength(event.target.value)}
                    />
                  </SettingRow>

                  <SettingRow label={t("settingsDialog.thinking")} hint={t("settingsDialog.thinkingShort")}>
                    <select
                      value={thinkingMode}
                      onChange={(event) => setThinkingMode(event.target.value === "off" ? "off" : "default")}
                    >
                      <option value="default">{t("settingsDialog.thinkingOn")}</option>
                      <option value="off">{t("settingsDialog.thinkingOff")}</option>
                    </select>
                  </SettingRow>
                </div>

                <AgentSettingsSection
                  value={agent}
                  provider={provider}
                  onChange={(patch) => setAgent((current) => ({ ...current, ...patch }))}
                />
              </SettingsPage>
            )}
          </div>
        </div>

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
