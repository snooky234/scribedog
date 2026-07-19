import { useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";

import { Button } from "@/components/ui/button";

type DeleteFileDialogProps = {
  open: boolean;
  kind?: "file" | "folder";
  fileLabel: string | null;
  count?: number;
  isDeleting: boolean;
  onConfirm: () => void;
  onCancel: () => void;
};

export function DeleteFileDialog({
  open,
  kind = "file",
  fileLabel,
  count,
  isDeleting,
  onConfirm,
  onCancel
}: DeleteFileDialogProps) {
  const { t } = useTranslation();
  const cancelButtonRef = useRef<HTMLElement>(null);
  const confirmButtonRef = useRef<HTMLElement>(null);

  useEffect(() => {
    if (!open) {
      return;
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !isDeleting) {
        event.preventDefault();
        onCancel();
      }
    };

    window.addEventListener("keydown", handleKeyDown);

    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [open, isDeleting, onCancel]);

  // Cancel is the safer default for a destructive confirmation, so it
  // receives focus on open; Tab/arrow keys move to Delete from there.
  useEffect(() => {
    if (open) {
      cancelButtonRef.current?.focus();
    }
  }, [open]);

  const focusOtherButton = (event: React.KeyboardEvent<HTMLElement>) => {
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") {
      return;
    }

    event.preventDefault();
    const target = event.currentTarget === cancelButtonRef.current ? confirmButtonRef : cancelButtonRef;
    target.current?.focus();
  };

  if (!open) {
    return null;
  }

  return (
    <div
      className="unsaved-dialog"
      role="presentation"
      onClick={() => {
        if (!isDeleting) {
          onCancel();
        }
      }}
    >
      <div
        className="unsaved-dialog__panel"
        role="dialog"
        aria-modal="true"
        aria-labelledby="delete-dialog-title"
        aria-describedby="delete-dialog-description"
        onClick={(event) => event.stopPropagation()}
      >
        <p className="unsaved-dialog__eyebrow">
          {count !== undefined && count > 1
            ? t("deleteDialog.eyebrowMultiple")
            : t(kind === "folder" ? "deleteDialog.eyebrowFolder" : "deleteDialog.eyebrow")}
        </p>
        <h3 id="delete-dialog-title">
          {count !== undefined && count > 1
            ? t("deleteDialog.titleMultiple")
            : t(kind === "folder" ? "deleteDialog.titleFolder" : "deleteDialog.title")}
        </h3>
        <p id="delete-dialog-description" className="unsaved-dialog__description">
          {count !== undefined && count > 1
            ? t("deleteDialog.descriptionMultiple", { count })
            : kind === "folder"
              ? fileLabel
                ? t("deleteDialog.descriptionFolderWithName", { folderLabel: fileLabel })
                : t("deleteDialog.descriptionFolderGeneric")
              : fileLabel
                ? t("deleteDialog.descriptionWithName", { fileLabel })
                : t("deleteDialog.descriptionGeneric")}
        </p>

        <div className="unsaved-dialog__actions">
          <Button
            ref={cancelButtonRef}
            type="button"
            variant="outline"
            onClick={onCancel}
            onKeyDown={focusOtherButton}
            disabled={isDeleting}
          >
            {t("common.cancel")}
          </Button>
          <Button
            ref={confirmButtonRef}
            type="button"
            variant="destructive"
            onClick={onConfirm}
            onKeyDown={focusOtherButton}
            disabled={isDeleting}
          >
            {isDeleting ? t("common.deleting") : t("common.delete")}
          </Button>
        </div>
      </div>
    </div>
  );
}
