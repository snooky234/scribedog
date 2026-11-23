import { describe, expect, it, vi } from "vitest";

import { extractErrorMessage, formatAiError } from "./errorMessages";

// The real t() just echoes the key, which is enough to assert which tip was
// appended.
const t = ((key: string) => key) as unknown as Parameters<typeof extractErrorMessage>[1];

describe("extractErrorMessage", () => {
  it("reads an Error instance", () => {
    expect(extractErrorMessage(new Error("boom"), t)).toBe("boom");
  });

  it("passes a string through", () => {
    expect(extractErrorMessage("plain", t)).toBe("plain");
  });

  it("reads a message property off a plain object", () => {
    expect(extractErrorMessage({ message: "obj" }, t)).toBe("obj");
  });

  it("stringifies anything else", () => {
    expect(extractErrorMessage({ code: 42 }, t)).toBe('{"code":42}');
  });
});

describe("formatAiError", () => {
  it("appends the model tip for a model/response error", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    expect(formatAiError(new Error("invalid model"), t)).toBe("invalid model editor.aiTipModel");
  });

  it("appends the connection tip for a network error", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    expect(formatAiError(new Error("fetch failed"), t)).toBe("fetch failed editor.aiTipConnection");
  });

  it.each([
    "------------ While executing CallExpression at line 100 ... Error: Jinja Exception: No user query found in messages.",
    "This model's maximum context length is 8192 tokens. However, your messages resulted in 9000 tokens.",
    "context_length_exceeded",
    "the request exceeds the available context size, try increasing it",
    "prompt is too long: 210000 tokens > 200000 maximum",
    "Trying to keep the first 5000 tokens when context the overflows. However, the model is loaded with context length of only 4096 tokens"
  ])("replaces a context overflow with the context tip: %s", (message) => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    expect(formatAiError(new Error(message), t)).toBe("editor.aiContextTooSmall");
  });

  it("falls back to the generic tip", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    expect(formatAiError(new Error("something else"), t)).toBe("something else editor.aiTipGeneric");
  });
});
