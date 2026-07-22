import { describe, expect, it } from "vitest";

import {
  assertValidEndpoint,
  extractAnthropicContent,
  extractResponseContent,
  isCloudProvider,
  isHttpsUrl,
  isLocalApiUrl,
  parseCheckIssues,
  replaceLatexSymbolMacros,
  resolveMaxOutputTokens,
  splitThinkingTags,
  stripJsonCodeFence,
  stripThinkingBlocks
} from "@/lib/aiClient";
import { AI_PROVIDERS } from "@/store/useAiSettingsStore";

describe("isCloudProvider", () => {
  it("classifies the six providers", () => {
    expect(AI_PROVIDERS.filter(isCloudProvider)).toEqual(["openai", "anthropic", "mistral"]);
    expect(AI_PROVIDERS.filter((provider) => !isCloudProvider(provider))).toEqual([
      "ollama",
      "jan",
      "lmstudio"
    ]);
  });
});

describe("isLocalApiUrl", () => {
  it("accepts plain-http loopback hosts", () => {
    expect(isLocalApiUrl("http://localhost:11434")).toBe(true);
    expect(isLocalApiUrl("http://127.0.0.1:1234/v1")).toBe(true);
    expect(isLocalApiUrl("http://[::1]:8080")).toBe(true);
    expect(isLocalApiUrl("http://ollama.localhost")).toBe(true);
  });

  it("rejects remote hosts and non-http schemes", () => {
    expect(isLocalApiUrl("http://192.168.1.10:11434")).toBe(false);
    expect(isLocalApiUrl("http://evil.com")).toBe(false);
    expect(isLocalApiUrl("https://localhost")).toBe(false);
    expect(isLocalApiUrl("not a url")).toBe(false);
  });

  it("rejects a remote host that merely contains \"localhost\"", () => {
    expect(isLocalApiUrl("http://localhost.evil.com")).toBe(false);
  });
});

describe("isHttpsUrl", () => {
  it("only accepts https", () => {
    expect(isHttpsUrl("https://api.openai.com/v1")).toBe(true);
    expect(isHttpsUrl("http://api.openai.com/v1")).toBe(false);
    expect(isHttpsUrl("garbage")).toBe(false);
  });
});

// Security invariant from CLAUDE.md / the README privacy notice: cloud
// providers must be HTTPS + keyed, local providers must stay on loopback.
describe("assertValidEndpoint", () => {
  it("accepts a valid cloud endpoint", () => {
    expect(() => assertValidEndpoint("openai", "https://api.openai.com/v1", "sk-test")).not.toThrow();
  });

  it("rejects a cloud endpoint without https", () => {
    expect(() => assertValidEndpoint("openai", "http://api.openai.com/v1", "sk-test")).toThrow();
  });

  it("rejects a cloud endpoint without an API key", () => {
    expect(() => assertValidEndpoint("anthropic", "https://api.anthropic.com", "   ")).toThrow();
  });

  it("accepts a loopback endpoint for a local provider", () => {
    expect(() => assertValidEndpoint("ollama", "http://localhost:11434", "")).not.toThrow();
  });

  it("rejects a non-loopback endpoint for a local provider", () => {
    expect(() => assertValidEndpoint("ollama", "http://192.168.1.10:11434", "")).toThrow();
    expect(() => assertValidEndpoint("lmstudio", "https://evil.com/v1", "key")).toThrow();
  });
});

describe("stripThinkingBlocks", () => {
  it("removes reasoning blocks and trims", () => {
    expect(stripThinkingBlocks("<think>hmm</think>\n\nAnswer")).toBe("Answer");
  });

  it("removes multiple blocks case-insensitively", () => {
    expect(stripThinkingBlocks("a<THINK>x</THINK>b<think>y</think>c")).toBe("abc");
  });

  it("leaves text without blocks alone", () => {
    expect(stripThinkingBlocks("  plain  ")).toBe("plain");
  });
});

