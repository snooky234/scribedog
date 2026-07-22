import { describe, expect, it } from "vitest";

import i18n, { getCurrentLanguageEnglishName } from "@/i18n";

async function withLanguage(language: string, run: () => void) {
  const previous = i18n.language;
  await i18n.changeLanguage(language);
  try {
    run();
  } finally {
    await i18n.changeLanguage(previous);
  }
}

describe("getCurrentLanguageEnglishName", () => {
  it("returns the English name of the active UI language", async () => {
    await withLanguage("de", () => expect(getCurrentLanguageEnglishName()).toBe("German"));
    await withLanguage("fr", () => expect(getCurrentLanguageEnglishName()).toBe("French"));
    await withLanguage("uk", () => expect(getCurrentLanguageEnglishName()).toBe("Ukrainian"));
  });

  it("ignores a region suffix", async () => {
    await withLanguage("de-DE", () => expect(getCurrentLanguageEnglishName()).toBe("German"));
  });

  it("falls back to German for an unsupported language", async () => {
    await withLanguage("xx", () => expect(getCurrentLanguageEnglishName()).toBe("German"));
  });
});
