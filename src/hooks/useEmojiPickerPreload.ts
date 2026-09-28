import { useEffect } from "react";
import { useTranslation } from "react-i18next";

import type { SupportedLanguage } from "@/i18n";
import { loadEmojiPickerResources } from "@/lib/emojiPickerData";

/** Fallback for engines without requestIdleCallback (Safari before 18 in the
 *  web edition): late enough that the startup work is through. */
const IDLE_FALLBACK_DELAY_MS = 2000;

/** The emoji picker's data is kept out of the entry chunk so it does not delay
 *  the first frame. Loading it once the app is idle means it is still there by
 *  the time the picker is first opened. Runs again for a new UI language. */
export function useEmojiPickerPreload(): void {
  const { i18n } = useTranslation();
  const language = (i18n.resolvedLanguage ?? i18n.language) as SupportedLanguage;

  useEffect(() => {
    const preload = () => {
      void loadEmojiPickerResources(language).catch(() => undefined);
    };

    if (typeof window.requestIdleCallback === "function") {
      const handle = window.requestIdleCallback(preload);
      return () => window.cancelIdleCallback(handle);
    }

    const timer = window.setTimeout(preload, IDLE_FALLBACK_DELAY_MS);
    return () => window.clearTimeout(timer);
  }, [language]);
}
