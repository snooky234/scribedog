import { useEffect, useState } from "react";
import { AlertTriangle } from "lucide-react";
import { useTranslation } from "react-i18next";

import { Button } from "@/components/ui/button";
import { RagRebuildDialog } from "@/components/rag/RagRebuildDialog";
import { useRagIndexStore } from "@/store/useRagIndexStore";

/**
 * What has been prepared for meaning search in this vault, and the two buttons
 * that change it.
 *
 * "Prepare" is deliberately explicit rather than automatic: it reads every
 * covered note in full and sends it to the embedding service, which is the
 * single most consequential thing this feature does. The user starts it.
 */
export function RagIndexPanel({
  isKnowledgeBaseEnabled,
  hasModel,
  includedFileCount,
  serviceName
}: {
  isKnowledgeBaseEnabled: boolean;
  hasModel: boolean;
  includedFileCount: number;
  serviceName: string;
}) {
  const { t } = useTranslation();
  const [isRebuildOpen, setIsRebuildOpen] = useState(false);

  const status = useRagIndexStore((state) => state.status);
  const isBuilding = useRagIndexStore((state) => state.isBuilding);
  const progress = useRagIndexStore((state) => state.progress);
  const error = useRagIndexStore((state) => state.error);
  const refreshStatus = useRagIndexStore((state) => state.refreshStatus);
  const build = useRagIndexStore((state) => state.build);
  const cancelBuild = useRagIndexStore((state) => state.cancelBuild);
  const deleteStoredData = useRagIndexStore((state) => state.deleteStoredData);

  useEffect(() => {
    void refreshStatus();
  }, [refreshStatus]);

  const pendingCount = status?.pendingFiles.length ?? 0;
  const readyCount = status?.readyFiles ?? 0;
  const hasStoredData = (status?.provider ?? null) !== null;
  // Files that left the selection are work too, and the only kind with nothing
  // to embed: their vectors have to be dropped from what is stored.
  const hasWork = pendingCount > 0 || (status?.obsoleteFiles ?? 0) > 0;
  const canBuild = isKnowledgeBaseEnabled && hasModel && !isBuilding;

  // Stored data from a foreign model — e.g. a vault prepared on another machine
  // or by an older version. Starting here would silently throw it away, so this
  // gets the same question the model switch gets.
  const wouldDiscardStoredData = status !== null && hasStoredData && !status.matchesSettings;

  const startBuild = () => {
    if (wouldDiscardStoredData) {
      setIsRebuildOpen(true);
      return;
    }

    void build();
  };

  const handleRebuildConfirmed = async () => {
    setIsRebuildOpen(false);
    await deleteStoredData();
    void build();
  };

  return (
    <div className="rag-settings__index">
      <span className="rag-settings__section-title">{t("ragSettings.index.title")}</span>

      {/* Stored data from another model is not used for anything — saying so
          beats letting the user wonder why meaning search finds nothing. */}
      {status && !status.matchesSettings ? (
        <div className="rag-settings__warning" role="note">
          <AlertTriangle className="rag-settings__warning-icon" aria-hidden="true" />
          <div>
            <p>{t("ragSettings.index.otherModel")}</p>
          </div>
        </div>
      ) : null}

      <p className="rag-settings__count">
        {isBuilding
          ? t("ragSettings.index.building", {
              done: progress?.done ?? 0,
              total: progress?.total ?? 0
            })
          : !hasStoredData
            ? t("ragSettings.index.none")
            : pendingCount > 0
              ? t("ragSettings.index.partial", { ready: readyCount, pending: pendingCount })
              : t("ragSettings.index.ready", { ready: readyCount })}
      </p>

      {error ? <p className="rag-settings__error">{error}</p> : null}

      {!isKnowledgeBaseEnabled ? (
        <p className="rag-settings__hint">{t("ragSettings.index.needsEnabled")}</p>
      ) : !hasModel ? (
        <p className="rag-settings__hint">{t("ragSettings.index.needsModel")}</p>
      ) : null}

      <div className="rag-settings__actions">
        {isBuilding ? (
          <Button type="button" variant="outline" onClick={cancelBuild}>
            {t("common.cancel")}
          </Button>
        ) : (
          <>
            <Button type="button" onClick={startBuild} disabled={!canBuild || !hasWork}>
              {wouldDiscardStoredData
                ? t("ragSettings.rebuild.confirm")
                : hasStoredData
                  ? t("ragSettings.index.update")
                  : t("ragSettings.index.prepare")}
            </Button>
            <Button
              type="button"
              variant="outline"
              onClick={() => void deleteStoredData()}
              disabled={!hasStoredData}
            >
              {t("ragSettings.index.delete")}
            </Button>
          </>
        )}
      </div>

      {isRebuildOpen ? (
        <RagRebuildDialog
          fileCount={includedFileCount}
          serviceName={serviceName}
          onCancel={() => setIsRebuildOpen(false)}
          onConfirm={() => void handleRebuildConfirmed()}
        />
      ) : null}
    </div>
  );
}
