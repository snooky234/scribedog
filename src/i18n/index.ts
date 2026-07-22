import i18n from "i18next";
import { initReactI18next } from "react-i18next";

import de from "@/i18n/locales/de.json";
import en from "@/i18n/locales/en.json";
import fr from "@/i18n/locales/fr.json";
import es from "@/i18n/locales/es.json";
import zh from "@/i18n/locales/zh.json";
import ja from "@/i18n/locales/ja.json";
import pt from "@/i18n/locales/pt.json";
import ru from "@/i18n/locales/ru.json";
import it from "@/i18n/locales/it.json";
import uk from "@/i18n/locales/uk.json";

export const LANGUAGE_STORAGE_KEY = "scribedog-language";
export const SUPPORTED_LANGUAGES = ["de", "en", "fr", "es", "zh", "ja", "pt", "ru", "it", "uk"] as const;
export type SupportedLanguage = (typeof SUPPORTED_LANGUAGES)[number];
const DEFAULT_LANGUAGE: SupportedLanguage = "de";

// English endonyms of the UI languages, used to tell an AI model which
// language to answer in (English names are the most reliably understood).
const LANGUAGE_ENGLISH_NAME: Record<SupportedLanguage, string> = {
  de: "German",
  en: "English",
  fr: "French",
  es: "Spanish",
  zh: "Chinese",
  ja: "Japanese",
  pt: "Portuguese",
  ru: "Russian",
  it: "Italian",
  uk: "Ukrainian"
};

function isSupportedLanguage(value: string | null): value is SupportedLanguage {
  return value !== null && (SUPPORTED_LANGUAGES as readonly string[]).includes(value);
}

/** English name of the currently active UI language (e.g. "German"). */
export function getCurrentLanguageEnglishName(): string {
  const base = (i18n.resolvedLanguage ?? i18n.language ?? DEFAULT_LANGUAGE).split("-")[0];
  return LANGUAGE_ENGLISH_NAME[isSupportedLanguage(base) ? base : DEFAULT_LANGUAGE];
}

export function getStoredLanguage(): SupportedLanguage {
  try {
    const stored = window.localStorage.getItem(LANGUAGE_STORAGE_KEY);
    return isSupportedLanguage(stored) ? stored : DEFAULT_LANGUAGE;
  } catch {
    return DEFAULT_LANGUAGE;
  }
}

export function persistLanguage(language: SupportedLanguage): void {
  try {
    window.localStorage.setItem(LANGUAGE_STORAGE_KEY, language);
  } catch {
    // localStorage may be unavailable in some environments.
  }
}

void i18n.use(initReactI18next).init({
  resources: {
    de: { translation: de },
    en: { translation: en },
    fr: { translation: fr },
    es: { translation: es },
    zh: { translation: zh },
    ja: { translation: ja },
    pt: { translation: pt },
    ru: { translation: ru },
    it: { translation: it },
    uk: { translation: uk }
  },
  lng: getStoredLanguage(),
  fallbackLng: DEFAULT_LANGUAGE,
  interpolation: {
    escapeValue: false
  }
});

export default i18n;
