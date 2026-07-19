import { useState } from "react";
import { Pencil, Plus, Trash2 } from "lucide-react";
import { useTranslation } from "react-i18next";

import { Button } from "@/components/ui/button";
import {
  DEFAULT_ASSISTANT_ID,
  useAssistantsStore,
  type Assistant
} from "@/store/useAssistantsStore";

type AssistantsSettingsProps = {
  // null requests creating a new assistant. Editing happens in its own modal
  // dialog on top of the app, so the settings dialog gets closed meanwhile.
  onEditRequest: (assistant: Assistant | null) => void;
};

export function AssistantsSettings({ onEditRequest }: AssistantsSettingsProps) {
  const { t } = useTranslation();
  const assistants = useAssistantsStore((state) => state.assistants);
  const removeAssistant = useAssistantsStore((state) => state.removeAssistant);

  const [pendingDelete, setPendingDelete] = useState<Assistant | null>(null);

  const displayName = (assistant: Assistant) =>
    assistant.id === DEFAULT_ASSISTANT_ID && !assistant.name
      ? t("assistants.defaultName")
      : assistant.name;

  return (
    <div className="assistants">
      <ul className="assistants__list">
        {assistants.map((assistant) => (
          <li key={assistant.id} className="assistants__item">
            <button
              type="button"
              className="assistants__item-main"
              onClick={() => onEditRequest(assistant)}
              title={t("assistants.editAssistant")}
            >
              <span className="assistants__item-emoji" aria-hidden="true">
                {assistant.emoji || "•"}
              </span>
              <span className="assistants__item-text">
                <span className="assistants__item-name">{displayName(assistant)}</span>
                {assistant.description ? (
                  <span className="assistants__item-description">{assistant.description}</span>
                ) : null}
              </span>
            </button>
            <span className="assistants__item-actions">
              <Button
                type="button"
                size="sm"
                variant="outline"
                aria-label={t("assistants.editAssistant")}
                title={t("assistants.editAssistant")}
                onClick={() => onEditRequest(assistant)}
              >
                <Pencil />
              </Button>
              {assistant.id !== DEFAULT_ASSISTANT_ID ? (
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  aria-label={t("assistants.deleteAssistant")}
                  title={t("assistants.deleteAssistant")}
                  onClick={() => setPendingDelete(assistant)}
                >
                  <Trash2 />
                </Button>
              ) : null}
            </span>
          </li>
        ))}
      </ul>
      <Button type="button" variant="outline" onClick={() => onEditRequest(null)}>
        <Plus />
        {t("assistants.addAssistant")}
      </Button>

      {pendingDelete ? (
        <div className="unsaved-dialog" role="presentation" onClick={() => setPendingDelete(null)}>
          <div
            className="unsaved-dialog__panel"
            role="dialog"
            aria-modal="true"
            aria-labelledby="assistant-delete-title"
            aria-describedby="assistant-delete-description"
            onClick={(event) => event.stopPropagation()}
          >
            <h3 id="assistant-delete-title">{t("assistants.deleteConfirmTitle")}</h3>
            <p id="assistant-delete-description" className="unsaved-dialog__description">
              {t("assistants.deleteConfirmDescription", { name: displayName(pendingDelete) })}
            </p>

            <div className="unsaved-dialog__actions">
              <Button type="button" variant="outline" onClick={() => setPendingDelete(null)}>
                {t("common.cancel")}
              </Button>
              <Button
                type="button"
                variant="destructive"
                onClick={() => {
                  removeAssistant(pendingDelete.id);
                  setPendingDelete(null);
                }}
              >
                {t("common.delete")}
              </Button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
