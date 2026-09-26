import { describe, expect, it } from "vitest";

import {
  collectWrittenMarkdown,
  mermaidDiagnosticsNote,
  mermaidSyntaxNote,
  repairMermaidBlocks,
  repairWrittenMermaid
} from "./mermaidToolCheck";

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

describe("mermaidDiagnosticsNote", () => {
  it("stays silent for a text without diagrams", async () => {
    expect(await mermaidDiagnosticsNote("# Hi\n\ntext", brokenIfContainsBang)).toBeNull();
  });

  it("never loads the validator when there is no fence", async () => {
    let calls = 0;
    const counting = async (source: string) => {
      calls += 1;
      return brokenIfContainsBang(source);
    };

    expect(await mermaidDiagnosticsNote("```ts\nconst a = 1;\n```", counting)).toBeNull();
    expect(calls).toBe(0);
  });

  it("stays silent for a valid diagram", async () => {
    expect(
      await mermaidDiagnosticsNote("```mermaid\nflowchart TD\n  A --> B\n```", brokenIfContainsBang)
    ).toBeNull();
  });

  it("names the broken diagram, its position and the parser message", async () => {
    const markdown = [
      "```mermaid",
      "flowchart TD",
      "  A --> B",
      "```",
      "",
      "text between",
      "",
      "```mermaid",
      "flowchart TD",
      "  A[Label (!)] --> B",
      "```"
    ].join("\n");

    const note = await mermaidDiagnosticsNote(markdown, brokenIfContainsBang);

    expect(note).toContain("Diagram 2 of 2: Parse error on line 2");
    expect(note).not.toContain("Diagram 1 of 2");
    // The whole point of the note: the model cannot see the red box otherwise.
    expect(note).toContain("red error box");
  });

  it("reports every broken diagram", async () => {
    const one = "```mermaid\nflowchart TD\n  A[!] --> B\n```";
    const note = await mermaidDiagnosticsNote(`${one}\n\n${one}`, brokenIfContainsBang);

    expect(note).toContain("Diagram 1 of 2");
    expect(note).toContain("Diagram 2 of 2");
  });
});

// Stands in for the real repair: uppercases the diagram, and refuses anything
// with "?" in it the way repairMermaid refuses what it cannot verify.
const fakeRepair = async (source: string) =>
  source.includes("?") ? null : source.toUpperCase();

const diagram = (body: string) => "```mermaid\n" + body + "\n```";

describe("repairMermaidBlocks", () => {
  it("leaves a text without diagrams untouched", async () => {
    const result = await repairMermaidBlocks("# Hi\n\ntext", fakeRepair);

    expect(result).toEqual({ text: "# Hi\n\ntext", repaired: 0 });
  });

  it("reports nothing when the repair declines", async () => {
    const markdown = diagram("flowchart TD\n  A[?] --> B");
    const result = await repairMermaidBlocks(markdown, fakeRepair);

    expect(result).toEqual({ text: markdown, repaired: 0 });
  });

  it("rewrites the block body and keeps the surrounding text", async () => {
    const markdown = `# Title\n\n${diagram("flowchart TD\n  a --> b")}\n\nafter`;
    const result = await repairMermaidBlocks(markdown, fakeRepair);

    expect(result.repaired).toBe(1);
    expect(result.text).toContain("FLOWCHART TD");
    expect(result.text).toContain("# Title");
    expect(result.text).toContain("after");
    expect(result.text).toContain("```mermaid");
  });

  it("leaves an unclosed fence alone, since it may be half an edit", async () => {
    const markdown = "```mermaid\nflowchart TD\n  a --> b";
    const result = await repairMermaidBlocks(markdown, fakeRepair);

    expect(result).toEqual({ text: markdown, repaired: 0 });
  });
});

describe("repairWrittenMermaid", () => {
  it("returns null when nothing needed fixing", async () => {
    expect(await repairWrittenMermaid({ content: "# Hi" }, fakeRepair)).toBeNull();
  });

  it("repairs every text-carrying argument", async () => {
    const result = await repairWrittenMermaid(
      { path: "a.md", content: diagram("graph TD\n  a --> b") },
      fakeRepair
    );

    expect(result?.repaired).toBe(1);
    expect(result?.args.content).toContain("GRAPH TD");
    // Arguments that are not Markdown ride along untouched.
    expect(result?.args.path).toBe("a.md");
  });

  it("repairs multi_edit entries without mutating the input", async () => {
    const args = { edits: [{ old_text: "x", new_text: diagram("graph TD\n  a --> b") }] };
    const result = await repairWrittenMermaid(args, fakeRepair);

    expect(result?.repaired).toBe(1);
    const edits = result?.args.edits as { new_text: string; old_text: string }[];

    expect(edits[0].new_text).toContain("GRAPH TD");
    expect(edits[0].old_text).toBe("x");
    // The caller's object must survive: the tool result quotes it afterwards.
    expect(args.edits[0].new_text).toContain("graph TD");
  });
});
