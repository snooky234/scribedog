import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";
import { RotateCcw } from "lucide-react";

import { Button } from "@/components/ui/button";
import { bindingFromEvent, formatBinding, hasPrimaryModifier } from "@/lib/shortcuts/binding";
import {
  SHORTCUT_CATEGORY_ORDER,
  SHORTCUT_DEFINITIONS,
  SHORTCUT_DEFINITIONS_BY_ID,
  type ShortcutActionId,
  type ShortcutCategory
} from "@/lib/shortcuts/definitions";
import { findConflict, isCustomBinding, resolveBinding } from "@/lib/shortcuts/resolve";
import { useShortcutsStore } from "@/store/useShortcutsStore";

type ShortcutsDialogProps = {
  open: boolean;
  onClose: () => void;
};

type KeyToken = { mod: "ctrl" | "alt" | "shift" } | { special: "esc" | "enter" | "rightClick" } | { literal: string };

/**
 * Shortcuts that stay as they are: either the platform owns them (clipboard,
 * undo) or they are a fixed part of an interaction (Tab indent, Esc closes).
 * They are listed for reference but have no editing affordance.
 */
const FIXED_SHORTCUTS: { id: string; keys: KeyToken[]; descriptionKey: string }[] = [
  { id: "renameEntry", keys: [{ literal: "F2" }], descriptionKey: "shortcutsDialog.items.renameEntry" },
  {
    id: "aiEditContextMenu",
    keys: [{ special: "rightClick" }],
    descriptionKey: "shortcutsDialog.items.aiEditDialog"
  },
  { id: "aiSubmit", keys: [{ mod: "ctrl" }, { special: "enter" }], descriptionKey: "shortcutsDialog.items.aiSubmit" },
  // Not a key combination but typed text, so it can neither be rebound nor
  // conflict with one — it still belongs in this list to be discoverable.
  { id: "insertFileLink", keys: [{ literal: "[[" }], descriptionKey: "shortcutsDialog.items.insertFileLink" },
  { id: "indentIncrease", keys: [{ literal: "Tab" }], descriptionKey: "shortcutsDialog.items.indentIncrease" },
  {
    id: "indentDecrease",
    keys: [{ mod: "shift" }, { literal: "Tab" }],
    descriptionKey: "shortcutsDialog.items.indentDecrease"
  },
  { id: "copy", keys: [{ mod: "ctrl" }, { literal: "C" }], descriptionKey: "shortcutsDialog.items.copy" },
  { id: "paste", keys: [{ mod: "ctrl" }, { literal: "V" }], descriptionKey: "shortcutsDialog.items.paste" },
  { id: "undo", keys: [{ mod: "ctrl" }, { literal: "Z" }], descriptionKey: "shortcutsDialog.items.undo" },
  { id: "redo", keys: [{ mod: "ctrl" }, { literal: "Y" }], descriptionKey: "shortcutsDialog.items.redo" },
  { id: "closeDialog", keys: [{ special: "esc" }], descriptionKey: "shortcutsDialog.items.closeDialog" }
];

function formatKeyCombo(t: TFunction, tokens: KeyToken[]): string {
  return tokens
    .map((token) => {
      if ("mod" in token) {
        return t(`common.keys.${token.mod}`);
      }

      if ("special" in token) {
        return t(`common.keys.${token.special}`);
      }

      return token.literal;
    })
    .join(" + ");
}

type RecordingError =
  | { kind: "needsModifier" }
  | { kind: "conflict"; conflictingAction: ShortcutActionId };

