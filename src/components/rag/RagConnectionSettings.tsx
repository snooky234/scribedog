import { useEffect, useRef, useState } from "react";
import { Eye, EyeOff, RefreshCw } from "lucide-react";
import { useTranslation } from "react-i18next";

import { Button } from "@/components/ui/button";
import { RagRebuildDialog } from "@/components/rag/RagRebuildDialog";
import {
  EMBEDDING_PROVIDERS,
  fetchAvailableModels,
  isCloudProvider,
  PROVIDER_DEFAULT_API_URL,
  PROVIDER_DISPLAY_NAME
} from "@/lib/aiClient";
import { type AiProvider } from "@/store/useAiSettingsStore";
import { useRagIndexStore } from "@/store/useRagIndexStore";
import {
  loadEmbeddingApiKey,
  useRagEmbeddingStore,
  type RagEmbeddingSettings
} from "@/store/useRagEmbeddingStore";

/**
 * The knowledge base's own connection — the service that makes notes
 * searchable by meaning.
 *
 * Two things here are requirements, not layout decisions:
 *
 * - It is separate from the AI settings. One may run locally while the other
 *   runs in the cloud, and the API key is stored under its own credential
 *   entry so a second key for the same provider cannot overwrite the first.
 * - It is applied by an explicit button rather than as you type. Changing the
 *   model invalidates everything prepared so far, and that has to be asked
 *   before it happens (RagRebuildDialog), not discovered afterwards.
 */
