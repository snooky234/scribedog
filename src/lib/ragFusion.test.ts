import { describe, expect, it } from "vitest";

import { fuseByReciprocalRank } from "./ragFusion";

// The knowledge base runs a keyword and a meaning search and shows one list.
// What that fusion has to guarantee is pinned here: agreement between the two
// searches counts for more than leading one of them, the same passage never
// appears twice, and the keyword hit is the one the user gets to see (its
// snippet is centred on the search terms).

type Hit = { key: string; from: string };

const keyOf = (hit: Hit) => hit.key;

describe("reciprocal rank fusion", () => {
  it("puts a passage both searches found above one that only leads a single list", () => {
    const keyword: Hit[] = [{ key: "a", from: "keyword" }, { key: "b", from: "keyword" }];
    const semantic: Hit[] = [{ key: "c", from: "semantic" }, { key: "b", from: "semantic" }];

    expect(fuseByReciprocalRank([keyword, semantic], keyOf, 3).map(keyOf)).toEqual(["b", "a", "c"]);
  });

  it("keeps the first list's version of a passage both lists carry", () => {
    const fused = fuseByReciprocalRank(
      [[{ key: "a", from: "keyword" }], [{ key: "a", from: "semantic" }]],
      keyOf,
      5
    );

    expect(fused).toEqual([{ key: "a", from: "keyword" }]);
  });

  it("preserves a single list's order", () => {
    const only: Hit[] = [
      { key: "a", from: "keyword" },
      { key: "b", from: "keyword" },
      { key: "c", from: "keyword" }
    ];

    expect(fuseByReciprocalRank([only], keyOf, 10).map(keyOf)).toEqual(["a", "b", "c"]);
  });

  it("cuts to the limit and copes with empty input", () => {
    const keyword: Hit[] = [
      { key: "a", from: "keyword" },
      { key: "b", from: "keyword" }
    ];

    expect(fuseByReciprocalRank([keyword, []], keyOf, 1).map(keyOf)).toEqual(["a"]);
    expect(fuseByReciprocalRank([[], []], keyOf, 5)).toEqual([]);
  });
});
