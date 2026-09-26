import { describe, expect, it } from "vitest";

import { collectWrittenMarkdown, mermaidSyntaxNote } from "./mermaidToolCheck";

const identity = (text: string) => text;
const brokenIfContainsBang = async (source: string) => (source.includes("!") ? "Parse error on line 2" : null);

describe("collectWrittenMarkdown", () => {
  it("reads every argument a writing tool carries Markdown in", () => {
    expect(
      collectWrittenMarkdown({
        path: "a.md",
        content: "c",
        new_text: "n",
        text: "t",
        edits: [{ new_text: "e1" }, { old_text: "x" }, null]
      })
    ).toEqual(["c", "n", "t", "e1"]);
  });
});

describe("mermaidSyntaxNote", () => {
  it("stays silent without diagrams", async () => {
    expect(await mermaidSyntaxNote({ content: "# Hi" }, identity, brokenIfContainsBang)).toBeNull();
  });

  it("stays silent for valid diagrams", async () => {
    const args = { content: "```mermaid\nflowchart TD\n  A --> B\n```" };

    expect(await mermaidSyntaxNote(args, identity, brokenIfContainsBang)).toBeNull();
  });

  it("names the broken diagram and the parser message", async () => {
    const args = { content: "```mermaid\npie\n```\n\n```mermaid\nflowchart TD\n  A -->! B\n```" };
    const note = await mermaidSyntaxNote(args, identity, brokenIfContainsBang);

    expect(note).toContain("Diagram 2 of 2: Parse error on line 2");
    expect(note).not.toContain("Diagram 1 of 2");
  });

  it("decodes escaped line breaks before looking for fences", async () => {
    const args = { new_text: "```mermaid\\nflowchart TD\\n  A -->! B\\n```" };
    const decode = (text: string) => text.replace(/\\n/g, "\n");

    expect(await mermaidSyntaxNote(args, decode, brokenIfContainsBang)).toContain("Diagram 1 of 1");
  });
});