export function RagConnectionSettings({ includedFileCount }: { includedFileCount: number }) {
  const { t } = useTranslation();

  const saved = useRagEmbeddingStore((state) => state.settings);
  const saveSettings = useRagEmbeddingStore((state) => state.saveSettings);
  const status = useRagIndexStore((state) => state.status);
  const refreshStatus = useRagIndexStore((state) => state.refreshStatus);
  const deleteStoredData = useRagIndexStore((state) => state.deleteStoredData);
  const build = useRagIndexStore((state) => state.build);

  const [form, setForm] = useState<RagEmbeddingSettings>(saved);
  const [showApiKey, setShowApiKey] = useState(false);
  const [availableModels, setAvailableModels] = useState<string[]>([]);
  const [isLoadingModels, setIsLoadingModels] = useState(false);
  const [modelsError, setModelsError] = useState<string | null>(null);
  const [isRebuildOpen, setIsRebuildOpen] = useState(false);
  const modelsRequestIdRef = useRef(0);
  const apiKeyRequestIdRef = useRef(0);

  // The saved connection is read asynchronously (its key comes from the OS
  // credential store), so the form follows it until the user edits something.
  useEffect(() => {
    setForm(saved);
  }, [saved]);

  // What is stored decides whether applying a change has to ask first, so it
  // has to be known before the user can press the button — not only once the
  // panel below has mounted and reported it.
  useEffect(() => {
    void refreshStatus();
  }, [refreshStatus]);

  const loadModels = async (settings: RagEmbeddingSettings) => {
    const requestId = ++modelsRequestIdRef.current;
    setIsLoadingModels(true);
    setModelsError(null);

    try {
      const models = await fetchAvailableModels(settings.provider, settings.apiUrl, settings.apiKey);

      if (modelsRequestIdRef.current !== requestId) {
        return;
      }

      setAvailableModels(models);
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

  const handleProviderChange = (provider: AiProvider) => {
    const apiUrl = PROVIDER_DEFAULT_API_URL[provider];
    const requestId = ++apiKeyRequestIdRef.current;

    // Never carry the previous provider's key over into the new provider's
    // field — saving it there would store it under the wrong name.
    setForm((current) => ({ ...current, provider, apiUrl, apiKey: "" }));
    setAvailableModels([]);
    setModelsError(null);

    void loadEmbeddingApiKey(provider).then((apiKey) => {
      if (apiKeyRequestIdRef.current !== requestId) {
        return;
      }

      setForm((current) => (current.provider === provider ? { ...current, apiKey } : current));
    });
  };

  // Something is stored, and it came from a different model than the one in the
  // form: applying that choice throws it away, so it needs asking first.
  const wouldDiscardStoredData =
    status !== null &&
    status.provider !== null &&
    (status.provider !== form.provider || status.model !== form.model.trim());

  const applySettings = () => {
    saveSettings(form);
    void refreshStatus();
  };

  const handleSave = () => {
    if (wouldDiscardStoredData) {
      setIsRebuildOpen(true);
      return;
    }

    applySettings();
  };

  const handleRebuildConfirmed = async () => {
    setIsRebuildOpen(false);
    saveSettings(form);
    await deleteStoredData();
    void build();
  };

  const isDirty =
    form.provider !== saved.provider ||
    form.apiUrl.trim() !== saved.apiUrl ||
    form.apiKey.trim() !== saved.apiKey ||
    form.model.trim() !== saved.model;

  return (
    <div className="rag-settings__connection">
      <span className="rag-settings__section-title">{t("ragSettings.connection.title")}</span>
      <p className="rag-settings__hint">{t("ragSettings.connection.hint")}</p>

      <div className="ai-dialog__grid">
        <label className="ai-dialog__field">
          <span>{t("settingsDialog.provider")}</span>
          <select
            value={form.provider}
            onChange={(event) => handleProviderChange(event.target.value as AiProvider)}
          >
            {EMBEDDING_PROVIDERS.map((provider) => (
              <option key={provider} value={provider}>
                {PROVIDER_DISPLAY_NAME[provider]}
              </option>
            ))}
          </select>
          {/* Anthropic is missing from that list on purpose — it has no
              embeddings API at all, and letting the user pick it would only
              produce a failure they cannot fix. */}
          <span className="ai-dialog__model-hint">{t("ragSettings.connection.providerHint")}</span>
        </label>

        <label className="ai-dialog__field">
          <span>{t("settingsDialog.apiUrl")}</span>
          <input
            type="url"
            value={form.apiUrl}
            onChange={(event) => setForm((current) => ({ ...current, apiUrl: event.target.value }))}
            onBlur={() => void loadModels(form)}
            placeholder={PROVIDER_DEFAULT_API_URL[form.provider]}
          />
        </label>

        {isCloudProvider(form.provider) ? (
          <label className="ai-dialog__field ai-dialog__field--full">
            <span>{t("settingsDialog.apiKey")}</span>
            <div className="ai-dialog__model-field">
              <input
                type={showApiKey ? "text" : "password"}
                value={form.apiKey}
                autoComplete="off"
                onChange={(event) => setForm((current) => ({ ...current, apiKey: event.target.value }))}
                onBlur={() => void loadModels(form)}
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

        <label className="ai-dialog__field ai-dialog__field--full">
          <span>{t("ragSettings.connection.model")}</span>
          <div className="ai-dialog__model-field">
            {availableModels.length > 0 ? (
              <select
                value={form.model}
                onChange={(event) => setForm((current) => ({ ...current, model: event.target.value }))}
              >
                <option value="">{t("ragSettings.connection.modelUnset")}</option>
                {!availableModels.includes(form.model) && form.model ? (
                  <option value={form.model}>{form.model}</option>
                ) : null}
                {availableModels.map((model) => (
                  <option key={model} value={model}>
                    {model}
                  </option>
                ))}
              </select>
            ) : (
              <input
                type="text"
                value={form.model}
                onChange={(event) => setForm((current) => ({ ...current, model: event.target.value }))}
                placeholder={t("ragSettings.connection.modelPlaceholder")}
              />
            )}
            <button
              type="button"
              className="ai-dialog__model-refresh"
              onClick={() => void loadModels(form)}
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
          ) : (
            // The model list of a chat endpoint contains everything the server
            // offers, so it cannot tell the user which entries can embed at all.
            <span className="ai-dialog__model-hint">{t("ragSettings.connection.modelHint")}</span>
          )}
        </label>
      </div>

      <div className="rag-settings__actions">
        <Button type="button" onClick={handleSave} disabled={!isDirty}>
          {t("ragSettings.connection.save")}
        </Button>
        {isDirty ? <span className="rag-settings__hint">{t("ragSettings.connection.unsaved")}</span> : null}
      </div>

      {isRebuildOpen ? (
        <RagRebuildDialog
          fileCount={includedFileCount}
          serviceName={PROVIDER_DISPLAY_NAME[form.provider]}
          onCancel={() => {
            // No state in which a setting is on screen that is not in force:
            // cancelling puts the saved model back.
            setForm(saved);
            setIsRebuildOpen(false);
          }}
          onConfirm={() => void handleRebuildConfirmed()}
        />
      ) : null}
    </div>
  );
}
