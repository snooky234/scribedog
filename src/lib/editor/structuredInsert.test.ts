import { describe, expect, it } from "vitest";

import { completeTableRowMarkdown } from "./structuredInsert";

const HEADER = ["Person", "Idea", "Budget", "Status"];

describe("completeTableRowMarkdown", () => {
  it("prefixes header and delimiter for a bare row", () => {
    const result = completeTableRowMarkdown("| Lisa | Cooking class | 90 € | Pending |", HEADER);

    expect(result).toEqual({
      markdown: [
        "| Person | Idea | Budget | Status |",
        "| --- | --- | --- | --- |",
        "| Lisa | Cooking class | 90 € | Pending |"
      ].join("\n"),
      skipRows: 1
    });
  });

  // The tool description tells the agent to append by passing the last row plus
  // the new ones — both have to survive as body rows.
  it("keeps every proposed row", () => {
    const result = completeTableRowMarkdown(
      "| Tom | Vinyl | 60 € | Idea |\n| Lisa | Cooking class | 90 € | Pending |",
      HEADER
    );

    expect(result?.skipRows).toBe(1);
    expect(result?.markdown.split("\n")).toHaveLength(4);
  });

  it("leaves a table that already carries its own header alone", () => {
    const markdown = ["| A | B |", "| --- | --- |", "| 1 | 2 |"].join("\n");

    expect(completeTableRowMarkdown(markdown, HEADER)).toEqual({ markdown, skipRows: 0 });
  });

  it("accepts an alignment delimiter as a header of its own", () => {
    const markdown = ["| A | B |", "|:--:|---:|", "| 1 | 2 |"].join("\n");

    expect(completeTableRowMarkdown(markdown, HEADER)?.skipRows).toBe(0);
  });

  it("ignores markdown that isn't row-shaped", () => {
    expect(completeTableRowMarkdown("Just a sentence.", HEADER)).toBeNull();
    expect(completeTableRowMarkdown("- [ ] A task", HEADER)).toBeNull();
    // A single mid-row cell edit stays an inline replacement.
    expect(completeTableRowMarkdown("Cooking class voucher", HEADER)).toBeNull();
  });

  it("needs a header to rebuild from", () => {
    expect(completeTableRowMarkdown("| Lisa | 90 € |", [])).toBeNull();
  });
});
