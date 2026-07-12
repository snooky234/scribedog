import emojibaseEs from "emojibase-data/es/data.json";

import { buildLocalizedEmojiData, type EmojibaseEntry } from "@/lib/emojiKeywords";

export const emojiDataEs = buildLocalizedEmojiData(emojibaseEs as EmojibaseEntry[]);
