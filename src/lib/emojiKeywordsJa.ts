import emojibaseJa from "emojibase-data/ja/data.json";

import { buildLocalizedEmojiData, type EmojibaseEntry } from "@/lib/emojiKeywords";

export const emojiDataJa = buildLocalizedEmojiData(emojibaseJa as EmojibaseEntry[]);
