import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

import { SettingRow } from "@/components/settings/SettingRow";
import { Button } from "@/components/ui/button";
import {
  countAllVersions,
  deleteAllVersions,
  MAX_VERSIONS_PER_FILE_MAX,
  MAX_VERSIONS_PER_FILE_MIN
} from "@/lib/fileVersions";
import { formatBinding } from "@/lib/shortcuts/binding";
import { resolveBinding } from "@/lib/shortcuts/resolve";
import { useAppStore } from "@/store/useAppStore";
import { useShortcutsStore } from "@/store/useShortcutsStore";
import { useVersioningSettingsStore } from "@/store/useVersioningSettingsStore";

/**
 * The "Versioning" settings tab. Like the theme and update settings, these
 * apply immediately through their own store rather than through the AI
 * settings' save button.
 */
export function VersioningSettings() {
  const { t } = useTranslation();
  const folderPath = useAppStore((state) => state.folderPath);
  // Auto-save changes when a version is taken. The rule is always shown, not
  // only while auto-save is on: it is toggled per session, and whoever turns
  // it on later should already have read what it does to the history.
  const shortcutOverrides = useShortcutsStore((state) => state.overrides);
  const saveBinding = resolveBinding(shortcutOverrides, "saveFile");
  const versioningEnabled = useVersioningSettingsStore((state) => state.versioningEnabled);
  const setVersioningEnabled = useVersioningSettingsStore((state) => state.setVersioningEnabled);
  const maxVersionsPerFile = useVersioningSettingsStore((state) => state.maxVersionsPerFile);
  const setMaxVersionsPerFile = useVersioningSettingsStore((state) => state.setMaxVersionsPerFile);

  const [maxVersionsDraft, setMaxVersionsDraft] = useState(String(maxVersionsPerFile));
  const [storedVersionCount, setStoredVersionCount] = useState<number | null>(null);
  const [isConfirmingDelete, setIsConfirmingDelete] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);

  useEffect(() => {
    if (!folderPath) {
      setStoredVersionCount(0);
      return;
    }

    let isCurrent = true;

    void countAllVersions(folderPath)
      .then((count) => {
        if (isCurrent) {
          setStoredVersionCount(count);
        }
      })
      .catch(() => {
        if (isCurrent) {
          setStoredVersionCount(0);
        }
      });

    return () => {
      isCurrent = false;
    };
  }, [folderPath]);

  // The settings dialog closes itself on Escape via a window listener. While
  // the confirmation is up, Escape has to dismiss that instead — captured
  // here before the dialog's listener sees it.
  useEffect(() => {
    if (!isConfirmingDelete) {
      return;
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") {
        return;
      }

      event.preventDefault();
      event.stopPropagation();

      if (!isDeleting) {
        setIsConfirmingDelete(false);
      }
    };

    window.addEventListener("keydown", handleKeyDown, true);

    return () => window.removeEventListener("keydown", handleKeyDown, true);
  }, [isConfirmingDelete, isDeleting]);

  const commitMaxVersions = () => {
    const parsed = Number.parseInt(maxVersionsDraft, 10);
    setMaxVersionsPerFile(Number.isFinite(parsed) ? parsed : maxVersionsPerFile);
    setMaxVersionsDraft(
      String(
        Number.isFinite(parsed)
          ? Math.min(MAX_VERSIONS_PER_FILE_MAX, Math.max(MAX_VERSIONS_PER_FILE_MIN, parsed))
          : maxVersionsPerFile
      )
    );
  };

  const handleDeleteAll = async () => {
    if (!folderPath) {
      return;
    }

    setIsDeleting(true);

    try {
      await deleteAllVersions(folderPath);
      setStoredVersionCount(0);
    } finally {
      setIsDeleting(false);
      setIsConfirmingDelete(false);
    }
  };

  return (
    <>
      {/* The one entry in the folder group that is not per folder: the
          switch is app-wide, only the versions themselves live in the
          folder. Said up front, because the neighbouring entries say the
          opposite. */}
      <p className="settings-intro">{t("versioningSettings.scope")}</p>

      <div className="ai-dialog__grid">
        <SettingRow
          layout="switch"
          label={t("versioningSettings.enable")}
          hint={`${t("versioningSettings.enableShort")} ${
            saveBinding
              ? t("versioningSettings.enableShortAutoSave", { keys: formatBinding(t, saveBinding) })
              : t("versioningSettings.enableShortAutoSaveUnbound")
          }`}
          info={t("versioningSettings.enableHint")}
        >
          <input
            type="checkbox"
            checked={versioningEnabled}
            onChange={(event) => setVersioningEnabled(event.target.checked)}
          />
        </SettingRow>

        <SettingRow label={t("versioningSettings.maxVersions")} hint={t("versioningSettings.maxVersionsShort")}>
          <input
            type="number"
            min={MAX_VERSIONS_PER_FILE_MIN}
            max={MAX_VERSIONS_PER_FILE_MAX}
            step={1}
            value={maxVersionsDraft}
            onChange={(event) => setMaxVersionsDraft(event.target.value)}
            onBlur={commitMaxVersions}
          />
        </SettingRow>
      </div>

      <div className="versioning-settings__footer">
        <span className="versioning-settings__count">
          {folderPath === null
            ? t("versioningSettings.noFolder")
            : t("versioningSettings.storedCount", { count: storedVersionCount ?? 0 })}
        </span>
        <Button
          type="button"
          variant="destructive"
          disabled={folderPath === null || (storedVersionCount ?? 0) === 0}
          onClick={() => setIsConfirmingDelete(true)}
        >
          {t("versioningSettings.deleteAll")}
        </Button>
      </div>

      {isConfirmingDelete ? (
        <div
          className="unsaved-dialog"
          role="presentation"
          onClick={() => {
            if (!isDeleting) {
              setIsConfirmingDelete(false);
            }
          }}
        >
          <div
            className="unsaved-dialog__panel"
            role="dialog"
            aria-modal="true"
            aria-labelledby="delete-versions-title"
            onClick={(event) => event.stopPropagation()}
          >
            <p className="unsaved-dialog__eyebrow">{t("versioningSettings.deleteAllEyebrow")}</p>
            <h3 id="delete-versions-title">{t("versioningSettings.deleteAllTitle")}</h3>
            <p className="unsaved-dialog__description">
              {t("versioningSettings.deleteAllDescription", { count: storedVersionCount ?? 0 })}
            </p>

            <div className="unsaved-dialog__actions">
              <Button
                type="button"
                variant="outline"
                disabled={isDeleting}
                onClick={() => setIsConfirmingDelete(false)}
              >
                {t("common.cancel")}
              </Button>
              <Button
                type="button"
                variant="destructive"
                disabled={isDeleting}
                onClick={() => void handleDeleteAll()}
              >
                {isDeleting ? t("common.deleting") : t("common.delete")}
              </Button>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
