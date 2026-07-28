import { useEffect } from "react";
import { useTranslation } from "react-i18next";

import { Button } from "@/components/ui/button";

/**
 * Asked before anything prepared is thrown away, because the user changed the
 * model that makes their notes searchable.
 *
 * Vectors from two models are not comparable, so a change really does mean
 * everything has to be read and sent again — there is no silent fallback and no
 * partial reuse. Three sentences of this dialog are load-bearing and should not
 * be trimmed: what gets deleted, that the notes themselves are untouched (the
 * question a non-technical user actually has when they read "deleted"), and how
 * much is about to be sent where.
 */
export function RagRebuildDialog({
  fileCount,
  serviceName,
  onCancel,
  onConfirm
}: {
  fileCount: number;
  serviceName: string;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const { t } = useTranslation();

  // The settings dialog closes itself on Escape via a window listener. While
  // this one is up, Escape has to dismiss it instead — captured before the
  // settings dialog's listener sees it, same as the explainer dialog.
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") {
        return;
      }

      event.preventDefault();
      event.stopPropagation();
      onCancel();
    };

    window.addEventListener("keydown", handleKeyDown, true);

    return () => window.removeEventListener("keydown", handleKeyDown, true);
  }, [onCancel]);

  return (
    <div className="unsaved-dialog" role="presentation" onClick={onCancel}>
      <div
        className="unsaved-dialog__panel rag-rebuild"
        role="dialog"
        aria-modal="true"
        aria-labelledby="rag-rebuild-title"
        onClick={(event) => event.stopPropagation()}
      >
        <h3 id="rag-rebuild-title">{t("ragSettings.rebuild.title")}</h3>

        <p>{t("ragSettings.rebuild.body")}</p>
        <p>{t("ragSettings.rebuild.transfer", { service: serviceName })}</p>
        <p>{t("ragSettings.rebuild.notesUnchanged")}</p>
        {/* "files", not "count": a variable named count would additionally send
            i18next looking for plural forms of this key that no locale has. */}
        <p className="rag-rebuild__count">{t("ragSettings.rebuild.count", { files: fileCount })}</p>

        <div className="unsaved-dialog__actions">
          <Button type="button" variant="outline" onClick={onCancel}>
            {t("common.cancel")}
          </Button>
          <Button type="button" onClick={onConfirm}>
            {t("ragSettings.rebuild.confirm")}
          </Button>
        </div>
      </div>
    </div>
  );
}
