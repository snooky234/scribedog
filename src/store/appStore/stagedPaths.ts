import { normalizePathKey } from "./pathUtils";

/**
 * Files that exist only as a proposal: the vault agent has staged their
 * creation, so they are in the tree and can be opened, but nothing is on disk
 * yet (see src/store/useStagedChangesStore.ts).
 *
 * Registered from the staged-changes store rather than imported from it: that
 * store already reaches into the app store to apply a batch, and importing it
 * back here would close the cycle. Same shape as the editor bridge in
 * src/lib/chat/agentTools.ts, and for the same reason.
 *
 * What it protects: the folder refresh drops any open document that is no
 * longer on disk, which is right for a note deleted outside the app and wrong
 * for one that has not been written yet — without this, opening a proposed
 * note closes it again on the next watcher tick.
 */
let provider: (() => string[]) | null = null;

export function setStagedOnlyPathProvider(next: (() => string[]) | null): void {
  provider = next;
}

/** Absolute paths of files that are staged for creation, as comparison keys. */
export function stagedOnlyPathKeys(): Set<string> {
  if (!provider) {
    return new Set();
  }

  try {
    return new Set(provider().map(normalizePathKey));
  } catch {
    return new Set();
  }
}
