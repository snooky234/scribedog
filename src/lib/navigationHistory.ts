/**
 * Back/forward history of opened notes — the browser model: visiting a note
 * from anywhere (sidebar, a link in the text, the backlinks panel, a search
 * hit) pushes an entry and drops whatever was ahead, while back and forward
 * only move the position inside the list.
 *
 * Pure on purpose: the store around it (useNavigationHistoryStore) holds this
 * value and nothing else, so the stepping rules stay testable.
 */

export const MAX_NAVIGATION_HISTORY = 50;

export type NavigationHistory = {
  entries: string[];
  /** Position in `entries` — always the note currently open, -1 while empty. */
  index: number;
};

export const EMPTY_NAVIGATION_HISTORY: NavigationHistory = { entries: [], index: -1 };

export function visitPath(history: NavigationHistory, filePath: string): NavigationHistory {
  // Reopening the note that is already current is not a navigation step.
  if (history.entries[history.index] === filePath) {
    return history;
  }

  const entries = [...history.entries.slice(0, history.index + 1), filePath];
  const overflow = Math.max(0, entries.length - MAX_NAVIGATION_HISTORY);

  return { entries: entries.slice(overflow), index: entries.length - overflow - 1 };
}

/**
 * Where a back (`-1`) or forward (`1`) step lands, or `null` when there is
 * nothing left in that direction. Entries whose file no longer exists — deleted
 * or renamed meanwhile — are skipped rather than opened into an error state.
 */
export function findStepIndex(
  history: NavigationHistory,
  direction: -1 | 1,
  availableFilePaths: Iterable<string>
): number | null {
  const availablePathSet = new Set(availableFilePaths);

  for (
    let candidate = history.index + direction;
    candidate >= 0 && candidate < history.entries.length;
    candidate += direction
  ) {
    if (availablePathSet.has(history.entries[candidate])) {
      return candidate;
    }
  }

  return null;
}
