import emojibaseFr from "emojibase-data/fr/data.json";

import { buildLocalizedEmojiData, type EmojibaseEntry } from "@/lib/emojiKeywords";

export const emojiDataFr = buildLocalizedEmojiData(emojibaseFr as EmojibaseEntry[]);
