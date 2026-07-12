import emojibaseUk from "emojibase-data/uk/data.json";

import { buildLocalizedEmojiData, type EmojibaseEntry } from "@/lib/emojiKeywords";

export const emojiDataUk = buildLocalizedEmojiData(emojibaseUk as EmojibaseEntry[]);
