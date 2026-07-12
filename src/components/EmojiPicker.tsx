import { useRef, useState } from "react";
import { createPortal } from "react-dom";

import { Smile } from "lucide-react";
import Picker from "@emoji-mart/react";
import emojiI18nDe from "@emoji-mart/data/i18n/de.json";
import emojiI18nEn from "@emoji-mart/data/i18n/en.json";
import emojiI18nFr from "@emoji-mart/data/i18n/fr.json";
import emojiI18nEs from "@emoji-mart/data/i18n/es.json";
import emojiI18nZh from "@emoji-mart/data/i18n/zh.json";
import emojiI18nJa from "@emoji-mart/data/i18n/ja.json";
import emojiI18nPt from "@emoji-mart/data/i18n/pt.json";
import emojiI18nRu from "@emoji-mart/data/i18n/ru.json";
import emojiI18nIt from "@emoji-mart/data/i18n/it.json";
import emojiI18nUk from "@emoji-mart/data/i18n/uk.json";
import emojiDataEn from "@emoji-mart/data";
import { useTranslation } from "react-i18next";

import type { Editor } from "@tiptap/react";

import { Button } from "@/components/ui/button";
import { emojiDataDe } from "@/lib/emojiKeywordsDe";
import { emojiDataFr } from "@/lib/emojiKeywordsFr";
import { emojiDataEs } from "@/lib/emojiKeywordsEs";
import { emojiDataZh } from "@/lib/emojiKeywordsZh";
import { emojiDataJa } from "@/lib/emojiKeywordsJa";
import { emojiDataPt } from "@/lib/emojiKeywordsPt";
import { emojiDataRu } from "@/lib/emojiKeywordsRu";
import { emojiDataIt } from "@/lib/emojiKeywordsIt";
import { emojiDataUk } from "@/lib/emojiKeywordsUk";
import { useDismissablePopover } from "@/lib/useDismissablePopover";
import { usePopoverOverflowAlign } from "@/lib/usePopoverOverflowAlign";
import type { SupportedLanguage } from "@/i18n";

const EMOJI_DATA: Record<SupportedLanguage, unknown> = {
  de: emojiDataDe,
  en: emojiDataEn,
  fr: emojiDataFr,
  es: emojiDataEs,
  zh: emojiDataZh,
  ja: emojiDataJa,
  pt: emojiDataPt,
  ru: emojiDataRu,
  it: emojiDataIt,
  uk: emojiDataUk,
};

const EMOJI_I18N: Record<SupportedLanguage, unknown> = {
  de: emojiI18nDe,
  en: emojiI18nEn,
  fr: emojiI18nFr,
  es: emojiI18nEs,
  zh: emojiI18nZh,
  ja: emojiI18nJa,
  pt: emojiI18nPt,
  ru: emojiI18nRu,
  it: emojiI18nIt,
  uk: emojiI18nUk,
};

type EmojiPickerProps = {
  editor: Editor;
};

type EmojiSelection = {
  native?: string;
  shortcodes?: string;
};

export function EmojiPicker({ editor }: EmojiPickerProps) {
  const { t, i18n } = useTranslation();
  const language = (i18n.resolvedLanguage ?? i18n.language) as SupportedLanguage;
  const [anchor, setAnchor] = useState<{ top: number; left: number; right: number } | null>(null);
  const [align, setAlign] = useState<"left" | "right">("left");
  const popoverRef = useRef<HTMLDivElement>(null);

  const isOpen = anchor !== null;

  const close = () => {
    setAnchor(null);
  };

  useDismissablePopover(isOpen, close);
  usePopoverOverflowAlign(anchor, popoverRef, setAlign);

  const insertEmoji = (emoji: EmojiSelection) => {
    const value = emoji.native ?? emoji.shortcodes;

    if (value) {
      editor.chain().focus().insertContent(value).run();
    }

    close();
  };

  return (
    <>
      <Button
        type="button"
        size="sm"
        variant="outline"
        aria-label={t("emojiPicker.insertEmoji")}
        aria-expanded={isOpen}
        title={t("emojiPicker.insertEmoji")}
        onMouseDown={(event) => {
          event.preventDefault();
        }}
        onClick={(event) => {
          // Prevents the same click that opens the picker from immediately
          // reaching the window listener in useDismissablePopover and
          // closing it again (self-dismiss).
          event.stopPropagation();

          if (isOpen) {
            close();
            return;
          }

          const rect = event.currentTarget.getBoundingClientRect();
          setAlign("left");
          setAnchor({ top: rect.bottom + 6, left: rect.left, right: window.innerWidth - rect.right });
        }}
      >
        <Smile />
      </Button>

      {anchor
        ? createPortal(
            <div
              ref={popoverRef}
              className="editor-popover emoji-picker"
              role="menu"
              aria-label={t("emojiPicker.selectEmoji")}
              style={align === "right" ? { top: anchor.top, right: anchor.right } : { top: anchor.top, left: anchor.left }}
              onClick={(event) => event.stopPropagation()}
            >
              <Picker
                data={EMOJI_DATA[language]}
                i18n={EMOJI_I18N[language]}
                locale={language}
                theme="dark"
                set="native"
                autoFocus
                previewPosition="none"
                skinTonePosition="search"
                onEmojiSelect={insertEmoji}
              />
            </div>,
            document.body
          )
        : null}
    </>
  );
}
