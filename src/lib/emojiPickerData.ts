import type { SupportedLanguage } from "@/i18n";

type EmojiMartModule = typeof import("emoji-mart");

export type EmojiPickerResources = {
  Picker: EmojiMartModule["Picker"];
  data: unknown;
  i18n: unknown;
};

// The keyword data of one language is 600 to 800 KB of JavaScript. Imported
// statically, all ten landed in the entry chunk and had to be parsed before the
// window could show; loaded like this, each language is a chunk of its own and
// only the active one is ever fetched.
const DATA_LOADERS: Record<SupportedLanguage, () => Promise<unknown>> = {
  de: () => import("@/lib/emojiKeywordsDe").then((module) => module.emojiDataDe),
  en: () => import("@emoji-mart/data").then((module) => module.default),
  fr: () => import("@/lib/emojiKeywordsFr").then((module) => module.emojiDataFr),
  es: () => import("@/lib/emojiKeywordsEs").then((module) => module.emojiDataEs),
  zh: () => import("@/lib/emojiKeywordsZh").then((module) => module.emojiDataZh),
  ja: () => import("@/lib/emojiKeywordsJa").then((module) => module.emojiDataJa),
  pt: () => import("@/lib/emojiKeywordsPt").then((module) => module.emojiDataPt),
  ru: () => import("@/lib/emojiKeywordsRu").then((module) => module.emojiDataRu),
  it: () => import("@/lib/emojiKeywordsIt").then((module) => module.emojiDataIt),
  uk: () => import("@/lib/emojiKeywordsUk").then((module) => module.emojiDataUk)
};

const I18N_LOADERS: Record<SupportedLanguage, () => Promise<unknown>> = {
  de: () => import("@emoji-mart/data/i18n/de.json").then((module) => module.default),
  en: () => import("@emoji-mart/data/i18n/en.json").then((module) => module.default),
  fr: () => import("@emoji-mart/data/i18n/fr.json").then((module) => module.default),
  es: () => import("@emoji-mart/data/i18n/es.json").then((module) => module.default),
  zh: () => import("@emoji-mart/data/i18n/zh.json").then((module) => module.default),
  ja: () => import("@emoji-mart/data/i18n/ja.json").then((module) => module.default),
  pt: () => import("@emoji-mart/data/i18n/pt.json").then((module) => module.default),
  ru: () => import("@emoji-mart/data/i18n/ru.json").then((module) => module.default),
  it: () => import("@emoji-mart/data/i18n/it.json").then((module) => module.default),
  uk: () => import("@emoji-mart/data/i18n/uk.json").then((module) => module.default)
};

const pendingByLanguage = new Map<SupportedLanguage, Promise<EmojiPickerResources>>();

/** Everything the picker needs for one language. The idle preload and the
 *  picker share one promise, so a picker opened while the preload is still
 *  running waits for it instead of starting a second load. */
export function loadEmojiPickerResources(language: SupportedLanguage): Promise<EmojiPickerResources> {
  const existing = pendingByLanguage.get(language);

  if (existing) {
    return existing;
  }

  const pending = Promise.all([
    import("emoji-mart"),
    DATA_LOADERS[language](),
    I18N_LOADERS[language]()
  ]).then(([emojiMart, data, i18n]) => ({ Picker: emojiMart.Picker, data, i18n }));

  pendingByLanguage.set(language, pending);

  // A failed load must not stick: the next open tries again.
  pending.catch(() => {
    pendingByLanguage.delete(language);
  });

  return pending;
}
