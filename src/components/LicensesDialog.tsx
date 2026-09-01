import { useEffect, useState } from "react";
import { X } from "lucide-react";
import { useTranslation } from "react-i18next";

import { Button } from "@/components/ui/button";

type LicensesDialogProps = {
  open: boolean;
  onClose: () => void;
};

/**
 * Shows THIRD_PARTY_LICENSES.md inside the app. The text is bundled rather
 * than read from a file next to the binary, which is what lets the portable
 * build be a single executable — and it replaces handing ~8500 lines of raw
 * Markdown to whatever the system has registered for .md files.
 *
 * Escape is handled by SettingsDialog, which owns this dialog's open state.
 */
export function LicensesDialog({ open, onClose }: LicensesDialogProps) {
  const { t } = useTranslation();
  const [content, setContent] = useState<string | null>(null);

  // A dynamic import puts the license text in its own chunk: it ships inside
  // the executable either way, but nobody pays for it at startup.
  useEffect(() => {
    if (!open || content !== null) {
      return;
    }

    let active = true;

    void import("../../THIRD_PARTY_LICENSES.md?raw").then((module) => {
      if (active) {
        setContent(module.default);
      }
    });

    return () => {
      active = false;
    };
  }, [open, content]);

  if (!open) {
    return null;
  }

  return (
    <div className="ai-dialog" role="presentation" onClick={onClose}>
      <div
        className="ai-dialog__panel ai-dialog__panel--licenses"
        role="dialog"
        aria-modal="true"
        aria-labelledby="licenses-title"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="licenses-dialog__header">
          <h3 id="licenses-title">{t("settingsDialog.openSourceLicenses")}</h3>
          <Button
            type="button"
            variant="ghost"
            size="icon-xs"
            onClick={onClose}
            aria-label={t("common.close")}
          >
            <X />
          </Button>
        </div>

        <pre className="licenses-dialog__content">
          {content ?? t("settingsDialog.licensesLoading")}
        </pre>
      </div>
    </div>
  );
}