export function ShortcutsDialog({ open, onClose }: ShortcutsDialogProps) {
  const { t } = useTranslation();
  const overrides = useShortcutsStore((state) => state.overrides);
  const saveError = useShortcutsStore((state) => state.saveError);
  const setBinding = useShortcutsStore((state) => state.setBinding);
  const resetBinding = useShortcutsStore((state) => state.resetBinding);
  const resetAllBindings = useShortcutsStore((state) => state.resetAllBindings);

  const [recordingId, setRecordingId] = useState<ShortcutActionId | null>(null);
  const [recordingError, setRecordingError] = useState<RecordingError | null>(null);

  const stopRecording = () => {
    setRecordingId(null);
    setRecordingError(null);
  };

  // Reopening the dialog must never resume a half-finished recording.
  useEffect(() => {
    if (!open) {
      stopRecording();
    }
  }, [open]);

  useEffect(() => {
    if (!open || recordingId) {
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
  }, [open, recordingId, onClose]);

  // While recording, every keystroke belongs to the recorder — capture phase
  // plus stopImmediatePropagation keeps the app's own shortcuts (and the
  // webview) from acting on the combo being assigned.
  useEffect(() => {
    if (!open || !recordingId) {
      return;
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      event.preventDefault();
      event.stopImmediatePropagation();

      if (event.key === "Escape") {
        stopRecording();
        return;
      }

      const binding = bindingFromEvent(event);

      if (!binding) {
        // Only modifiers held so far — keep waiting for the actual key.
        return;
      }

      if (!hasPrimaryModifier(binding)) {
        setRecordingError({ kind: "needsModifier" });
        return;
      }

      const conflictingAction = findConflict(overrides, recordingId, binding);

      if (conflictingAction) {
        setRecordingError({ kind: "conflict", conflictingAction });
        return;
      }

      void setBinding(recordingId, binding);
      stopRecording();
    };

    window.addEventListener("keydown", handleKeyDown, { capture: true });

    return () => window.removeEventListener("keydown", handleKeyDown, { capture: true });
  }, [open, recordingId, overrides, setBinding]);

  if (!open) {
    return null;
  }

  const hasCustomBindings = SHORTCUT_DEFINITIONS.some((definition) =>
    isCustomBinding(overrides, definition.id)
  );

  const conflictLabel =
    recordingError?.kind === "conflict"
      ? t(SHORTCUT_DEFINITIONS_BY_ID.get(recordingError.conflictingAction)!.descriptionKey)
      : "";

  const renderCategory = (category: ShortcutCategory) => {
    const definitions = SHORTCUT_DEFINITIONS.filter((definition) => definition.category === category);

    return (
      <section key={category} className="shortcuts-section">
        <h4 className="shortcuts-section__title">{t(`shortcutsDialog.categories.${category}`)}</h4>
        <ul className="shortcuts-list">
          {definitions.map((definition) => {
            const isRecording = recordingId === definition.id;
            const isCustom = isCustomBinding(overrides, definition.id);

            return (
              <li key={definition.id} className="shortcuts-list__item">
                <span className="shortcuts-list__label">{t(definition.descriptionKey)}</span>
                <span className="shortcuts-list__keys-group">
                  <button
                    type="button"
                    className="shortcuts-list__keys shortcuts-list__keys--editable"
                    data-recording={isRecording ? "true" : undefined}
                    aria-label={t("shortcutsDialog.record", { action: t(definition.descriptionKey) })}
                    onClick={() => {
                      setRecordingError(null);
                      setRecordingId(isRecording ? null : definition.id);
                    }}
                  >
                    {isRecording
                      ? t("shortcutsDialog.recording")
                      : formatBinding(t, resolveBinding(overrides, definition.id))}
                  </button>
                  <button
                    type="button"
                    className="shortcuts-list__reset"
                    disabled={!isCustom}
                    aria-label={t("shortcutsDialog.resetOne", { action: t(definition.descriptionKey) })}
                    title={t("shortcutsDialog.resetOne", { action: t(definition.descriptionKey) })}
                    onClick={() => {
                      stopRecording();
                      void resetBinding(definition.id);
                    }}
                  >
                    <RotateCcw aria-hidden="true" />
                  </button>
                </span>
              </li>
            );
          })}
        </ul>
      </section>
    );
  };

  return (
    <div className="ai-dialog" role="presentation" onClick={onClose}>
      <div
        className="ai-dialog__panel"
        role="dialog"
        aria-modal="true"
        aria-labelledby="shortcuts-title"
        onClick={(event) => event.stopPropagation()}
      >
        <h3 id="shortcuts-title">{t("shortcutsDialog.title")}</h3>
        <p className="ai-dialog__description">{t("shortcutsDialog.description")}</p>

        <p className="shortcuts-hint" role="status">
          {recordingError?.kind === "needsModifier"
            ? t("shortcutsDialog.errorNeedsModifier")
            : recordingError?.kind === "conflict"
              ? t("shortcutsDialog.errorConflict", { action: conflictLabel })
              : recordingId
                ? t("shortcutsDialog.recordHint")
                : t("shortcutsDialog.customizeHint")}
        </p>

        {saveError ? (
          <p className="shortcuts-hint shortcuts-hint--error">
            {t("shortcutsDialog.saveError", { message: saveError })}
          </p>
        ) : null}

        {SHORTCUT_CATEGORY_ORDER.map(renderCategory)}

        <section className="shortcuts-section">
          <h4 className="shortcuts-section__title">{t("shortcutsDialog.categories.fixed")}</h4>
          <ul className="shortcuts-list">
            {FIXED_SHORTCUTS.map((shortcut) => (
              <li key={shortcut.id} className="shortcuts-list__item">
                <span className="shortcuts-list__label">{t(shortcut.descriptionKey)}</span>
                <span className="shortcuts-list__keys-group">
                  <kbd className="shortcuts-list__keys">{formatKeyCombo(t, shortcut.keys)}</kbd>
                </span>
              </li>
            ))}
          </ul>
        </section>

        <div className="ai-dialog__actions">
          <Button
            type="button"
            variant="outline"
            disabled={!hasCustomBindings}
            onClick={() => {
              stopRecording();
              void resetAllBindings();
            }}
          >
            <RotateCcw aria-hidden="true" />
            {t("shortcutsDialog.resetAll")}
          </Button>
          <Button type="button" onClick={onClose}>
            {t("common.close")}
          </Button>
        </div>
      </div>
    </div>
  );
}
