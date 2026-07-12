import emojibaseRu from "emojibase-data/ru/data.json";

import { buildLocalizedEmojiData, type EmojibaseEntry } from "@/lib/emojiKeywords";

export const emojiDataRu = buildLocalizedEmojiData(emojibaseRu as EmojibaseEntry[]);
