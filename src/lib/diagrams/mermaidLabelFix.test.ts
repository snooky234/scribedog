// @vitest-environment jsdom
//
// These run against the real Mermaid parser on purpose. The repair claims
// "this source is valid afterwards", and only Mermaid can confirm that — a
// mock would just restate my assumptions about its grammar.

import { describe, expect, it } from "vitest";

import { quoteMermaidLabels } from "./mermaidLabelFix";
import { repairWrittenMermaid } from "./mermaidToolCheck";
import { lineFixHint, parseErrorLine, repairMermaid } from "./mermaidRepair";

async function validate(source: string): Promise<string | null> {
  const mermaid = (await import("mermaid")).default;
  mermaid.initialize({ startOnLoad: false, securityLevel: "strict", suppressErrorRendering: true });

  try {
    await mermaid.parse(source);
    return null;
  } catch (error) {
    return (error as Error).message;
  }
}

// The diagram from the bug report, written by gemma-4-E4B.
const BROKEN = [
  "graph TD",
  "    A[Start] --> B{Vorbereitung}",
  "    G --> H[Backen (45-55 Min.)]",
  "    J --> K[Fertigstellung (Puderzucker)]",
  "    K --> L[Ende]"
].join("\n");

describe("quoteMermaidLabels", () => {
  it("quotes a label with parentheses", () => {
    expect(quoteMermaidLabels("graph TD\n    A[Backen (45 Min.)]")).toContain('A["Backen (45 Min.)"]');
  });

  it("leaves a diagram that needs nothing alone", () => {
    expect(quoteMermaidLabels("graph TD\n    A[Start] --> B[Ende]")).toBeNull();
  });

  it("does not double-quote an already quoted label", () => {
    expect(quoteMermaidLabels('graph TD\n    A["Backen (45 Min.)"] --> B[Ende]')).toBeNull();
  });

  it("refuses a label containing a double quote, which quoting cannot save", () => {
    expect(quoteMermaidLabels('graph TD\n    A[say "hi" (now)]')).toBeNull();
  });

  it("fixes both labels on one line", () => {
    const fixed = quoteMermaidLabels("graph TD\n    A[Plan (x)] --> B[Bake (y)]") ?? "";

    expect(fixed).toContain('A["Plan (x)"]');
    expect(fixed).toContain('B["Bake (y)"]');
  });

  it("quotes an edge label", () => {
    expect(quoteMermaidLabels("graph TD\n    A -->|yes (n)| B")).toContain('|"yes (n)"|');
  });

  it("leaves comments alone", () => {
    expect(quoteMermaidLabels("graph TD\n    %% a note (here)\n    A --> B")).toBeNull();
  });
});

describe("repairMermaid", () => {
  it("repairs the diagram from the bug report, verified by the parser", async () => {
    expect(await validate(BROKEN)).not.toBeNull();

    const repaired = await repairMermaid(BROKEN, validate);

    expect(repaired).not.toBeNull();
    expect(await validate(repaired as string)).toBeNull();
    expect(repaired).toContain('H["Backen (45-55 Min.)"]');
  });

  it("never touches a diagram that already parses", async () => {
    const valid = "graph TD\n    A[Start] --> B[Ende]";

    expect(await repairMermaid(valid, validate)).toBeNull();
  });

  it("gives up rather than returning a still-broken source", async () => {
    // Not a label problem at all, so quoting cannot help.
    const broken = "graph TD\n    A --> --> B";

    expect(await repairMermaid(broken, validate)).toBeNull();
  });

  it("repairs every node shape", async () => {
    for (const [open, close] of [["[", "]"], ["(", ")"], ["{", "}"], ["([", "])"], ["[[", "]]"]]) {
      const source = `graph TD\n    X --> Y${open}Backen (45 Min.)${close}\n    Y --> Z[End]`;
      const repaired = await repairMermaid(source, validate);

      expect(repaired, `${open}${close}`).not.toBeNull();
      expect(await validate(repaired as string), `${open}${close}`).toBeNull();
    }
  });
});

describe("lineFixHint", () => {
  it("reads the line number out of Mermaid's message", () => {
    expect(parseErrorLine("Parse error on line 8:\n...")).toBe(8);
    expect(parseErrorLine("something else")).toBeNull();
  });

  it("names the offending line and its corrected form", async () => {
    const message = (await validate(BROKEN)) ?? "";
    const hint = lineFixHint(BROKEN, message);

    expect(hint).toContain("G --> H[Backen (45-55 Min.)]");
    expect(hint).toContain('G --> H["Backen (45-55 Min.)"]');
  });

  it("stays empty when there is nothing concrete to suggest", () => {
    expect(lineFixHint("graph TD\n    A --> B", "Parse error on line 2:")).toBe("");
    expect(lineFixHint(BROKEN, "no line number here")).toBe("");
  });
});

// The whole path, on the diagram from the bug report: a model's write_file
// arguments in, a document that renders out.
describe("e2e: the marble cake diagram", () => {
  it("is written to the document in a form that renders", async () => {
    const body = [
      "graph TD",
      "    A[Start] --> B{Vorbereitung}",
      "    B --> C[Ofen vorheizen & Form vorbereiten]",
      "    G --> H[Backen (45-55 Min.)]",
      "    J --> K[Fertigstellung (Puderzucker)]",
      "    K --> L[Ende]"
    ].join("\n");
    const args = { path: "Mermaid.md", content: `## Zubereitung\n\n\`\`\`mermaid\n${body}\n\`\`\`\n` };

    expect(await validate(body)).not.toBeNull();

    const result = await repairWrittenMermaid(args, (s) => repairMermaid(s, validate));
    expect(result?.repaired).toBe(1);

    const written = result?.args.content as string;
    const fixed = written.split("```mermaid\n")[1].split("\n```")[0];
    expect(await validate(fixed)).toBeNull();
    expect(fixed).toContain('H["Backen (45-55 Min.)"]');
    expect(fixed).toContain('K["Fertigstellung (Puderzucker)"]');
    expect(fixed).toContain("B --> C[Ofen vorheizen & Form vorbereiten]");
    expect(written).toContain("## Zubereitung");
  });
});
