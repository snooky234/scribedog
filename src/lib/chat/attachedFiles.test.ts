import { describe, expect, it } from "vitest";

import type { AiChatMessage } from "@/lib/aiClient";
import { inlineAttachedFiles, isAttachableFileName, type AttachedChatFile } from "./attachedFiles";

// The attachments are the chat's primary source, so what matters here is *where*
// their content lands in the outgoing payload and that it lands exactly once —
// everything the feature promises follows from those two properties.

function file(name: string, content: string, path = ""): AttachedChatFile {
  return { id: name, name, path, content, truncated: false };
}

const CONTEXT_LENGTH = 8192;

describe("isAttachableFileName", () => {
  it("takes text files and refuses anything else", () => {
    expect(isAttachableFileName("Notiz.md")).toBe(true);
    expect(isAttachableFileName("daten.CSV")).toBe(true);
    expect(isAttachableFileName("foto.png")).toBe(false);
    expect(isAttachableFileName("README")).toBe(false);
  });
});

describe("inlineAttachedFiles", () => {
  const question: AiChatMessage = { role: "user", content: "Was steht dazu drin?" };

  it("leaves the history untouched without attachments", () => {
    const messages = [question];

    expect(inlineAttachedFiles(messages, [], CONTEXT_LENGTH)).toBe(messages);
  });

  it("folds the content into the newest user turn only, keeping the question last", () => {
    const messages: AiChatMessage[] = [
      { role: "user", content: "Erste Frage" },
      { role: "assistant", content: "Erste Antwort" },
      question
    ];

    const result = inlineAttachedFiles(messages, [file("Kunde A.md", "Liefertermin ist der 3.")], CONTEXT_LENGTH);

    expect(result[0].content).toBe("Erste Frage");
    expect(result[2].content).toContain("Liefertermin ist der 3.");
    expect(result[2].content.endsWith("Was steht dazu drin?")).toBe(true);
  });

  it("skips the turn that only carries an image the agent asked for", () => {
    const messages: AiChatMessage[] = [
      question,
      { role: "user", content: "Here is the image you requested (images/a.png).", imagePaths: ["images/a.png"] }
    ];

    const result = inlineAttachedFiles(messages, [file("Notiz.md", "Inhalt")], CONTEXT_LENGTH);

    expect(result[0].content).toContain("Inhalt");
    expect(result[1].content).not.toContain("Inhalt");
  });

  it("shares the budget so one long file cannot crowd the others out", () => {
    const result = inlineAttachedFiles(
      [question],
      [file("lang.md", "A".repeat(50_000)), file("kurz.md", "kurzer Inhalt")],
      2048
    );

    expect(result[0].content).toContain("kurzer Inhalt");
    expect(result[0].content).toContain("…file continues");
  });

  it("labels a note from the vault by its path and a dropped file by its name", () => {
    const result = inlineAttachedFiles(
      [question],
      [file("Kunde A.md", "x", "Projekte/Kunde A.md"), file("extern.txt", "y")],
      CONTEXT_LENGTH
    );

    expect(result[0].content).toContain("attached file: Projekte/Kunde A.md");
    expect(result[0].content).toContain("attached file: extern.txt");
  });
});
