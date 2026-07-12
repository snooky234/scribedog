import { useEffect } from "react";
import { useTranslation } from "react-i18next";

import { Button } from "@/components/ui/button";

type UnsavedChangesDialogProps = {
  open: boolean;
  targetLabel: string | null;
  currentFileLabel: string | null;
  isSaving: boolean;
  onSave: () => void;
  onDiscard: () => void;
  onCancel: () => void;
};

export function UnsavedChangesDialog({
  open,
  targetLabel,
  currentFileLabel,
  isSaving,
  onSave,
  onDiscard,
  onCancel
}: UnsavedChangesDialogProps) {
  const { t } = useTranslation();

  useEffect(() => {
    if (!open) {
      return;
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !isSaving) {
        event.preventDefault();
        onCancel();
      }
    };

    window.addEventListener("keydown", handleKeyDown);

    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [open, isSaving, onCancel]);

  if (!open) {
    return null;
  }

  return (
    <div
      className="unsaved-dialog"
      role="presentation"
      onClick={() => {
        if (!isSaving) {
          onCancel();
        }
      }}
    >
      <div
        className="unsaved-dialog__panel"
        role="dialog"
        aria-modal="true"
        aria-labelledby="unsaved-dialog-title"
        aria-describedby="unsaved-dialog-description"
        onClick={(event) => event.stopPropagation()}
      >
        <p className="unsaved-dialog__eyebrow">{t("unsavedDialog.eyebrow")}</p>
        <h3 id="unsaved-dialog-title">{t("unsavedDialog.title")}</h3>
        <p id="unsaved-dialog-description" className="unsaved-dialog__description">
          {currentFileLabel
            ? t("unsavedDialog.descriptionCurrent", { fileLabel: currentFileLabel })
            : t("unsavedDialog.descriptionGeneric")}{" "}
          {targetLabel ? t("unsavedDialog.descriptionTarget", { targetLabel }) : ""}
        </p>

        <div className="unsaved-dialog__summary">
          <div>
            <span>{t("unsavedDialog.summaryFile")}</span>
            <strong>{currentFileLabel ?? t("common.unknown")}</strong>
          </div>
          <div>
            <span>{t("unsavedDialog.summaryTarget")}</span>
            <strong>{targetLabel ?? t("common.unknown")}</strong>
          </div>
        </div>

        <div className="unsaved-dialog__actions">
          <Button type="button" variant="outline" onClick={onCancel} disabled={isSaving}>
            {t("common.cancel")}
          </Button>
          <Button type="button" variant="secondary" onClick={onDiscard} disabled={isSaving}>
            {t("common.discard")}
          </Button>
          <Button type="button" onClick={onSave} disabled={isSaving}>
            {isSaving ? t("common.saving") : t("common.save")}
          </Button>
        </div>
      </div>
    </div>
  );
}