import rawEmojiData from "@emoji-mart/data";

type EmojiSkin = {
  unified: string;
  native: string;
};

type EmojiEntry = {
  id: string;
  name: string;
  keywords?: string[];
  emoticons?: string[];
  skins: EmojiSkin[];
  version: number;
};

type EmojiMartData = {
  emojis: Record<string, EmojiEntry>;
  categories: unknown[];
  aliases: Record<string, string>;
  sheet: unknown;
};

export type EmojibaseEntry = {
  hexcode: string;
  label?: string;
  tags?: string[];
};

// emoji-mart stores the codepoint as a lowercase hyphen-separated list (e.g.
// "2764-fe0f"), while emojibase includes or omits the trailing variation
// selector FE0F depending on the emoji. Both variants are therefore indexed,
// so lookup works regardless of this Unicode quirk.
function buildKeywordIndex(emojibaseData: EmojibaseEntry[]): Map<string, string[]> {
  const index = new Map<string, string[]>();

  for (const entry of emojibaseData) {
    const keywords = [entry.label, ...(entry.tags ?? [])].filter(
      (value): value is string => Boolean(value)
    );

    if (keywords.length === 0) {
      continue;
    }

    const withoutVariationSelector = entry.hexcode
      .split("-")
      .filter((part) => part !== "FE0F")
      .join("-");

    index.set(entry.hexcode, keywords);

    if (!index.has(withoutVariationSelector)) {
      index.set(withoutVariationSelector, keywords);
    }
  }

  return index;
}

function findKeywords(index: Map<string, string[]>, unified: string): string[] | undefined {
  const exact = unified.toUpperCase();
  const withoutVariationSelector = exact
    .split("-")
    .filter((part) => part !== "FE0F")
    .join("-");

  return index.get(exact) ?? index.get(withoutVariationSelector);
}

export function buildLocalizedEmojiData(emojibaseData: EmojibaseEntry[]): EmojiMartData {
  const index = buildKeywordIndex(emojibaseData);
  const sourceData = rawEmojiData as EmojiMartData;
  const emojisWithKeywords: Record<string, EmojiEntry> = {};

  for (const [id, emoji] of Object.entries(sourceData.emojis)) {
    const defaultSkin = emoji.skins[0];
    const keywords = defaultSkin ? findKeywords(index, defaultSkin.unified) : undefined;

    emojisWithKeywords[id] = keywords
      ? { ...emoji, keywords: [...(emoji.keywords ?? []), ...keywords] }
      : emoji;
  }

  return {
    ...sourceData,
    emojis: emojisWithKeywords,
  };
}
