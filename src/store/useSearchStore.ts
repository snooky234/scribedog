import { create } from "zustand";

// The find & replace panel lives inside <Editor>, which is remounted per
// file (key={selectedFilePath}). Everything that must survive a file switch
// — the query, options, panel visibility, and the cross-file navigation
// target — therefore lives here instead of in component state.

// matchIndex -1 means "last match in that file" (used when navigating
// backwards into the previous file).
export type PendingSearchTarget = {
  filePath: string;
  matchIndex: number;
} | null;

type SearchState = {
  isPanelOpen: boolean;
  focusRequestId: number;
  query: string;
  replaceText: string;
  caseSensitive: boolean;
  wholeWord: boolean;
  allFiles: boolean;
  // filePath -> match count, feeds the sidebar badges while an all-files
  // search is active.
  fileMatchCounts: Record<string, number>;
  pendingTarget: PendingSearchTarget;
  openPanel: () => void;
  closePanel: () => void;
  setQuery: (query: string) => void;
  setReplaceText: (replaceText: string) => void;
  setCaseSensitive: (caseSensitive: boolean) => void;
  setWholeWord: (wholeWord: boolean) => void;
  setAllFiles: (allFiles: boolean) => void;
  setFileMatchCounts: (fileMatchCounts: Record<string, number>) => void;
  setPendingTarget: (pendingTarget: PendingSearchTarget) => void;
};

export const useSearchStore = create<SearchState>((set) => ({
  isPanelOpen: false,
  focusRequestId: 0,
  query: "",
  replaceText: "",
  caseSensitive: false,
  wholeWord: false,
  allFiles: false,
  fileMatchCounts: {},
  pendingTarget: null,
  openPanel: () =>
    set((state) => ({ isPanelOpen: true, focusRequestId: state.focusRequestId + 1 })),
  closePanel: () => set({ isPanelOpen: false, fileMatchCounts: {}, pendingTarget: null }),
  setQuery: (query) => set({ query }),
  setReplaceText: (replaceText) => set({ replaceText }),
  setCaseSensitive: (caseSensitive) => set({ caseSensitive }),
  setWholeWord: (wholeWord) => set({ wholeWord }),
  setAllFiles: (allFiles) => set({ allFiles }),
  setFileMatchCounts: (fileMatchCounts) => set({ fileMatchCounts }),
  setPendingTarget: (pendingTarget) => set({ pendingTarget })
}));
