import { describe, expect, it } from "vitest";

import type { AiChatMessage } from "@/lib/aiClient";

import { clampSelection, inlineSelectionContext, MAX_SELECTION_CHARS } from "./selectionContext";

function userTurn(content: string, selection?: string): AiChatMessage {
  return selection ? { role: "user", content, selection } : { role: "user", content };
}

describe("clampSelection", () => {
  it("trims and keeps a normal selection as-is", () => {
    expect(clampSelection("  a marked passage \n")).toBe("a marked passage");
  });

  it("caps a selection that would swallow the context window", () => {
    expect(clampSelection("x".repeat(MAX_SELECTION_CHARS + 500))).toHaveLength(MAX_SELECTION_CHARS);
  });
});

describe("inlineSelectionContext", () => {
  it("leaves a history without any selection untouched", () => {
    const messages = [userTurn("hi"), { role: "assistant", content: "hello" } as AiChatMessage];

    expect(inlineSelectionContext(messages)).toBe(messages);
  });

  it("folds the selection into the turn's content without losing what the user wrote", () => {
    const [message] = inlineSelectionContext([userTurn("is this comprehensible?", "The marked sentence.")]);

    expect(message.content).toContain("The marked sentence.");
    expect(message.content).toContain("is this comprehensible?");
    expect(message.content.endsWith("is this comprehensible?")).toBe(true);
  });

  it("tells the model the passage is the current wording", () => {
    const [message] = inlineSelectionContext([userTurn("shorten this", "The marked sentence.")]);

    expect(message.content).toContain("current wording");
    expect(message.content).toContain("replace_selection");
    expect(message.content).not.toContain("cut off here");
  });

  it("points at get_selection when the passage had to be capped", () => {
    const capped = clampSelection("x".repeat(MAX_SELECTION_CHARS + 1));
    const [message] = inlineSelectionContext([userTurn("summarize this", capped)]);

    expect(message.content).toContain("cut off here");
  });

  it("expands only the newest selection turn, so older passages don't pile up", () => {
    const expanded = inlineSelectionContext([
      userTurn("first question", "OLD PASSAGE"),
      { role: "assistant", content: "an answer" },
      userTurn("second question", "NEW PASSAGE")
    ]);

    expect(expanded[0].content).toBe("first question");
    expect(expanded[2].content).toContain("NEW PASSAGE");
    expect(expanded[2].content).not.toContain("OLD PASSAGE");
  });

  it("does not mutate the stored history", () => {
    const messages = [userTurn("a question", "a passage")];
    inlineSelectionContext(messages);

    expect(messages[0].content).toBe("a question");
  });
});
