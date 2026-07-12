import {
  Bold,
  Brain,
  Code,
  Code2,
  CheckSquare,
  Heading1,
  Heading2,
  Heading3,
  Italic,
  Link2,
  List,
  ListOrdered,
  PawPrint,
  Quote,
  Strikethrough,
  Underline
} from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";

import type { Editor } from "@tiptap/react";

import { Button } from "@/components/ui/button";
import { Toggle } from "@/components/ui/toggle";
import { EmojiPicker } from "@/components/EmojiPicker";
import { TableGridPicker } from "@/components/TableGridPicker";
import { TableMenu } from "@/components/TableMenu";
import { useAiModelsStore } from "@/store/useAiModelsStore";
import { useAiSettingsStore } from "@/store/useAiSettingsStore";

type ToolbarProps = {
  editor: Editor;
  onLinkRequest: () => void;
  onAiRequest: () => void;
  onAiSettingsRequest: () => void;
};

const OPEN_AI_SETTINGS_VALUE = "__open-ai-settings__";

type ToggleButtonProps = {
  pressed: boolean;
  label: string;
  title: string;
  onClick: () => void;
  children: ReactNode;
};

function ToggleButton({
  pressed,
  label,
  title,
  onClick,
  children
}: ToggleButtonProps) {
  return (
    <Toggle
      pressed={pressed}
      aria-label={label}
      title={title}
      onClick={onClick}
    >
      {children}
    </Toggle>
  );
}

function AiQuickSettings({ onAiSettingsRequest }: { onAiSettingsRequest: () => void }) {
  const { t } = useTranslation();
  const settings = useAiSettingsStore((state) => state.settings);
  const updateSettings = useAiSettingsStore((state) => state.updateSettings);
  // The central store is the single source for the model list — the toolbar
  // deliberately keeps no fetch state of its own, so it can never show a
  // different (stale) list than the rest of the app.
  const models = useAiModelsStore((state) => state.models);
  const refreshModels = useAiModelsStore((state) => state.refreshModels);

  useEffect(() => {
    void refreshModels({
      provider: settings.provider,
      apiUrl: settings.apiUrl,
      apiKey: settings.apiKey
    });
  }, [refreshModels, settings.provider, settings.apiUrl, settings.apiKey]);

  const thinkingEnabled = settings.thinkingMode !== "off";
  // The currently selected model stays selectable even if the endpoint
  // doesn't (currently) list it — otherwise the selection would silently flip.
  const options =
    settings.model && !models.includes(settings.model)
      ? [settings.model, ...models]
      : models;

  return (
    <>
      <select
        className="editor-toolbar__model-select"
        aria-label={t("toolbar.aiModel")}
        title={t("toolbar.aiModel")}
        value={settings.model}
        onChange={(event) => {
          const value = event.target.value;
          if (value === OPEN_AI_SETTINGS_VALUE) {
            onAiSettingsRequest();
            return;
          }
          updateSettings({ model: value });
        }}
      >
        {settings.model ? null : (
          <option value="" disabled>
            {t("toolbar.aiModelPlaceholder")}
          </option>
        )}
        <option value={OPEN_AI_SETTINGS_VALUE}>{t("toolbar.aiOpenSettings")}</option>
        {options.length > 0 ? (
          <optgroup label={t("toolbar.aiModelsGroup")}>
            {options.map((model) => (
              <option key={model} value={model}>
                {model}
              </option>
            ))}
          </optgroup>
        ) : null}
      </select>
      <Toggle
        pressed={thinkingEnabled}
        className="editor-toolbar__thinking-toggle"
        aria-label={t("toolbar.aiThinking")}
        title={thinkingEnabled ? t("toolbar.aiThinkingOn") : t("toolbar.aiThinkingOff")}
        onClick={() => {
          updateSettings({ thinkingMode: thinkingEnabled ? "off" : "default" });
        }}
      >
        <Brain />
      </Toggle>
    </>
  );
}

