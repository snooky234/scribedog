import { useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";

import { Smile } from "lucide-react";
import { Picker } from "emoji-mart";
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
import { useLayoutMode } from "@/hooks/useLayoutMode";
import { useDismissablePopover } from "@/lib/useDismissablePopover";
import {
  anchorForTrigger,
  popoverStyle,
  usePopoverOverflowAlign,
  type PopoverAnchor
} from "@/lib/usePopoverOverflowAlign";
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
  // Toolbar mode: the picked emoji is inserted into the document.
  editor?: Editor;
  // Form mode: the picked emoji is handed to the caller instead.
  onSelect?: (emoji: string) => void;
  // Optional trigger content replacing the default smiley icon (e.g. the
  // currently selected emoji in a form).
  trigger?: ReactNode;
};

type EmojiSelection = {
  native?: string;
  shortcodes?: string;
};

type EmojiMartPickerProps = {
  language: SupportedLanguage;
  onEmojiSelect: (emoji: EmojiSelection) => void;
};

// emoji-mart's Picker is a framework-agnostic custom element that appends
// itself into the element passed as `parent`. Mounting it directly keeps us off
// the @emoji-mart/react wrapper, which is unmaintained and declares no React 19
// support. The picker is created once per mount — the popover unmounts on close,
// so every open builds a fresh one — and the select handler is read through a
// ref so a re-render (e.g. the overflow re-align) never tears it down.
function EmojiMartPicker({ language, onEmojiSelect }: EmojiMartPickerProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const selectRef = useRef(onEmojiSelect);

  useEffect(() => {
    selectRef.current = onEmojiSelect;
  }, [onEmojiSelect]);

  useEffect(() => {
    const host = hostRef.current;

    if (!host) {
      return;
    }

    new Picker({
      parent: host,
      data: EMOJI_DATA[language],
      i18n: EMOJI_I18N[language],
      locale: language,
      theme: "dark",
      set: "native",
      autoFocus: true,
      previewPosition: "none",
      skinTonePosition: "search",
      onEmojiSelect: (emoji: EmojiSelection) => selectRef.current(emoji),
    });

    return () => {
      host.innerHTML = "";
    };
  }, [language]);

  return <div ref={hostRef} />;
}

/**
 * The picker itself, anchored to a point on screen instead of to a trigger of
 * its own. Opened from somewhere that already is a menu (a tree row's context
 * menu, a breadcrumb crumb), where a second button would have nowhere to sit.
 *
 * The caller owns whether it is open, so the entry that opens it can close its
 * own menu first; dismissing is handled here, as it is for the trigger form.
 */
export function EmojiPickerPopover({
  anchor: requestedAnchor,
  onSelect,
  onClose
}: {
  /** Where the picker should hang, in client coordinates. */
  anchor: PopoverAnchor;
  onSelect: (emoji: string) => void;
  onClose: () => void;
}) {
  const { t, i18n } = useTranslation();
  const language = (i18n.resolvedLanguage ?? i18n.language) as SupportedLanguage;
  const [align, setAlign] = useState<"left" | "right">("left");
  const [valign, setValign] = useState<"below" | "above">("below");
  const popoverRef = useRef<HTMLDivElement>(null);
  const isSheet = useLayoutMode() === "phone";

  useDismissablePopover(true, onClose, popoverRef);
  usePopoverOverflowAlign(requestedAnchor, popoverRef, setAlign, setValign);

  return createPortal(
    <div
      ref={popoverRef}
      className={isSheet ? "editor-popover editor-popover--sheet emoji-picker" : "editor-popover emoji-picker"}
      role="menu"
      aria-label={t("emojiPicker.selectEmoji")}
      style={isSheet ? undefined : popoverStyle(requestedAnchor, align, valign)}
      onClick={(event) => event.stopPropagation()}
    >
      <EmojiMartPicker
        language={language}
        onEmojiSelect={(emoji) => {
          const value = emoji.native ?? emoji.shortcodes;

          if (value) {
            onSelect(value);
          }

          onClose();
        }}
      />
    </div>,
    document.body
  );
}

export function EmojiPicker({ editor, onSelect, trigger }: EmojiPickerProps) {
  const { t, i18n } = useTranslation();
  const language = (i18n.resolvedLanguage ?? i18n.language) as SupportedLanguage;
  const [anchor, setAnchor] = useState<PopoverAnchor | null>(null);
  const [align, setAlign] = useState<"left" | "right">("left");
  const [valign, setValign] = useState<"below" | "above">("below");
  const popoverRef = useRef<HTMLDivElement>(null);
  const isSheet = useLayoutMode() === "phone";

  const isOpen = anchor !== null;

  const close = () => {
    setAnchor(null);
  };

  useDismissablePopover(isOpen, close, popoverRef);
  usePopoverOverflowAlign(anchor, popoverRef, setAlign, setValign);

  const insertEmoji = (emoji: EmojiSelection) => {
    const value = emoji.native ?? emoji.shortcodes;

    if (value) {
      if (onSelect) {
        onSelect(value);
      } else if (editor) {
        editor.chain().focus().insertContent(value).run();
      }
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

          setAlign("left");
          setValign("below");
          setAnchor(anchorForTrigger(event.currentTarget.getBoundingClientRect()));
        }}
      >
        {trigger ?? <Smile />}
      </Button>

      {anchor
        ? createPortal(
            <div
              ref={popoverRef}
              className={isSheet ? "editor-popover editor-popover--sheet emoji-picker" : "editor-popover emoji-picker"}
              role="menu"
              aria-label={t("emojiPicker.selectEmoji")}
              style={isSheet ? undefined : popoverStyle(anchor, align, valign)}
              onClick={(event) => event.stopPropagation()}
            >
              <EmojiMartPicker language={language} onEmojiSelect={insertEmoji} />
            </div>,
            document.body
          )
        : null}
    </>
  );
}
