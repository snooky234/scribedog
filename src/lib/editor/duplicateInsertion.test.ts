import { describe, expect, it } from "vitest";
import { Schema } from "@tiptap/pm/model";

import { isDuplicateInsertion, rewrittenAnchorRange } from "./duplicateInsertion";
import { findTextRange } from "./textSearch";

// The case this guard exists for, reproduced: a poem the agent was asked to
// rework. Asked to "work the suggestion in", the model reaches for
// insert_at_cursor with after_text pointing at the very line it is rewriting —
// and the document ends up with the old line and the new one underneath it.

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

const POEM = docOf(
  "In einem kleinen Haus, ganz still und fein,",
  "Da lebte Pips, ein Zwerg ganz klein.",
  "Mit goldenem Fell und Augen so klar,",
  "Ein Zwerg mit Charme, ganz wunderbar."
);

/** The anchor's own range, the way resolveInsertAnchor hands it over. */
function anchorOf(doc: ReturnType<typeof docOf>, anchor: string) {
  const range = findTextRange(doc, 0, doc.content.size, anchor);

  if (!range) {
    throw new Error(`anchor not found: ${anchor}`);
  }

  return range;
}

function replaced(doc: ReturnType<typeof docOf>, anchor: string, markdown: string) {
  const range = rewrittenAnchorRange(doc, anchorOf(doc, anchor), markdown);

  return range ? doc.textBetween(range.from, range.to, "\n") : null;
}

describe("rewrittenAnchorRange", () => {
  // The bug, in the shape it actually took: the model anchors at the line it is
  // rewriting and passes the rewritten line as the text to insert. Read as an
  // insertion that leaves the old line above the new one; read as a revision it
  // is exactly a replace_passage.
  it("resolves a line rewritten in place to that line's range", () => {
    expect(
      replaced(POEM, "Ein Zwerg mit Charme, ganz wunderbar.", "Ein Zwerg mit Charme, ganz wunderbar,")
    ).toBe("Ein Zwerg mit Charme, ganz wunderbar.");
  });

  it("resolves a verbatim re-emission too", () => {
    expect(
      replaced(POEM, "Ein Zwerg mit Charme, ganz wunderbar.", "Ein Zwerg mit Charme, ganz wunderbar.")
    ).toBe("Ein Zwerg mit Charme, ganz wunderbar.");
  });

  it("covers the whole stanza when the model re-emits it from the anchor on", () => {
    const stanza = [
      "Mit goldenem Fell und Augen so klar,",
      "Ein Zwerg mit Charme, ganz wunderbar,"
    ].join("\n");

    expect(replaced(POEM, "Mit goldenem Fell und Augen so klar,", stanza)).toBe(
      "Mit goldenem Fell und Augen so klar,\nEin Zwerg mit Charme, ganz wunderbar."
    );
  });

  // The case that must keep working: text that adds something does not match
  // the passage it is placed after.
  it("answers null for a genuine insertion", () => {
    expect(
      replaced(
        POEM,
        "Ein Zwerg mit Charme, ganz wunderbar.",
        "Am Morgen lief er durch das hohe Gras und suchte nach dem Frühling."
      )
    ).toBeNull();
  });

  // A refrain repeated somewhere else matches *later* in the document, not at
  // the anchor — so it stays an insertion.
  it("answers null when the text matches only further down the document", () => {
    const doc = docOf(
      "Und wieder sang er leise in die kalte Winternacht hinein.",
      "Dazwischen lag ein langer, stiller Tag voller kleiner Dinge.",
      "Ein Zwerg mit Charme, ganz wunderbar."
    );

    expect(
      replaced(doc, "Dazwischen lag ein langer, stiller Tag voller kleiner Dinge.", "Ein Zwerg mit Charme, ganz wunderbar.")
    ).toBeNull();
  });

  it("answers null for an empty insertion", () => {
    expect(replaced(POEM, "Ein Zwerg mit Charme, ganz wunderbar.", "   ")).toBeNull();
  });
});

describe("isDuplicateInsertion", () => {
  it("catches a line the model re-emitted verbatim", () => {
    expect(isDuplicateInsertion(POEM, "Ein Zwerg mit Charme, ganz wunderbar.")).toBe(true);
  });

  // The shape this bug actually took: the model "fixes" a line's punctuation
  // and inserts the fixed copy under the original.
  it("catches a line that differs only in its final punctuation", () => {
    expect(isDuplicateInsertion(POEM, "Ein Zwerg mit Charme, ganz wunderbar,")).toBe(true);
  });

  it("catches a whole stanza the model re-emitted with one line changed", () => {
    const stanza = [
      "In einem kleinen Haus, ganz still und fein,",
      "Da lebte Pips, ein Zwerg ganz klein.",
      "Mit goldenem Fell und Augen so klar,",
      "Ein Zwerg mit Charme, ganz wunderbar,"
    ].join("\n");

    expect(isDuplicateInsertion(POEM, stanza)).toBe(true);
  });

  it("catches it through Markdown markup the document text does not carry", () => {
    expect(isDuplicateInsertion(POEM, "Ein **Zwerg** mit Charme, ganz wunderbar.")).toBe(true);
  });

  // One new line is enough: the model is adding, not rewriting.
  it("lets a stanza through that repeats a line but adds a new one", () => {
    const stanza = [
      "Ein Zwerg mit Charme, ganz wunderbar.",
      "Und jeden Abend, wenn der Mond aufging, sang er ein Lied."
    ].join("\n");

    expect(isDuplicateInsertion(POEM, stanza)).toBe(false);
  });

  it("lets genuinely new text through", () => {
    expect(
      isDuplicateInsertion(POEM, "Am Morgen lief er durch das hohe Gras und suchte nach dem Frühling.")
    ).toBe(false);
  });

  it("lets an insertion into an empty document through", () => {
    expect(isDuplicateInsertion(docOf(""), "Ein Zwerg mit Charme, ganz wunderbar.")).toBe(false);
  });

  // Refusing "Ja." because the word occurs somewhere would block ordinary work,
  // and a line that short was never the re-emitted passage this guard is about.
  it("leaves a short insertion alone", () => {
    expect(isDuplicateInsertion(docOf("Ja. Und dann gingen wir nach Hause."), "Ja.")).toBe(false);
  });

  // A separator or a bare list marker says nothing about duplication.
  it("ignores structural lines when deciding", () => {
    expect(isDuplicateInsertion(POEM, "---")).toBe(false);
    expect(
      isDuplicateInsertion(POEM, "---\nEin Zwerg mit Charme, ganz wunderbar.")
    ).toBe(true);
  });

  it("answers false for an empty or whitespace-only insertion", () => {
    expect(isDuplicateInsertion(POEM, "")).toBe(false);
    expect(isDuplicateInsertion(POEM, "   \n\n  ")).toBe(false);
  });
});
