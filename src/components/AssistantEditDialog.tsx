import { useEffect, useRef, useState } from "react";
import { RotateCcw } from "lucide-react";
import { useTranslation } from "react-i18next";

import { Button } from "@/components/ui/button";
import { EmojiPicker } from "@/components/EmojiPicker";
import { DEFAULT_ASSISTANT_INSTRUCTION } from "@/lib/aiClient";
import {
  DEFAULT_ASSISTANT_ID,
  useAssistantsStore,
  type Assistant
} from "@/store/useAssistantsStore";

type AssistantEditDialogProps = {
  open: boolean;
  // null: create a new assistant.
  assistant: Assistant | null;
  onClose: () => void;
};

// Grows with its content so long instructions stay fully visible while
// short ones don't waste dialog space.
function AutoGrowTextarea({
  value,
  onChange,
  placeholder
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
}) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    const textarea = textareaRef.current;

    if (!textarea) {
      return;
    }

    textarea.style.height = "auto";
    textarea.style.height = `${textarea.scrollHeight}px`;
  }, [value]);

  return (
    <textarea
      ref={textareaRef}
      className="assistants__instruction"
      rows={3}
      value={value}
      placeholder={placeholder}
      spellCheck={false}
      onChange={(event) => onChange(event.target.value)}
    />
  );
}

export function AssistantEditDialog({ open, assistant, onClose }: AssistantEditDialogProps) {
  const { t } = useTranslation();
  const addAssistant = useAssistantsStore((state) => state.addAssistant);
  const updateAssistant = useAssistantsStore((state) => state.updateAssistant);

  const isEditingDefault = assistant?.id === DEFAULT_ASSISTANT_ID;

  const [emoji, setEmoji] = useState("");
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [instruction, setInstruction] = useState("");

  useEffect(() => {
    if (!open) {
      return;
    }

    setEmoji(assistant?.emoji ?? "");
    setName(
      assistant
        ? assistant.id === DEFAULT_ASSISTANT_ID && !assistant.name
          ? t("assistants.defaultName")
          : assistant.name
        : ""
    );
    setDescription(assistant?.description ?? "");
    setInstruction(assistant?.instruction ?? "");
  }, [open, assistant, t]);

  useEffect(() => {
    if (!open) {
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
  }, [open, onClose]);

  if (!open) {
    return null;
  }

  const canSave = isEditingDefault || name.trim().length > 0;

  const save = () => {
    if (!canSave) {
      return;
    }

    const payload = {
      emoji,
      // The default assistant keeps its empty stored name so the localized
      // label stays language-aware.
      name: isEditingDefault ? "" : name.trim(),
      description: description.trim(),
      instruction: instruction.trim()
    };

    if (assistant) {
      updateAssistant(assistant.id, payload);
    } else {
      addAssistant(payload);
    }

    onClose();
  };

  return (
    <div className="ai-dialog" role="presentation" onClick={onClose}>
      <div
        className="ai-dialog__panel"
        role="dialog"
        aria-modal="true"
        aria-labelledby="assistant-edit-title"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="assistants__form-scroll">
          <h3 id="assistant-edit-title">
            {assistant ? t("assistants.editTitle") : t("assistants.newTitle")}
          </h3>

          <div className="assistants__form">
            <div className="assistants__form-row">
              <label className="ai-dialog__field assistants__emoji-field">
                <span>{t("assistants.emoji")}</span>
                <EmojiPicker
                  onSelect={setEmoji}
                  trigger={emoji ? <span aria-hidden="true">{emoji}</span> : undefined}
                />
              </label>
              <label className="ai-dialog__field assistants__name-field">
                <span>{t("assistants.name")}</span>
                <input
                  type="text"
                  value={name}
                  disabled={isEditingDefault}
                  placeholder={t("assistants.namePlaceholder")}
                  onChange={(event) => setName(event.target.value)}
                />
              </label>
            </div>

            <label className="ai-dialog__field ai-dialog__field--full">
              <span>{t("assistants.description")}</span>
              <input
                type="text"
                value={description}
                placeholder={t("assistants.descriptionPlaceholder")}
                onChange={(event) => setDescription(event.target.value)}
              />
            </label>

            <label className="ai-dialog__field ai-dialog__field--full">
              <span>{t("assistants.instruction")}</span>
              <AutoGrowTextarea
                value={instruction}
                placeholder={t("assistants.instructionPlaceholder")}
                onChange={setInstruction}
              />
            </label>
          </div>
        </div>

        <div className="assistants__form-actions">
          {isEditingDefault ? (
            <Button
              type="button"
              variant="outline"
              className="assistants__reset"
              onClick={() => setInstruction(DEFAULT_ASSISTANT_INSTRUCTION)}
            >
              <RotateCcw />
              {t("assistants.resetToDefault")}
            </Button>
          ) : null}
          <Button type="button" variant="outline" onClick={onClose}>
            {t("common.cancel")}
          </Button>
          <Button type="button" disabled={!canSave} onClick={save}>
            {t("common.save")}
          </Button>
        </div>
      </div>
    </div>
  );
}
