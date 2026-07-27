import { useEffect, useMemo, useState } from "react";
import { AlertTriangle } from "lucide-react";
import { useTranslation } from "react-i18next";

import { Button } from "@/components/ui/button";
import { RagExplainerDialog } from "@/components/rag/RagExplainerDialog";
import { RagFolderTree } from "@/components/rag/RagFolderTree";
import { isCloudProvider, PROVIDER_DISPLAY_NAME } from "@/lib/aiClient";
import { getRelativeDisplayPath } from "@/lib/fileSystem";
import { buildRagFolderTree, collectFolderPaths, countIncludedFiles } from "@/lib/ragConfig";
import { clearVaultSearchCache } from "@/lib/ragSearch";
import { useAiSettingsStore, type AiProvider } from "@/store/useAiSettingsStore";
import { useAppStore } from "@/store/useAppStore";
import { useRagSettingsStore } from "@/store/useRagSettingsStore";

/**
 * The "Wissensbasis" settings tab (knowledge base — see
 * DOCS/wissensbasis-plan.md).
 *
 * Like the theme and versioning settings these apply immediately through their
 * own store rather than through the AI settings' save button. Three things
 * about this tab are requirements rather than styling choices:
 *
 * - The warning stays visible while the feature is *on*, not just while it is
 *   off. It describes what is happening, not what would happen.
 * - It states that folders created later inside a ticked one are included
 *   automatically. That is what the inheritance in ragConfig.ts does, and a
 *   consent notice that leaves it out is incomplete.
 * - It only appears for cloud providers. Local providers never send anything
 *   off-device, so there is nothing to consent to.
 */
type RagSettingsProps = {
  /**
   * Provider currently selected in the AI settings tab, which is only written
   * to the store on save. The notice names the service the notes would go to,
   * so it has to follow that pending choice rather than the saved one —
   * otherwise switching away from a cloud provider leaves a warning standing
   * that no longer describes anything.
   */
  pendingProvider?: AiProvider;
};

export function RagSettings({ pendingProvider }: RagSettingsProps) {
  const { t } = useTranslation();
  const folderPath = useAppStore((state) => state.folderPath);
  const filePaths = useAppStore((state) => state.filePaths);
  const savedProvider = useAiSettingsStore((state) => state.settings.provider);
  const aiProvider = pendingProvider ?? savedProvider;

  const config = useRagSettingsStore((state) => state.config);
  const setEnabled = useRagSettingsStore((state) => state.setEnabled);
  const toggleFolder = useRagSettingsStore((state) => state.toggleFolder);
  const pruneToExistingFolders = useRagSettingsStore((state) => state.pruneToExistingFolders);

  const [isExplainerOpen, setIsExplainerOpen] = useState(false);

  const relativeFiles = useMemo(
    () =>
      folderPath === null
        ? []
        : filePaths.map((filePath) => ({
            relativePath: getRelativeDisplayPath(folderPath, filePath)
          })),
    [folderPath, filePaths]
  );

  const tree = useMemo(() => buildRagFolderTree(relativeFiles), [relativeFiles]);

  // Folders the user excluded and then deleted would otherwise keep their
  // parent showing "mixed" forever.
  useEffect(() => {
    if (folderPath !== null) {
      pruneToExistingFolders(collectFolderPaths(tree));
    }
  }, [folderPath, tree, pruneToExistingFolders]);

  const includedCount = useMemo(
    () => countIncludedFiles({ rootIncluded: config.rootIncluded, overrides: config.overrides }, relativeFiles),
    [config.rootIncluded, config.overrides, relativeFiles]
  );

  const handleToggleFolder = (path: string, included: boolean) => {
    toggleFolder(path, included);
    // The Rust side caches parsed files across searches; a folder that just
    // left the scope must not survive in that cache.
    void clearVaultSearchCache();
  };

  if (folderPath === null) {
    return <p className="rag-settings__hint">{t("ragSettings.noFolder")}</p>;
  }

  return (
    <>
      <div className="rag-settings">
        <p className="rag-settings__intro">{t("ragSettings.intro")}</p>

        <Button type="button" variant="outline" onClick={() => setIsExplainerOpen(true)}>
          {t("ragSettings.learnMore")}
        </Button>

        {isCloudProvider(aiProvider) ? (
          <div className="rag-settings__warning" role="note">
            <AlertTriangle className="rag-settings__warning-icon" aria-hidden="true" />
            <div>
              <strong>{t("ragSettings.warningTitle")}</strong>
              <p className="rag-settings__warning-cloud">
                {t("ragSettings.warningCloud", { provider: PROVIDER_DISPLAY_NAME[aiProvider] })}
              </p>
              <p>{t("ragSettings.warningBody")}</p>
              <p>{t("ragSettings.warningInherit")}</p>
            </div>
          </div>
        ) : null}

        <label className="ai-dialog__switch ai-dialog__field--full">
          <input
            type="checkbox"
            checked={config.enabled}
            onChange={(event) => {
              setEnabled(event.target.checked);
              void clearVaultSearchCache();
            }}
          />
          <span>{t("ragSettings.enable")}</span>
        </label>

        <div className="rag-settings__folders">
          <span className="rag-settings__folders-label">{t("ragSettings.foldersLabel")}</span>
          {/* Selectable even while the feature is off, on purpose: the careful
              user wants to untick their private folder *before* switching
              anything on, and greying the tree out would force them to do it
              the other way round. */}
          <RagFolderTree
            root={tree}
            selection={{ rootIncluded: config.rootIncluded, overrides: config.overrides }}
            disabled={false}
            onToggle={handleToggleFolder}
          />
        </div>

        <p className="rag-settings__count">
          {config.enabled
            ? t("ragSettings.includedCount", { count: includedCount })
            : t("ragSettings.disabledHint")}
        </p>
      </div>

      {isExplainerOpen ? <RagExplainerDialog onClose={() => setIsExplainerOpen(false)} /> : null}
    </>
  );
}