describe("splitThinkingTags", () => {
  it("splits a completed block", () => {
    expect(splitThinkingTags("<think>why</think>Answer")).toEqual({
      answer: "Answer",
      thinking: "why"
    });
  });

  it("treats an unclosed block as pure thinking", () => {
    expect(splitThinkingTags("pre<think>still going")).toEqual({
      answer: "pre",
      thinking: "still going"
    });
  });

  it("holds back a truncated opening tag until the next chunk completes it", () => {
    expect(splitThinkingTags("Answer<thi")).toEqual({ answer: "Answer", thinking: "" });
  });

  it("does not hold back an unrelated tag-like suffix", () => {
    expect(splitThinkingTags("Answer<br")).toEqual({ answer: "Answer<br", thinking: "" });
  });

  it("concatenates several blocks", () => {
    expect(splitThinkingTags("a<think>1</think>b<think>2</think>c")).toEqual({
      answer: "abc",
      thinking: "12"
    });
  });
});

describe("replaceLatexSymbolMacros", () => {
  it("unwraps math delimiters around a known macro", () => {
    expect(replaceLatexSymbolMacros("A $\\rightarrow$ B")).toBe("A → B");
    expect(replaceLatexSymbolMacros("A $$\\leq$$ B")).toBe("A ≤ B");
  });

  it("replaces a bare macro", () => {
    expect(replaceLatexSymbolMacros("x \\neq y")).toBe("x ≠ y");
  });

  it("leaves unknown macros untouched", () => {
    expect(replaceLatexSymbolMacros("$\\frac{1}{2}$")).toBe("$\\frac{1}{2}$");
  });
});

describe("resolveMaxOutputTokens", () => {
  it("clamps to [256, 4096]", () => {
    expect(resolveMaxOutputTokens(100)).toBe(256);
    expect(resolveMaxOutputTokens(2048)).toBe(2048);
    expect(resolveMaxOutputTokens(32000)).toBe(4096);
  });
});

describe("stripJsonCodeFence", () => {
  it("unwraps a fenced block with and without a language tag", () => {
    expect(stripJsonCodeFence("```json\n[]\n```")).toBe("[]");
    expect(stripJsonCodeFence("```\n[]\n```")).toBe("[]");
  });

  it("leaves unfenced text alone", () => {
    expect(stripJsonCodeFence("  []  ")).toBe("[]");
  });
});

describe("parseCheckIssues", () => {
  it("parses a fenced array and defaults a missing explanation", () => {
    expect(
      parseCheckIssues('```json\n[{"original":"teh","suggestion":"the"}]\n```')
    ).toEqual([{ original: "teh", suggestion: "the", explanation: "" }]);
  });

  it("drops malformed entries instead of failing the whole response", () => {
    expect(
      parseCheckIssues('[{"original":"","suggestion":"x"},{"suggestion":"y"},{"original":"a","suggestion":"b","explanation":"c"}]')
    ).toEqual([{ original: "a", suggestion: "b", explanation: "c" }]);
  });

  it("throws on invalid JSON and on a non-array payload", () => {
    expect(() => parseCheckIssues("not json")).toThrow();
    expect(() => parseCheckIssues('{"original":"a"}')).toThrow();
  });
});

describe("extractResponseContent", () => {
  it("reads the Ollama chat and generate shapes", () => {
    expect(extractResponseContent({ message: { content: "a" } }, true)).toBe("a");
    expect(extractResponseContent({ response: "b" }, true)).toBe("b");
  });

  it("reads the OpenAI-compatible shape", () => {
    expect(extractResponseContent({ choices: [{ message: { content: "c" } }] }, false)).toBe("c");
  });

  it("returns an empty string for an empty but well-formed payload", () => {
    expect(extractResponseContent({}, true)).toBe("");
    expect(extractResponseContent({}, false)).toBe("");
  });

  it("throws when the payload is not an object", () => {
    expect(() => extractResponseContent("nope", false)).toThrow();
    expect(() => extractResponseContent(null, false)).toThrow();
  });
});

describe("extractAnthropicContent", () => {
  it("joins the text blocks and skips other block types", () => {
    expect(
      extractAnthropicContent({
        content: [
          { type: "thinking", text: "skip" },
          { type: "text", text: "a" },
          { type: "text", text: "b" }
        ]
      })
    ).toBe("ab");
  });

  it("throws when the payload is not an object", () => {
    expect(() => extractAnthropicContent(null)).toThrow();
  });
});
