import { useEffect } from "react";
import { Check, CheckCheck, CircleCheckBig, SpellCheck } from "lucide-react";
import { useTranslation } from "react-i18next";

import { Button } from "@/components/ui/button";
import { type AiCheckIssue } from "@/lib/aiClient";

type AiCheckDialogProps = {
  open: boolean;
  issues: AiCheckIssue[];
  resolvedCount: number;
  onApply: (issue: AiCheckIssue) => void;
  onApplyAll: () => void;
  onClose: () => void;
};

export function AiCheckDialog({ open, issues, resolvedCount, onApply, onApplyAll, onClose }: AiCheckDialogProps) {
  const { t } = useTranslation();

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

  return (
    <div className="ai-dialog" role="presentation" onClick={onClose}>
      <div
        className="ai-dialog__panel ai-dialog__panel--check"
        role="dialog"
        aria-modal="true"
        aria-labelledby="ai-check-title"
        onClick={(event) => event.stopPropagation()}
      >
        <p className="ai-dialog__eyebrow">{t("aiCheckDialog.eyebrow")}</p>
        <h3 id="ai-check-title" className="ai-dialog__title">
          <SpellCheck className="ai-dialog__title-icon" aria-hidden="true" />
          {t("aiCheckDialog.title")}
        </h3>

        {issues.length === 0 ? (
          <div className="ai-check-dialog__empty">
            <CircleCheckBig className="ai-check-dialog__empty-icon" aria-hidden="true" />
            {resolvedCount > 0 ? (
              <>
                <p className="ai-check-dialog__empty-title">{t("aiCheckDialog.resolvedTitle")}</p>
                <p className="ai-check-dialog__empty-description">{t("aiCheckDialog.resolvedDescription")}</p>
              </>
            ) : (
              <>
                <p className="ai-check-dialog__empty-title">{t("aiCheckDialog.emptyTitle")}</p>
                <p className="ai-check-dialog__empty-description">{t("aiCheckDialog.emptyDescription")}</p>
              </>
            )}
          </div>
        ) : (
          <ul className="ai-check-dialog__list">
            {issues.map((issue, index) => (
              <li className="ai-check-dialog__item" key={`${issue.original}-${index}`}>
                <div className="ai-check-dialog__diff">
                  <span className="ai-check-dialog__original">{issue.original}</span>
                  <span className="ai-check-dialog__arrow" aria-hidden="true">→</span>
                  <span className="ai-check-dialog__suggestion">{issue.suggestion}</span>
                </div>
                {issue.explanation ? (
                  <p className="ai-check-dialog__explanation">{issue.explanation}</p>
                ) : null}
                <div className="ai-check-dialog__item-actions">
                  <Button type="button" size="sm" variant="outline" onClick={() => onApply(issue)}>
                    <Check aria-hidden="true" />
                    {t("aiCheckDialog.apply")}
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        )}

        <div className="ai-dialog__actions">
          <Button type="button" variant="outline" onClick={onClose}>
            {t("aiCheckDialog.close")}
          </Button>
          {issues.length > 1 ? (
            <Button type="button" onClick={onApplyAll}>
              <CheckCheck aria-hidden="true" />
              {t("aiCheckDialog.applyAll")}
            </Button>
          ) : null}
        </div>
      </div>
    </div>
  );
}
