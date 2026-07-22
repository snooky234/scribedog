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

  it("falls back to the generic tip", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    expect(formatAiError(new Error("something else"), t)).toBe("something else editor.aiTipGeneric");
  });
});
