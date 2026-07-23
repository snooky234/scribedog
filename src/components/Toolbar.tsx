import {
  Bold,
  Brain,
  Check,
  ChevronDown,
  Code,
  Code2,
  CheckSquare,
  CircleCheck,
  EllipsisVertical,
  Heading,
  Heading1,
  Heading2,
  Heading3,
  Heading4,
  Heading5,
  Heading6,
  ImagePlus,
  IndentDecrease,
  IndentIncrease,
  Info,
  Italic,
  Link2,
  List,
  ListOrdered,
  Megaphone,
  OctagonAlert,
  PawPrint,
  Pilcrow,
  Printer,
  Quote,
  Search,
  SpellCheck,
  Strikethrough,
  TriangleAlert,
  Underline,
  X
} from "lucide-react";
import { useEffect, useState, type ComponentType, type ReactNode } from "react";
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
import { CALLOUT_VARIANTS, type CalloutVariant } from "@/lib/editor/extensions/callout";
import { checkSpellcheckDictionary } from "@/lib/spellcheckDictionary";
import { useAiModelsStore } from "@/store/useAiModelsStore";
import { useAiSettingsStore } from "@/store/useAiSettingsStore";
import { DEFAULT_ASSISTANT_ID, useAssistantsStore, type Assistant } from "@/store/useAssistantsStore";
import { useEditorSettingsStore } from "@/store/useEditorSettingsStore";

type ToolbarProps = {
  editor: Editor;
  onLinkRequest: () => void;
  onImageInsertRequest: () => void;
  onAiRequest: () => void;
  onAiCheckRequest: () => void;
  onAiSettingsRequest: () => void;
  onAssistantSettingsRequest: () => void;
  onPrintRequest: () => void;
  onSearchRequest: () => void;
};

const OPEN_AI_SETTINGS_VALUE = "__open-ai-settings__";
const OPEN_ASSISTANT_SETTINGS_VALUE = "__open-assistant-settings__";

export function assistantDisplayName(assistant: Assistant, defaultName: string): string {
  const name = assistant.id === DEFAULT_ASSISTANT_ID && !assistant.name ? defaultName : assistant.name;

  return assistant.emoji ? `${assistant.emoji} ${name}` : name;
}

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

function AssistantQuickSelect({ onAssistantSettingsRequest }: { onAssistantSettingsRequest: () => void }) {
  const { t } = useTranslation();
  const assistants = useAssistantsStore((state) => state.assistants);
  const selectedAssistantId = useAssistantsStore((state) => state.selectedAssistantId);
  const selectAssistant = useAssistantsStore((state) => state.selectAssistant);

  return (
    <select
      className="editor-toolbar__model-select"
      aria-label={t("toolbar.aiAssistant")}
      title={t("toolbar.aiAssistant")}
      value={selectedAssistantId}
      onChange={(event) => {
        const value = event.target.value;
        if (value === OPEN_ASSISTANT_SETTINGS_VALUE) {
          onAssistantSettingsRequest();
          return;
        }
        selectAssistant(value);
      }}
    >
      <option value={OPEN_ASSISTANT_SETTINGS_VALUE}>{t("toolbar.aiOpenAssistantSettings")}</option>
      <optgroup label={t("toolbar.aiAssistantsGroup")}>
        {assistants.map((assistant) => (
          <option key={assistant.id} value={assistant.id}>
            {assistantDisplayName(assistant, t("assistants.defaultName"))}
          </option>
        ))}
      </optgroup>
    </select>
  );
}

