import emojibaseDe from "emojibase-data/de/data.json";

import { buildLocalizedEmojiData, type EmojibaseEntry } from "@/lib/emojiKeywords";

export const emojiDataDe = buildLocalizedEmojiData(emojibaseDe as EmojibaseEntry[]);
