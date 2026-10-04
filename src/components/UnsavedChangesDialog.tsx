import { useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";

import { Button } from "@/components/ui/button";
import { useDismissOnOverlayClick } from "@/hooks/useDismissOnOverlayClick";

type UnsavedChangesDialogProps = {
  open: boolean;
  /** The note being closed, as the tree labels it. */
  fileLabel: string | null;
  isSaving: boolean;
  onSave: () => void;
  onDiscard: () => void;
  onCancel: () => void;
};

/**
 * Save / Discard / Cancel for a dirty note the user is closing out of the
 * "In progress" list. The one dialog of its kind left: switching notes,
 * vaults or closing the app no longer asks (unsaved edits survive all three
 * as drafts). Closing an entry is different, because "close" is the user
 * saying they are done with the note, and a draft they are done with should
 * not come back on the next start.
 */
export function UnsavedChangesDialog({
  open,
  fileLabel,
  isSaving,
  onSave,
  onDiscard,
  onCancel
}: UnsavedChangesDialogProps) {
  const { t } = useTranslation();
  const cancelButtonRef = useRef<HTMLElement>(null);
  const discardButtonRef = useRef<HTMLElement>(null);
  const saveButtonRef = useRef<HTMLElement>(null);

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

  // Save is the default action here, so it receives focus on open;
  // Tab/arrow keys move to the other buttons from there. `focusVisible`
  // forces the focus ring to show — a plain programmatic focus() would
  // not trigger :focus-visible, leaving the default button unhighlighted.
  useEffect(() => {
    if (open) {
      // `focusVisible` is a valid runtime option in Chromium/WebView2 but is
      // not yet in the TS FocusOptions type, hence the cast.
      saveButtonRef.current?.focus({ focusVisible: true } as FocusOptions);
    }
  }, [open]);

  const focusAdjacentButton = (event: React.KeyboardEvent<HTMLElement>) => {
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") {
      return;
    }

    event.preventDefault();
    const order = [cancelButtonRef, discardButtonRef, saveButtonRef];
    const currentIndex = order.findIndex((ref) => ref.current === event.currentTarget);
    if (currentIndex === -1) {
      return;
    }

    const delta = event.key === "ArrowRight" ? 1 : -1;
    const nextIndex = (currentIndex + delta + order.length) % order.length;
    order[nextIndex].current?.focus();
  };

  const dismissProps = useDismissOnOverlayClick(isSaving ? null : onCancel);

  if (!open) {
    return null;
  }

  return (
    <div
      className="unsaved-dialog"
      role="presentation"
      {...dismissProps}
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
          {fileLabel
            ? t("unsavedDialog.descriptionCurrent", { fileLabel })
            : t("unsavedDialog.descriptionGeneric")}
        </p>

        <div className="unsaved-dialog__actions">
          <Button
            ref={cancelButtonRef}
            type="button"
            variant="outline"
            onClick={onCancel}
            onKeyDown={focusAdjacentButton}
            disabled={isSaving}
          >
            {t("common.cancel")}
          </Button>
          <Button
            ref={discardButtonRef}
            type="button"
            variant="secondary"
            onClick={onDiscard}
            onKeyDown={focusAdjacentButton}
            disabled={isSaving}
          >
            {t("common.discard")}
          </Button>
          <Button
            ref={saveButtonRef}
            type="button"
            onClick={onSave}
            onKeyDown={focusAdjacentButton}
            disabled={isSaving}
          >
            {isSaving ? t("common.saving") : t("common.save")}
          </Button>
        </div>
      </div>
    </div>
  );
}
