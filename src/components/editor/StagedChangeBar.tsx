import { Loader2, PawPrint } from "lucide-react";
import { useTranslation } from "react-i18next";

import { Button } from "@/components/ui/button";
import { stagedChangeKind, type StagedChange } from "@/lib/chat/vaultStaging";

/**
 * The bar above a document the agent has proposed a change for.
 *
 * While it is up, the editor is read-only — which is not a comfort detail but
 * what keeps the staging layer consistent: the proposal was computed against
 * the file's content as it was, and typing underneath it would drift the
 * document away from that baseline until applying the change silently
 * overwrote the user's own words.
 */
export function StagedChangeBar({
  change,
  hunkCount,
  missingHunks,
  isApplying,
  onAccept,
  onDiscard
}: {
  change: StagedChange;
  hunkCount: number;
  missingHunks: number;
  isApplying: boolean;
  onAccept: () => void;
  onDiscard: () => void;
}) {
  const { t } = useTranslation();
  const kind = stagedChangeKind(change);

  const summary =
    kind === "delete"
      ? t("editor.stagedPreviewDelete")
      : kind === "create"
        ? t("editor.stagedPreviewCreate")
        : kind === "rename"
          ? t("editor.stagedPreviewRename", { path: change.targetPath })
          : kind === "rename-edit"
            ? t("editor.stagedPreviewRenameEdit", {
                path: change.targetPath,
                count: hunkCount
              })
            : t("editor.stagedPreviewEdit", { count: hunkCount });

  return (
    <div className="staged-change-bar" role="status" aria-live="polite">
      <PawPrint className="size-4 shrink-0" aria-hidden="true" />

      <div className="staged-change-bar__text">
        <span className="staged-change-bar__summary">{summary}</span>
        <span className="staged-change-bar__hint">{t("editor.stagedPreviewReadOnly")}</span>
        {missingHunks > 0 ? (
          <span className="staged-change-bar__warning">
            {t("editor.stagedPreviewMissing", { count: missingHunks })}
          </span>
        ) : null}
      </div>

      <div className="staged-change-bar__actions">
        <Button type="button" size="sm" variant="outline" disabled={isApplying} onClick={onDiscard}>
          {t("editor.stagedPreviewDiscard")}
        </Button>
        <Button type="button" size="sm" disabled={isApplying} onClick={onAccept}>
          {isApplying ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : null}
          {t("editor.stagedPreviewAccept")}
        </Button>
      </div>
    </div>
  );
}