function AiQuickSettings({
  onAiSettingsRequest,
  onAssistantSettingsRequest
}: {
  onAiSettingsRequest: () => void;
  onAssistantSettingsRequest: () => void;
}) {
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
      <AssistantQuickSelect onAssistantSettingsRequest={onAssistantSettingsRequest} />
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

const HEADING_LEVELS = [1, 2, 3, 4, 5, 6] as const;
type HeadingLevel = (typeof HEADING_LEVELS)[number];

const HEADING_ICONS: Record<HeadingLevel, ComponentType<{ className?: string }>> = {
  1: Heading1,
  2: Heading2,
  3: Heading3,
  4: Heading4,
  5: Heading5,
  6: Heading6
};

// Collapses the former H1–H3 buttons into a single dropdown that also offers
// H4–H6 and a "normal text" reset. The active block gets a trailing check.
function HeadingMenu({ editor }: { editor: Editor }) {
  const { t } = useTranslation();
  const activeLevel = HEADING_LEVELS.find((level) => editor.isActive("heading", { level })) ?? null;
  const TriggerIcon = activeLevel ? HEADING_ICONS[activeLevel] : Heading;

  return (
    <Menu>
      <MenuTrigger
        render={
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="editor-toolbar__heading-trigger"
            aria-label={t("toolbar.headingMenu")}
            title={t("toolbar.headingMenu")}
            data-active={activeLevel ? "true" : undefined}
            onMouseDown={(event) => {
              event.preventDefault();
            }}
          />
        }
      >
        <TriggerIcon className="size-4" />
        <ChevronDown className="size-3 opacity-60" />
      </MenuTrigger>
      <MenuPortal>
        <MenuPositioner align="start">
          <MenuPopup>
            <MenuItem onClick={() => editor.chain().focus().setParagraph().run()}>
              <Pilcrow className="size-4" />
              {t("toolbar.paragraph")}
              {editor.isActive("paragraph") ? <Check className="ml-auto size-4" /> : null}
            </MenuItem>
            {HEADING_LEVELS.map((level) => {
              const Icon = HEADING_ICONS[level];

              return (
                <MenuItem
                  key={level}
                  title={`${t("common.keys.ctrl")}+${level}`}
                  onClick={() => editor.chain().focus().toggleHeading({ level }).run()}
                >
                  <Icon className="size-4" />
                  {t(`toolbar.heading${level}`)}
                  {editor.isActive("heading", { level }) ? <Check className="ml-auto size-4" /> : null}
                </MenuItem>
              );
            })}
          </MenuPopup>
        </MenuPositioner>
      </MenuPortal>
    </Menu>
  );
}

const CALLOUT_ICONS: Record<CalloutVariant, ComponentType<{ className?: string }>> = {
  success: CircleCheck,
  info: Info,
  warning: TriangleAlert,
  danger: OctagonAlert
};

const CALLOUT_LABEL_KEYS: Record<CalloutVariant, string> = {
  success: "toolbar.calloutSuccess",
  info: "toolbar.calloutInfo",
  warning: "toolbar.calloutWarning",
  danger: "toolbar.calloutDanger"
};

// Dropdown next to the image button that inserts (or re-colors) a hint banner.
function CalloutMenu({ editor }: { editor: Editor }) {
  const { t } = useTranslation();
  const inCallout = editor.isActive("callout");
  const activeVariant = inCallout ? (editor.getAttributes("callout").variant as CalloutVariant | undefined) : undefined;

  const applyVariant = (variant: CalloutVariant) => {
    if (inCallout) {
      editor.chain().focus().updateAttributes("callout", { variant }).run();
    } else {
      editor.chain().focus().setCallout({ variant }).run();
    }
  };

  return (
    <Menu>
      <MenuTrigger
        render={
          <Button
            type="button"
            size="icon-sm"
            variant="outline"
            aria-label={t("toolbar.calloutMenu")}
            title={t("toolbar.calloutMenu")}
            data-active={inCallout ? "true" : undefined}
            onMouseDown={(event) => {
              event.preventDefault();
            }}
          />
        }
      >
        <Megaphone />
      </MenuTrigger>
      <MenuPortal>
        <MenuPositioner align="end">
          <MenuPopup>
            {CALLOUT_VARIANTS.map((variant) => {
              const Icon = CALLOUT_ICONS[variant];

              return (
                <MenuItem
                  key={variant}
                  className={`editor-toolbar__callout-item editor-toolbar__callout-item--${variant}`}
                  onClick={() => applyVariant(variant)}
                >
                  <Icon className="size-4" />
                  {t(CALLOUT_LABEL_KEYS[variant])}
                  {activeVariant === variant ? <Check className="ml-auto size-4" /> : null}
                </MenuItem>
              );
            })}
            <div className="editor-toolbar__menu-separator" role="separator" />
            <MenuItem disabled={!inCallout} onClick={() => editor.chain().focus().unsetCallout().run()}>
              <X className="size-4" />
              {t("toolbar.calloutRemove")}
            </MenuItem>
          </MenuPopup>
        </MenuPositioner>
      </MenuPortal>
    </Menu>
  );
}

export function Toolbar({
  editor,
  onLinkRequest,
  onImageInsertRequest,
  onAiRequest,
  onAiCheckRequest,
  onAiSettingsRequest,
  onAssistantSettingsRequest,
  onPrintRequest,
  onSearchRequest
}: ToolbarProps) {
  const { t } = useTranslation();
  const [, forceRerender] = useState(0);
  const hasSelection = !editor.state.selection.empty;

  // Indent controls act on the list item the cursor sits in; there is no
  // generic block indentation in a markdown document.
  const inList =
    editor.isActive("bulletList") || editor.isActive("orderedList") || editor.isActive("taskList");
  const listItemType = editor.isActive("taskList") ? "taskItem" : "listItem";
  const changeIndent = (direction: "increase" | "decrease") => {
    if (direction === "increase") {
      editor.chain().focus().sinkListItem(listItemType).run();
    } else {
      editor.chain().focus().liftListItem(listItemType).run();
    }
  };

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
        <AiQuickSettings
          onAiSettingsRequest={onAiSettingsRequest}
          onAssistantSettingsRequest={onAssistantSettingsRequest}
        />
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
        <HeadingMenu editor={editor} />
        <Button
          type="button"
          size="icon-sm"
          variant="outline"
          aria-label={t("toolbar.indentDecrease")}
          title={`${t("toolbar.indentDecrease")} (${t("common.keys.shift")}+Tab)`}
          disabled={!inList}
          onMouseDown={(event) => {
            event.preventDefault();
          }}
          onClick={() => changeIndent("decrease")}
        >
          <IndentDecrease />
        </Button>
        <Button
          type="button"
          size="icon-sm"
          variant="outline"
          aria-label={t("toolbar.indentIncrease")}
          title={`${t("toolbar.indentIncrease")} (Tab)`}
          disabled={!inList}
          onMouseDown={(event) => {
            event.preventDefault();
          }}
          onClick={() => changeIndent("increase")}
        >
          <IndentIncrease />
        </Button>
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
          pressed={editor.isActive("blockquote")}
          label={t("toolbar.blockquote")}
          title={t("toolbar.blockquoteTitle")}
          onClick={() => {
            editor.chain().focus().toggleBlockquote().run();
          }}
        >
          <Quote />
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
        <Button
          type="button"
          size="icon-sm"
          variant="outline"
          aria-label={t("toolbar.insertImage")}
          title={t("toolbar.insertImage")}
          onMouseDown={(event) => {
            event.preventDefault();
          }}
          onClick={onImageInsertRequest}
        >
          <ImagePlus />
        </Button>
        <CalloutMenu editor={editor} />
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
