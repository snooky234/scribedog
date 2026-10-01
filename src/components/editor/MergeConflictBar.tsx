import { GitMerge } from "lucide-react";
import { useTranslation } from "react-i18next";

import { Button } from "@/components/ui/button";

/**
 * The bar above a note whose save met someone else's changes to the same
 * passages. Each passage sits in the document as a proposal: red is the other
 * version, which the document holds right now, green is this side's. Saving
 * waits until every one is decided, since until then the document is neither
 * side's text.
 *
 * Shares the look of the staged-change bar on purpose: it is the same red and
 * green review, only that the decision here is between two people's words
 * rather than the agent's and the user's.
 */
export function MergeConflictBar({
  openPassages,
  missingPassages,
  onKeepAllMine,
  onKeepAllTheirs
}: {
  openPassages: number;
  missingPassages: number;
  onKeepAllMine: () => void;
  onKeepAllTheirs: () => void;
}) {
  const { t } = useTranslation();

  return (
    <div className="staged-change-bar" role="status" aria-live="polite">
      <GitMerge className="size-4 shrink-0" aria-hidden="true" />

      <div className="staged-change-bar__text">
        <span className="staged-change-bar__summary">{t("editor.mergeReviewSummary", { count: openPassages })}</span>
        <span className="staged-change-bar__hint">{t("editor.mergeReviewHint")}</span>
        {missingPassages > 0 ? (
          <span className="staged-change-bar__warning">
            {t("editor.mergeReviewMissing", { count: missingPassages })}
          </span>
        ) : null}
      </div>

      <div className="staged-change-bar__actions">
        <Button type="button" size="sm" variant="outline" onClick={onKeepAllTheirs}>
          {t("editor.mergeReviewKeepTheirs")}
        </Button>
        <Button type="button" size="sm" onClick={onKeepAllMine}>
          {t("editor.mergeReviewKeepMine")}
        </Button>
      </div>
    </div>
  );
}
