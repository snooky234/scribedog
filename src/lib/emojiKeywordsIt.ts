import emojibaseIt from "emojibase-data/it/data.json";

import { buildLocalizedEmojiData, type EmojibaseEntry } from "@/lib/emojiKeywords";

export const emojiDataIt = buildLocalizedEmojiData(emojibaseIt as EmojibaseEntry[]);
