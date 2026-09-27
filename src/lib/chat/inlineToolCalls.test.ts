import { describe, expect, it } from "vitest";

import { recoverInlineToolCall } from "./inlineToolCalls";

// What matters here is the line between "the model printed a call" and "the
// model wrote about one": recovering too eagerly turns an explanation into an
// edit of the user's document, which is worse than not recovering at all.

const KNOWN = ["insert_at_cursor", "write_file", "replace_passage"];
const isKnownTool = (name: string) => KNOWN.includes(name);

describe("recoverInlineToolCall", () => {
  it("recovers the fenced shape gemma prints", () => {
    // Verbatim from the transcript that prompted this module.
    const text = [
      "Ich habe den Text aus dem Bild in die Datei eingefügt.",
      "```json",
      '{ "tool_name": "insert_at_cursor", "params": { "text": "# Spring Specials" } }',
      "```"
    ].join("\n");

    const recovered = recoverInlineToolCall(text, isKnownTool);

    expect(recovered?.call.name).toBe("insert_at_cursor");
    expect(recovered?.call.arguments).toEqual({ text: "# Spring Specials" });
    // The sentence survives, the JSON does not.
    expect(recovered?.text).toBe("Ich habe den Text aus dem Bild in die Datei eingefügt.");
  });

  it("recovers OpenAI's nested shape", () => {
    const text = '```json\n{"function": {"name": "write_file", "arguments": "{\\"path\\": \\"a.md\\"}"}}\n```';

    const recovered = recoverInlineToolCall(text, isKnownTool);

    expect(recovered?.call.name).toBe("write_file");
    expect(recovered?.call.arguments).toEqual({ path: "a.md" });
  });

  it("recovers arguments spread across the top level", () => {
    const text = '```json\n{"tool_name": "write_file", "path": "notiz.md", "content": "Hallo"}\n```';

    const recovered = recoverInlineToolCall(text, isKnownTool);

    expect(recovered?.call.arguments).toEqual({ path: "notiz.md", content: "Hallo" });
  });

  it("takes an unfenced object that is the whole answer", () => {
    const text = '{"tool_name": "insert_at_cursor", "params": {"text": "Hallo"}}';

    expect(recoverInlineToolCall(text, isKnownTool)?.call.name).toBe("insert_at_cursor");
  });

  it("leaves prose alone", () => {
    expect(recoverInlineToolCall("Ich habe den Text eingefügt.", isKnownTool)).toBeNull();
    expect(recoverInlineToolCall("", isKnownTool)).toBeNull();
  });

  it("refuses a name that is not a real tool", () => {
    // The existing "invented tool" handling is the right place for this, and it
    // needs the text to still be there.
    const text = '```json\n{"tool_name": "definitely_not_a_tool", "params": {"text": "x"}}\n```';

    expect(recoverInlineToolCall(text, isKnownTool)).toBeNull();
  });

  it("refuses a call with no arguments", () => {
    // A model describing what it *would* call, not calling it.
    const text = '```json\n{"tool_name": "insert_at_cursor"}\n```';

    expect(recoverInlineToolCall(text, isKnownTool)).toBeNull();
  });

  it("does not mine prose for brace pairs", () => {
    // An answer explaining the tool must not become a call. Unfenced JSON is
    // only accepted when it is the entire answer.
    const text = 'Du kannst {"tool_name": "insert_at_cursor", "params": {"text": "x"}} aufrufen.';

    expect(recoverInlineToolCall(text, isKnownTool)).toBeNull();
  });

  it("leaves an ordinary code fence alone", () => {
    const text = "So geht das:\n```json\n{\"name\": \"Anna\", \"alter\": 30}\n```";

    expect(recoverInlineToolCall(text, isKnownTool)).toBeNull();
  });

  it("empties the text when the answer was only the call", () => {
    const text = '```json\n{"tool_name": "insert_at_cursor", "params": {"text": "Hallo"}}\n```';

    expect(recoverInlineToolCall(text, isKnownTool)?.text).toBe("");
  });
});
