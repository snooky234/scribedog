import {
  Bold,
  Brain,
  Code,
  Code2,
  CheckSquare,
  EllipsisVertical,
  Heading1,
  Heading2,
  Heading3,
  Italic,
  Link2,
  List,
  ListOrdered,
  PawPrint,
  Printer,
  Quote,
  Search,
  SpellCheck,
  Strikethrough,
  Underline,
  X
} from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";

import type { Editor } from "@tiptap/react";

import { Button } from "@/components/ui/button";
import {
  Menu,
  MenuCheckboxItem,
  MenuCheckboxItemIndicator,
  MenuItem,
  MenuPopup,
  MenuPortal,
  MenuPositioner,
  MenuTrigger
} from "@/components/ui/menu";
import { Toggle } from "@/components/ui/toggle";
import { EmojiPicker } from "@/components/EmojiPicker";
import { TableGridPicker } from "@/components/TableGridPicker";
import { TableMenu } from "@/components/TableMenu";
import { ZoomControl } from "@/components/ZoomControl";
import { checkSpellcheckDictionary } from "@/lib/spellcheckDictionary";
import { useAiModelsStore } from "@/store/useAiModelsStore";
import { useAiSettingsStore } from "@/store/useAiSettingsStore";
import { useEditorSettingsStore } from "@/store/useEditorSettingsStore";

