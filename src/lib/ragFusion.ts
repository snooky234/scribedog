// Merges the knowledge base's two result lists into one.
//
// Keyword search and meaning search answer different questions well: the first
// finds names, project numbers and exact wording, the second finds a passage
// that says the same thing in other words. Their scores are not comparable at
// all (BM25 is unbounded, cosine sits in [-1, 1]), so nothing is added up —
// only the *positions* are, which is what Reciprocal Rank Fusion does.

/**
 * The damping constant from the original RRF paper. Large enough that the top
 * of a list is not overwhelming: a passage found by both searches should beat
 * one that merely leads a single list, which is the whole point of running two.
 */
const RRF_K = 60;

/**
 * Fuses ranked lists by reciprocal rank.
 *
 * The first list wins ties for the *item* that represents a key, which is
 * deliberate: the keyword hit carries a snippet centred on the search terms,
 * while a vector hit can only ever start its preview at the top of the passage.
 */
export function fuseByReciprocalRank<T>(
  lists: readonly (readonly T[])[],
  keyOf: (item: T) => string,
  limit: number
): T[] {
  const scores = new Map<string, number>();
  const items = new Map<string, T>();

  for (const list of lists) {
    list.forEach((item, index) => {
      const key = keyOf(item);

      scores.set(key, (scores.get(key) ?? 0) + 1 / (RRF_K + index + 1));

      if (!items.has(key)) {
        items.set(key, item);
      }
    });
  }

  return [...scores.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, Math.max(limit, 0))
    .map(([key]) => items.get(key) as T);
}
