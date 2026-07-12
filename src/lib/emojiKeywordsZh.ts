import emojibaseZh from "emojibase-data/zh/data.json";

import { buildLocalizedEmojiData, type EmojibaseEntry } from "@/lib/emojiKeywords";

export const emojiDataZh = buildLocalizedEmojiData(emojibaseZh as EmojibaseEntry[]);