type ToolbarProps = {
  editor: Editor;
  onLinkRequest: () => void;
  onAiRequest: () => void;
  onAiCheckRequest: () => void;
  onAiSettingsRequest: () => void;
  onPrintRequest: () => void;
  onSearchRequest: () => void;
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

type MissingDictionary = {
  language: string;
  installCommand: string | null;
};

function EditorOptionsMenu({ onPrintRequest }: { onPrintRequest: () => void }) {
  const { t, i18n } = useTranslation();
  const spellcheckEnabled = useEditorSettingsStore((state) => state.spellcheckEnabled);
  const setSpellcheckEnabled = useEditorSettingsStore((state) => state.setSpellcheckEnabled);
  const [missingDictionary, setMissingDictionary] = useState<MissingDictionary | null>(null);

  const handleSpellcheckChange = (checked: boolean) => {
    setSpellcheckEnabled(checked);

    if (!checked) {
      return;
    }

    const language = i18n.resolvedLanguage ?? i18n.language;

    void checkSpellcheckDictionary(language).then((status) => {
      if (!status.available) {
        setMissingDictionary({ language, installCommand: status.installCommand });
      }
    });
  };

  return (
    <>
      <Menu>
        <MenuTrigger
          render={
            <Button
              type="button"
              size="icon-sm"
              variant="outline"
              aria-label={t("toolbar.optionsMenu")}
              title={t("toolbar.optionsMenu")}
              onMouseDown={(event) => {
                event.preventDefault();
              }}
            />
          }
        >
          <EllipsisVertical />
        </MenuTrigger>
        <MenuPortal>
          <MenuPositioner align="end">
            <MenuPopup>
              <MenuCheckboxItem
                checked={spellcheckEnabled}
                onCheckedChange={handleSpellcheckChange}
              >
                {t("toolbar.spellcheckToggle")}
                <MenuCheckboxItemIndicator />
              </MenuCheckboxItem>
              <MenuItem onClick={onPrintRequest}>
                <Printer className="size-4" />
                {t("toolbar.printButton")}
              </MenuItem>
            </MenuPopup>
          </MenuPositioner>
        </MenuPortal>
      </Menu>

      {missingDictionary
        ? createPortal(
            <div className="spellcheck-toast" role="status">
              <div className="spellcheck-toast__body">
                <span>{t("toolbar.spellcheckDictionaryMissing", { code: missingDictionary.language })}</span>
                {missingDictionary.installCommand ? (
                  <code className="spellcheck-toast__command">{missingDictionary.installCommand}</code>
                ) : null}
              </div>
              <button
                type="button"
                className="spellcheck-toast__dismiss"
                aria-label={t("updateNotification.dismiss")}
                onClick={() => setMissingDictionary(null)}
              >
                <X aria-hidden="true" />
              </button>
            </div>,
            document.body
          )
        : null}
    </>
  );
}

export function Toolbar({
  editor,
  onLinkRequest,
  onAiRequest,
  onAiCheckRequest,
  onAiSettingsRequest,
  onPrintRequest,
  onSearchRequest
}: ToolbarProps) {
  const { t } = useTranslation();
  const [, forceRerender] = useState(0);
  const hasSelection = !editor.state.selection.empty;

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
        {/* The Button's disabled state sets pointer-events: none, which would
            suppress the native title tooltip while no text is selected — the
            title lives on this wrapper instead so it still receives hover. */}
        <span
          title={hasSelection ? t("toolbar.aiCheckButtonTitle") : t("toolbar.aiCheckButtonTitleDisabled")}
        >
          <Button
            type="button"
            size="icon-sm"
            aria-label={t("toolbar.aiCheckButton")}
            className="editor-toolbar__ai-check-button"
            disabled={!hasSelection}
            onMouseDown={(event) => {
              event.preventDefault();
            }}
            onClick={onAiCheckRequest}
          >
            <SpellCheck />
          </Button>
        </span>
        <AiQuickSettings onAiSettingsRequest={onAiSettingsRequest} />
      </div>

      <div className="editor-toolbar__separator" aria-hidden="true" />

      <div className="editor-toolbar__group">
        <ToggleButton
          pressed={editor.isActive("bold")}
          label={t("toolbar.bold")}
          title={t("toolbar.boldTitle")}
          onClick={() => {
            editor.chain().focus().toggleBold().run();
          }}
        >
          <Bold />
        </ToggleButton>
        <ToggleButton
          pressed={editor.isActive("italic")}
          label={t("toolbar.italic")}
          title={t("toolbar.italicTitle")}
          onClick={() => {
            editor.chain().focus().toggleItalic().run();
          }}
        >
          <Italic />
        </ToggleButton>
        <ToggleButton
          pressed={editor.isActive("strike")}
          label={t("toolbar.strikethrough")}
          title={t("toolbar.strikethroughTitle")}
          onClick={() => {
            editor.chain().focus().toggleStrike().run();
          }}
        >
          <Strikethrough />
        </ToggleButton>
        <ToggleButton
          pressed={editor.isActive("underline")}
          label={t("toolbar.underline")}
          title={t("toolbar.underlineTitle")}
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
          title={t("toolbar.heading1Title")}
          onClick={() => {
            editor.chain().focus().toggleHeading({ level: 1 }).run();
          }}
        >
          <Heading1 />
        </ToggleButton>
        <ToggleButton
          pressed={editor.isActive("heading", { level: 2 })}
          label={t("toolbar.heading2")}
          title={t("toolbar.heading2Title")}
          onClick={() => {
            editor.chain().focus().toggleHeading({ level: 2 }).run();
          }}
        >
          <Heading2 />
        </ToggleButton>
        <ToggleButton
          pressed={editor.isActive("heading", { level: 3 })}
          label={t("toolbar.heading3")}
          title={t("toolbar.heading3Title")}
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
          title={t("toolbar.bulletListTitle")}
          onClick={() => {
            editor.chain().focus().toggleBulletList().run();
          }}
        >
          <List />
        </ToggleButton>
        <ToggleButton
          pressed={editor.isActive("orderedList")}
          label={t("toolbar.orderedList")}
          title={t("toolbar.orderedListTitle")}
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
          title={t("toolbar.blockquoteTitle")}
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
          title={t("toolbar.inlineCodeTitle")}
          onClick={() => {
            editor.chain().focus().toggleCode().run();
          }}
        >
          <Code />
        </ToggleButton>
        <ToggleButton
          pressed={editor.isActive("codeBlock")}
          label={t("toolbar.codeBlock")}
          title={t("toolbar.codeBlockTitle")}
          onClick={() => {
            editor.chain().focus().toggleCodeBlock().run();
          }}
        >
          <Code2 />
        </ToggleButton>
        <ToggleButton
          pressed={editor.isActive("link")}
          label={t("toolbar.insertLink")}
          title={t("toolbar.insertLinkTitle")}
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

      <div className="editor-toolbar__separator" aria-hidden="true" />

      <div className="editor-toolbar__group">
        <Button
          type="button"
          size="icon-sm"
          variant="outline"
          aria-label={t("findReplace.openButton")}
          title={t("findReplace.openButtonTitle")}
          onMouseDown={(event) => {
            event.preventDefault();
          }}
          onClick={onSearchRequest}
        >
          <Search />
        </Button>
        <ZoomControl />
        <EditorOptionsMenu onPrintRequest={onPrintRequest} />
      </div>
    </div>
  );
}
