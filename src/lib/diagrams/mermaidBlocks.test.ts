import { describe, expect, it } from "vitest";

import { extractMermaidSources, isMermaidLanguage } from "./mermaidBlocks";

describe("isMermaidLanguage", () => {
  it("accepts the fence language regardless of case and padding", () => {
    expect(isMermaidLanguage("mermaid")).toBe(true);
    expect(isMermaidLanguage(" Mermaid ")).toBe(true);
    expect(isMermaidLanguage("markdown")).toBe(false);
    expect(isMermaidLanguage(null)).toBe(false);
  });
});

describe("extractMermaidSources", () => {
  it("returns the body of every closed mermaid fence", () => {
    const markdown = [
      "# Title",
      "```mermaid",
      "flowchart TD",
      "  A --> B",
      "```",
      "",
      "```js",
      "const a = 1;",
      "```",
      "~~~~mermaid",
      "sequenceDiagram",
      "~~~~"
    ].join("\n");

    expect(extractMermaidSources(markdown)).toEqual(["flowchart TD\n  A --> B", "sequenceDiagram"]);
  });

  it("skips an unclosed fence, as in an edit fragment", () => {
    expect(extractMermaidSources("```mermaid\nflowchart TD\n  A --> B")).toEqual([]);
  });

  it("does not read a mermaid fence inside another code block", () => {
    const markdown = ["````markdown", "```mermaid", "flowchart TD", "```", "````"].join("\n");

    expect(extractMermaidSources(markdown)).toEqual([]);
  });

  it("handles CRLF line endings", () => {
    expect(extractMermaidSources("```mermaid\r\npie\r\n```\r\n")).toEqual(["pie"]);
  });
});
