import { useEffect } from "react";
import { useTranslation } from "react-i18next";

import { Button } from "@/components/ui/button";

/**
 * The "Mehr erfahren" dialog of the knowledge base tab.
 *
 * This is the one place in the feature where jargon is allowed, and only
 * because it is explained here: everywhere else the wording rule from
 * DOCS/wissensbasis-plan.md applies (no "RAG", "Embedding", "Index", "Chunk"
 * in labels, toggles, buttons or warnings). The four sections answer the
 * questions a non-technical user actually has, in the order they have them —
 * including the last one, which no feature tour usually bothers with: how do I
 * undo this.
 */
export function RagExplainerDialog({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation();

  // The settings dialog closes itself on Escape via a window listener. While
  // this one is up, Escape has to dismiss it instead — captured before the
  // settings dialog's listener sees it, same as the delete confirmation in
  // VersioningSettings.
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") {
        return;
      }

      event.preventDefault();
      event.stopPropagation();
      onClose();
    };

    window.addEventListener("keydown", handleKeyDown, true);

    return () => window.removeEventListener("keydown", handleKeyDown, true);
  }, [onClose]);

  const sections = ["what", "how", "data", "undo"] as const;

  return (
    <div className="unsaved-dialog" role="presentation" onClick={onClose}>
      <div
        className="unsaved-dialog__panel rag-explainer"
        role="dialog"
        aria-modal="true"
        aria-labelledby="rag-explainer-title"
        onClick={(event) => event.stopPropagation()}
      >
        <h3 id="rag-explainer-title">{t("ragSettings.explainer.title")}</h3>

        {sections.map((section) => (
          <section key={section} className="rag-explainer__section">
            <h4>{t(`ragSettings.explainer.${section}Title`)}</h4>
            <p>{t(`ragSettings.explainer.${section}Body`)}</p>
          </section>
        ))}

        <div className="unsaved-dialog__actions">
          <Button type="button" onClick={onClose}>
            {t("common.close")}
          </Button>
        </div>
      </div>
    </div>
  );
}
