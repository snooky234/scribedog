import { create } from "zustand";

const NOTICE_DURATION_MS = 4000;

/**
 * The one-line, self-dismissing hint at the bottom of the window (rendered in
 * App): the place for "not now, because ..." answers and short confirmations
 * that do not deserve a dialog. A store rather than App state, so a menu
 * entry deep in the tree can confirm what it did.
 */
type NoticeState = {
  message: string | null;
  show: (message: string) => void;
};

let timer: ReturnType<typeof setTimeout> | null = null;

export const useNoticeStore = create<NoticeState>((set) => ({
  message: null,
  show: (message) => {
    if (timer) {
      clearTimeout(timer);
    }

    set({ message });
    timer = setTimeout(() => {
      timer = null;
      set({ message: null });
    }, NOTICE_DURATION_MS);
  }
}));
