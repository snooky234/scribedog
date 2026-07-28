import { describe, expect, it } from "vitest";
import { Schema } from "@tiptap/pm/model";

import { findTextRange } from "./textSearch";

// The passages handed to findTextRange come from a language model quoting the
// document back, so they are rarely character-identical to it. Every case here
// is one that used to come back as "passage not found" and sent the chat agent
// into a retry loop over a passage it had actually identified correctly.

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

function found(doc: ReturnType<typeof docOf>, searchText: string, fuzzy = true) {
  const range = findTextRange(doc, 0, doc.content.size, searchText, { fuzzy });

  return range ? doc.textBetween(range.from, range.to, "\n") : null;
}

describe("findTextRange", () => {
  it("finds a verbatim passage", () => {
    const doc = docOf("Der Hund läuft schnell über die große Wiese.", "Danach schläft er.");

    expect(found(doc, "läuft schnell über die")).toBe("läuft schnell über die");
  });

  it("finds a passage through Markdown markup the document text does not carry", () => {
    const doc = docOf("Der Hund läuft schnell über die große Wiese.");

    expect(found(doc, "läuft **schnell** über die")).toBe("läuft schnell über die");
  });

  it("finds a passage across a paragraph break", () => {
    const doc = docOf("Der Hund läuft.", "Danach schläft er.");

    expect(found(doc, "Der Hund läuft.\n\nDanach schläft er.")).toBe("Der Hund läuft.\nDanach schläft er.");
  });

  // A model that quotes a passage back regularly "tidies" its typography on the
  // way, and the result is a passage that differs from the document in nothing
  // that matters.
  it("ignores curly quotes, dashes and ellipses", () => {
    const doc = docOf('Er sagte "Hallo" - und ging dann... wortlos.');

    expect(found(doc, "Er sagte „Hallo“ – und ging dann… wortlos.")).toBe(
      'Er sagte "Hallo" - und ging dann... wortlos.'
    );
  });

  it("ignores capitalization", () => {
    const doc = docOf("Die Überschrift steht ganz oben.");

    expect(found(doc, "die überschrift steht")).toBe("Die Überschrift steht");
  });

  // The remaining case: the passage is the right one, but a word came back
  // swapped or a comma got lost. Reporting that as "not found" is what produced
  // the wall of red status lines in the chat.
  it("finds a passage with a word swapped for another", () => {
    const doc = docOf("Der Hund läuft schnell über die große Wiese.");

    expect(found(doc, "Der Hund rennt schnell über die große Wiese.")).toBe(
      "Der Hund läuft schnell über die große Wiese."
    );
  });

  it("refuses a passage that is merely a different sentence", () => {
    const doc = docOf("Der Hund läuft schnell über die große Wiese.");

    expect(found(doc, "Die Katze sitzt gemütlich auf dem warmen Sofa.")).toBeNull();
  });

  // Below a couple of dozen characters a handful of edits turns one phrase into
  // a different one, and replacing the wrong three words is worse than saying
  // the passage was not found.
  it("never matches a short passage approximately", () => {
    const doc = docOf("Der Hund läuft schnell über die große Wiese.");

    expect(found(doc, "Hund rennt")).toBeNull();
  });

  // Editor.tsx searches on past a hit to find the *next* occurrence of the same
  // passage; an approximate match there would land on whatever else happens to
  // read similarly.
  it("stops at the exact passes when fuzzy matching is off", () => {
    const doc = docOf("Der Hund läuft schnell über die große Wiese.");

    expect(found(doc, "Der Hund rennt schnell über die große Wiese.", false)).toBeNull();
    // The tolerant-but-exact passes still apply.
    expect(found(doc, "der hund läuft schnell über die große wiese.", false)).toBe(
      "Der Hund läuft schnell über die große Wiese."
    );
  });

  it("finds nothing for an empty passage", () => {
    const doc = docOf("Der Hund läuft.");

    expect(findTextRange(doc, 0, doc.content.size, "")).toBeNull();
  });
});
