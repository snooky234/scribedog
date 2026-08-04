import { describe, expect, it } from "vitest";
import { Schema } from "@tiptap/pm/model";

import { buildStagedPreview } from "./stagedPreview";

const schema = new Schema({
  nodes: {
    doc: { content: "block+" },
    paragraph: { content: "inline*", group: "block" },
    text: { group: "inline" }
  }
});

function docOf(...paragraphs: string[]) {
  return schema.node(
    "doc",
    null,
    paragraphs.map((text) => schema.node("paragraph", null, text ? [schema.text(text)] : []))
  );
}

const POEM = "# Lavendel\n\nIm Feld, so lila, weit und breit,\nSteht Lavendel in Sommerzeit.";

describe("buildStagedPreview", () => {
  // A file the agent proposed into existence: the editor holds an empty
  // document, and the whole proposal is one green block.
  it("proposes a new file as a collapsed insertion inside the first block", () => {
    const doc = docOf("");
    const preview = buildStagedPreview(doc, "", POEM);

    expect(preview.suggestions).toHaveLength(1);
    expect(preview.missing).toBe(0);

    const [suggestion] = preview.suggestions;

    // Collapsed, and *inside* the paragraph rather than spanning it: an inline
    // decoration that reaches across a block's boundaries is dropped by
    // prosemirror-view, and the review renders nothing at all.
    expect(suggestion.from).toBe(suggestion.to);
    expect(suggestion.from).toBeGreaterThan(0);
    expect(suggestion.from).toBeLessThan(doc.content.size);
    expect(suggestion.replacement).toBe(POEM);
  });

  it("proposes nothing for a new file with no content", () => {
    expect(buildStagedPreview(docOf(""), "", "   ").suggestions).toEqual([]);
  });

  it("locates a changed line as a range covering it", () => {
    const doc = docOf("Erste Zeile bleibt.", "Zweite Zeile wird geändert.", "Dritte Zeile bleibt.");
    const preview = buildStagedPreview(
      doc,
      "Erste Zeile bleibt.\nZweite Zeile wird geändert.\nDritte Zeile bleibt.",
      "Erste Zeile bleibt.\nZweite Zeile ist jetzt anders.\nDritte Zeile bleibt."
    );

    expect(preview.missing).toBe(0);
    expect(preview.suggestions).toHaveLength(1);
    expect(doc.textBetween(preview.suggestions[0].from, preview.suggestions[0].to, "\n")).toContain(
      "Zweite Zeile wird geändert."
    );
  });

  it("reports a hunk whose original is no longer in the document", () => {
    // The file changed outside the app since the agent read it.
    const doc = docOf("Etwas ganz anderes steht hier inzwischen.");
    const preview = buildStagedPreview(doc, "Die Zeile, die der Agent gelesen hat.", "Die neue Zeile.");

    expect(preview.suggestions).toHaveLength(0);
    expect(preview.missing).toBe(1);
  });

  it("proposes nothing when the content is unchanged", () => {
    const doc = docOf("Unverändert.");

    expect(buildStagedPreview(doc, "Unverändert.", "Unverändert.").suggestions).toEqual([]);
  });
});
