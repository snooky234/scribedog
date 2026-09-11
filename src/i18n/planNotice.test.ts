import { describe, expect, it } from "vitest";

import i18n, { SUPPORTED_LANGUAGES } from "@/i18n";

// The notice the chat appends when a plan step did not happen. Worth a test of
// its own because it is the one string in the turn that has to be right in all
// ten locales AND has to survive i18next's plural resolution: the key exists
// only in its _one/_other (and for ru/uk _few/_many) forms, so a missing form
// would surface as the raw key sitting in the transcript.
async function withLanguage(language: string, run: () => void) {
  const previous = i18n.language;
  await i18n.changeLanguage(language);
  try {
    run();
  } finally {
    await i18n.changeLanguage(previous);
  }
}

describe("chat.planStepsUnfinished", () => {
  it("resolves in every UI language, for one step and for several", async () => {
    for (const language of SUPPORTED_LANGUAGES) {
      await withLanguage(language, () => {
        for (const count of [1, 2, 5]) {
          const text = i18n.t("chat.planStepsUnfinished", { count, titles: "Notizen anlegen" });

          expect(text, `${language}, count ${count}`).not.toContain("planStepsUnfinished");
          expect(text, `${language}, count ${count}`).toContain("Notizen anlegen");
        }
      });
    }
  });

  // The singular and the plural have to be different sentences somewhere, or
  // one of the two forms was filled in by copying the other.
  it("says something different for one step than for several in German and English", async () => {
    for (const language of ["de", "en"]) {
      await withLanguage(language, () => {
        const one = i18n.t("chat.planStepsUnfinished", { count: 1, titles: "A" });
        const many = i18n.t("chat.planStepsUnfinished", { count: 3, titles: "A, B, C" });

        expect(one, language).not.toBe(many);
      });
    }
  });
});
