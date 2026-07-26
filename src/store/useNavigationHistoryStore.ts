import { create } from "zustand";

import {
  EMPTY_NAVIGATION_HISTORY,
  visitPath,
  type NavigationHistory
} from "@/lib/navigationHistory";

/**
 * Back/forward history of the opened notes. Session state only — a history that
 * survived a restart would point at files the user has long stopped thinking
 * about, so nothing here is persisted.
 *
 * Written from a single place: the effect in App that watches selectedFilePath
 * (see navigationIntentRef there), so every way a note gets opened — sidebar,
 * link click, backlinks panel, search hit, newly created file — lands in the
 * history exactly once.
 */
type NavigationHistoryState = {
  history: NavigationHistory;
  /** Records an opened note as a new entry, dropping the forward entries. */
  visit: (filePath: string) => void;
  /** Moves to an existing entry — the back/forward steps. */
  goTo: (index: number) => void;
  /** A different vault has nothing to do with the previous one's history. */
  reset: () => void;
};

export const useNavigationHistoryStore = create<NavigationHistoryState>((set) => ({
  history: EMPTY_NAVIGATION_HISTORY,
  visit: (filePath: string) => {
    set((state) => ({ history: visitPath(state.history, filePath) }));
  },
  goTo: (index: number) => {
    set((state) =>
      index >= 0 && index < state.history.entries.length
        ? { history: { ...state.history, index } }
        : state
    );
  },
  reset: () => set({ history: EMPTY_NAVIGATION_HISTORY })
}));
