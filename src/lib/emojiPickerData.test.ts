import { afterEach, describe, expect, it, vi } from "vitest";

// emoji-mart registers custom elements on import, which Node has no room for;
// the loader only hands the constructor through.
vi.mock("emoji-mart", () => ({ Picker: class {} }));

type EmojiData = { emojis: Record<string, { keywords?: string[] }> };

// Only German is really loaded: every keyword file is close to 1 MB, and
// transforming all ten slowed the parallel suite enough to time out unrelated
// tests. That each loader picks the right export is checked by tsc.
async function freshLoader() {
  vi.resetModules();
  return import("./emojiPickerData");
}

afterEach(() => {
  vi.doUnmock("@/lib/emojiKeywordsDe");
});

describe("loadEmojiPickerResources", () => {
  it("loads the picker, the localized data and the translations", async () => {
    const { loadEmojiPickerResources } = await freshLoader();
    const { Picker, data, i18n } = await loadEmojiPickerResources("de");

    expect(Picker).toBeTypeOf("function");
    expect((data as EmojiData).emojis.grinning.keywords).toContain("grinsendes Gesicht");
    expect(i18n).toHaveProperty("search", "Suchen");
  });

  // The idle preload and a picker opened while it runs must share one load.
  it("hands out the same promise for repeated calls", async () => {
    const { loadEmojiPickerResources } = await freshLoader();
    const first = loadEmojiPickerResources("de");

    expect(loadEmojiPickerResources("de")).toBe(first);
    await first;
  });

  it("tries again after a failed load", async () => {
    vi.doMock("@/lib/emojiKeywordsDe", () => {
      throw new Error("chunk missing");
    });
    const { loadEmojiPickerResources } = await freshLoader();
    const failed = loadEmojiPickerResources("de");

    await expect(failed).rejects.toThrow();
    // Let the loader's own rejection handler drop the cached promise.
    await Promise.resolve();

    const retry = loadEmojiPickerResources("de");

    expect(retry).not.toBe(failed);
    await retry.catch(() => undefined);
  });
});
