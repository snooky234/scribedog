import { describe, expect, it } from "vitest";

import { parseMarkdownToBlocks, type TableCell } from "./markdownModel";
import { computeColumnShares, measureTableColumns, rowsFitWhole } from "./tableColumns";

function rows(markdown: string): TableCell[][] {
  const [block] = parseMarkdownToBlocks(markdown);

  if (block.kind !== "table") {
    throw new Error("expected table");
  }

  return block.rows;
}

const WIDTH = 451;
const SIZE = 10.5;

describe("measureTableColumns", () => {
  it("measures the longest line and the longest word per column", () => {
    const measures = measureTableColumns(rows("| A | B |\n| - | - |\n| eins | zwei drei<br>vierfünfsechs |\n"));

    expect(measures).toEqual([
      { minChars: 4, maxChars: 4 },
      { minChars: 13, maxChars: 13 }
    ]);
  });
});

describe("computeColumnShares", () => {
  it("gives a long notes column most of the width instead of an equal third", () => {
    const table = rows(
      [
        "| Name | Wert | Notiz |",
        "| --- | --- | --- |",
        "| Zeile 1 | 93 | Ullamco nulla eiusmod voluptate sunt laboris qui elit fugiat and a good deal more text. |",
        "| Zeile 2 | 456 | Velit pariatur non sit culpa culpa pariatur and yet more text in this cell. |"
      ].join("\n")
    );
    const shares = computeColumnShares(table, WIDTH, SIZE);

    expect(shares.reduce((sum, share) => sum + share, 0)).toBeCloseTo(1, 6);
    expect(shares[2]).toBeGreaterThan(0.6);
    // The short columns keep room for their longest word.
    expect(shares[0] * WIDTH).toBeGreaterThan(5 * SIZE * 0.56 + 9);
  });

  it("spreads a table that fits on one line in proportion to its content", () => {
    const shares = computeColumnShares(rows("| a | bbbb |\n| - | - |\n| a | bbbb |\n"), WIDTH, SIZE);

    expect(shares[1]).toBeGreaterThan(shares[0]);
    expect(shares.reduce((sum, share) => sum + share, 0)).toBeCloseTo(1, 6);
  });

  it("shares the width by longest word when not even those fit", () => {
    const word = "x".repeat(60);
    const shares = computeColumnShares(rows(`| ${word} | ${word} |\n| - | - |\n| a | b |\n`), WIDTH, SIZE);

    expect(shares[0]).toBeCloseTo(0.5, 6);
  });

  it("returns nothing for an empty table", () => {
    expect(computeColumnShares([], WIDTH, SIZE)).toEqual([]);
  });
});

describe("rowsFitWhole", () => {
  it("keeps ordinary rows whole", () => {
    expect(rowsFitWhole(rows("| A | B |\n| - | - |\n| one | two words |\n"), WIDTH, SIZE, 17, 698)).toBe(true);
  });

  it("lets a row taller than half a page split rather than be cut off", () => {
    const huge = "word ".repeat(3000);

    expect(rowsFitWhole(rows(`| A | B |\n| - | - |\n| one | ${huge} |\n`), WIDTH, SIZE, 17, 698)).toBe(false);
  });
});
