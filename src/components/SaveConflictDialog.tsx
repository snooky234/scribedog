import { useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";

import { Button } from "@/components/ui/button";
import { useVersioningSettingsStore } from "@/store/useVersioningSettingsStore";

type SaveConflictDialogProps = {
  open: boolean;
  fileLabel: string | null;
  /** Number of overlapping passages. */
  conflicts: number;
  isSaving: boolean;
  onReview: () => void;
  onOverwrite: () => void;
  onCancel: () => void;
};

/**
 * A save met someone else's changes to the same passages of the note (another
 * device, a sync client, a second person in a shared vault). Changes at
 * different places never get here; those are merged without asking.
 *
 * Reviewing is the default answer, since nothing can be lost by it: each
 * passage is shown in the editor as red (the other version) and green (this
 * one) and decided on its own, with this side's whole text saved to the
 * version history first. Keeping this side's text overwrites the other
 * version, which goes into the history before the write; with versioning off
 * the dialog says that it is gone then.
 */
export function SaveConflictDialog({
  open,
  fileLabel,
  conflicts,
  isSaving,
  onReview,
  onOverwrite,
  onCancel
}: SaveConflictDialogProps) {
  const { t } = useTranslation();
  const versioningEnabled = useVersioningSettingsStore((state) => state.versioningEnabled);
  const reviewButtonRef = useRef<HTMLElement>(null);

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

  // Reviewing is the safe default: Enter must not overwrite someone's work.
  useEffect(() => {
    if (open) {
      reviewButtonRef.current?.focus({ focusVisible: true } as FocusOptions);
    }
  }, [open]);

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
        aria-labelledby="save-conflict-title"
        aria-describedby="save-conflict-description"
        onClick={(event) => event.stopPropagation()}
      >
        <p className="unsaved-dialog__eyebrow">{t("saveConflictDialog.eyebrow")}</p>
        <h3 id="save-conflict-title">{t("saveConflictDialog.title")}</h3>
        <p id="save-conflict-description" className="unsaved-dialog__description">
          {fileLabel
            ? t("saveConflictDialog.descriptionWithName", { fileLabel, count: conflicts })
            : t("saveConflictDialog.descriptionGeneric", { count: conflicts })}{" "}
          {t("saveConflictDialog.reviewHint")}{" "}
          {versioningEnabled
            ? t("saveConflictDialog.versioningOn")
            : t("saveConflictDialog.versioningOff")}
        </p>

        <div className="unsaved-dialog__actions">
          <Button type="button" variant="outline" onClick={onCancel} disabled={isSaving}>
            {t("common.cancel")}
          </Button>
          <Button
            type="button"
            variant={versioningEnabled ? "outline" : "destructive"}
            onClick={onOverwrite}
            disabled={isSaving}
          >
            {isSaving ? t("common.saving") : t("saveConflictDialog.keepMine")}
          </Button>
          <Button ref={reviewButtonRef} type="button" onClick={onReview} disabled={isSaving}>
            {t("saveConflictDialog.review")}
          </Button>
        </div>
      </div>
    </div>
  );
}
