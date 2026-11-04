// The tab the emoji picker was left on (Emoji or Icons), so that someone who
// works with icons does not have to switch to them at every opening. A
// per-person convenience: localStorage, and the picker works without it.

export type EmojiPickerTab = "emoji" | "icons";

const STORAGE_KEY = "scribedog-emoji-picker-tab";

export function readEmojiPickerTab(): EmojiPickerTab {
  try {
    return window.localStorage.getItem(STORAGE_KEY) === "icons" ? "icons" : "emoji";
  } catch {
    return "emoji";
  }
}

export function rememberEmojiPickerTab(tab: EmojiPickerTab): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, tab);
  } catch {
    // Private window or blocked storage: the picker opens on Emoji each time.
  }
}
