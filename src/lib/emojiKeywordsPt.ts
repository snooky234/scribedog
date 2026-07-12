import emojibasePt from "emojibase-data/pt/data.json";

import { buildLocalizedEmojiData, type EmojibaseEntry } from "@/lib/emojiKeywords";

export const emojiDataPt = buildLocalizedEmojiData(emojibasePt as EmojibaseEntry[]);