export function Toolbar({
  editor,
  onLinkRequest,
  onAiRequest,
  onAiSettingsRequest
}: ToolbarProps) {
  const { t } = useTranslation();
  const [, forceRerender] = useState(0);

  useEffect(() => {
    const rerender = () => {
      forceRerender((current) => current + 1);
    };

    editor.on("selectionUpdate", rerender);
    editor.on("transaction", rerender);

    return () => {
      editor.off("selectionUpdate", rerender);
      editor.off("transaction", rerender);
    };
  }, [editor]);

  return (
    <div className="editor-toolbar" aria-label={t("toolbar.formattingLabel")}>
      <div className="editor-toolbar__group">
        <Button
          type="button"
          size="sm"
          aria-label={t("toolbar.aiButton")}
          title={t("toolbar.aiButtonTitle")}
          className="editor-toolbar__ai-button"
          onMouseDown={(event) => {
            event.preventDefault();
          }}
          onClick={onAiRequest}
        >
          <PawPrint />
          {t("toolbar.aiButtonLabel")}
        </Button>
        <AiQuickSettings onAiSettingsRequest={onAiSettingsRequest} />
      </div>

      <div className="editor-toolbar__separator" aria-hidden="true" />

      <div className="editor-toolbar__group">
        <ToggleButton
          pressed={editor.isActive("bold")}
          label={t("toolbar.bold")}
          title={t("toolbar.bold")}
          onClick={() => {
            editor.chain().focus().toggleBold().run();
          }}
        >
          <Bold />
        </ToggleButton>
        <ToggleButton
          pressed={editor.isActive("italic")}
          label={t("toolbar.italic")}
          title={t("toolbar.italic")}
          onClick={() => {
            editor.chain().focus().toggleItalic().run();
          }}
        >
          <Italic />
        </ToggleButton>
        <ToggleButton
          pressed={editor.isActive("strike")}
          label={t("toolbar.strikethrough")}
          title={t("toolbar.strikethrough")}
          onClick={() => {
            editor.chain().focus().toggleStrike().run();
          }}
        >
          <Strikethrough />
        </ToggleButton>
        <ToggleButton
          pressed={editor.isActive("underline")}
          label={t("toolbar.underline")}
          title={t("toolbar.underline")}
          onClick={() => {
            editor.chain().focus().toggleUnderline().run();
          }}
        >
          <Underline />
        </ToggleButton>
      </div>

      <div className="editor-toolbar__separator" aria-hidden="true" />

      <div className="editor-toolbar__group">
        <ToggleButton
          pressed={editor.isActive("heading", { level: 1 })}
          label={t("toolbar.heading1")}
          title={t("toolbar.heading1")}
          onClick={() => {
            editor.chain().focus().toggleHeading({ level: 1 }).run();
          }}
        >
          <Heading1 />
        </ToggleButton>
        <ToggleButton
          pressed={editor.isActive("heading", { level: 2 })}
          label={t("toolbar.heading2")}
          title={t("toolbar.heading2")}
          onClick={() => {
            editor.chain().focus().toggleHeading({ level: 2 }).run();
          }}
        >
          <Heading2 />
        </ToggleButton>
        <ToggleButton
          pressed={editor.isActive("heading", { level: 3 })}
          label={t("toolbar.heading3")}
          title={t("toolbar.heading3")}
          onClick={() => {
            editor.chain().focus().toggleHeading({ level: 3 }).run();
          }}
        >
          <Heading3 />
        </ToggleButton>
      </div>

      <div className="editor-toolbar__separator" aria-hidden="true" />

      <div className="editor-toolbar__group">
        <ToggleButton
          pressed={editor.isActive("bulletList")}
          label={t("toolbar.bulletList")}
          title={t("toolbar.bulletList")}
          onClick={() => {
            editor.chain().focus().toggleBulletList().run();
          }}
        >
          <List />
        </ToggleButton>
        <ToggleButton
          pressed={editor.isActive("orderedList")}
          label={t("toolbar.orderedList")}
          title={t("toolbar.orderedList")}
          onClick={() => {
            editor.chain().focus().toggleOrderedList().run();
          }}
        >
          <ListOrdered />
        </ToggleButton>
        <ToggleButton
          pressed={editor.isActive("taskList")}
          label={t("toolbar.taskList")}
          title={t("toolbar.taskListTitle")}
          onClick={() => {
            editor.chain().focus().toggleTaskList().run();
          }}
        >
          <CheckSquare />
        </ToggleButton>
        <ToggleButton
          pressed={editor.isActive("blockquote")}
          label={t("toolbar.blockquote")}
          title={t("toolbar.blockquote")}
          onClick={() => {
            editor.chain().focus().toggleBlockquote().run();
          }}
        >
          <Quote />
        </ToggleButton>
      </div>

      <div className="editor-toolbar__separator" aria-hidden="true" />

      <div className="editor-toolbar__group">
        <ToggleButton
          pressed={editor.isActive("code")}
          label={t("toolbar.inlineCode")}
          title={t("toolbar.inlineCode")}
          onClick={() => {
            editor.chain().focus().toggleCode().run();
          }}
        >
          <Code />
        </ToggleButton>
        <ToggleButton
          pressed={editor.isActive("codeBlock")}
          label={t("toolbar.codeBlock")}
          title={t("toolbar.codeBlock")}
          onClick={() => {
            editor.chain().focus().toggleCodeBlock().run();
          }}
        >
          <Code2 />
        </ToggleButton>
        <ToggleButton
          pressed={editor.isActive("link")}
          label={t("toolbar.insertLink")}
          title={t("toolbar.insertLink")}
          onClick={onLinkRequest}
        >
          <Link2 />
        </ToggleButton>
      </div>

      <div className="editor-toolbar__separator" aria-hidden="true" />

      <div className="editor-toolbar__group">
        <TableGridPicker editor={editor} />
        {editor.isActive("table") ? <TableMenu editor={editor} /> : null}
        <EmojiPicker editor={editor} />
      </div>
    </div>
  );
}
