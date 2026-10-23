import { describe, expect, it } from "vitest";

import {
  assertValidEndpoint,
  canonicalToolName,
  currentDateInstruction,
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
  stripThinkingBlocks,
  toOpenAiCompatMessages
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

  it("accepts plain-http hosts in the user's own network", () => {
    expect(isLocalApiUrl("http://192.168.1.50:1337")).toBe(true);
    expect(isLocalApiUrl("http://10.0.0.5:11434")).toBe(true);
    expect(isLocalApiUrl("http://jan.fritz.box:1337")).toBe(true);
  });

  it("rejects public hosts and non-http schemes", () => {
    expect(isLocalApiUrl("http://8.8.8.8:11434")).toBe(false);
    expect(isLocalApiUrl("http://evil.com")).toBe(false);
    expect(isLocalApiUrl("http://192.168.1.1.evil.com")).toBe(false);
    expect(isLocalApiUrl("http://169.254.169.254/latest/meta-data")).toBe(false);
    expect(isLocalApiUrl("https://192.168.1.10")).toBe(false);
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
// providers must be HTTPS + keyed, local providers must stay on this machine
// or in the user's own network.
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

  it("accepts an endpoint in the user's own network for a local provider", () => {
    expect(() => assertValidEndpoint("jan", "http://192.168.1.10:1337", "")).not.toThrow();
  });

  it("rejects a public endpoint for a local provider", () => {
    expect(() => assertValidEndpoint("ollama", "http://203.0.113.10:11434", "")).toThrow();
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

  it("throws when no issue can be recovered at all", () => {
    expect(() => parseCheckIssues("not json")).toThrow();
    expect(() => parseCheckIssues("Here is a list:\n- teh -> the")).toThrow();
  });

  it("recovers the array from prose around it and a mid-sentence fence", () => {
    expect(
      parseCheckIssues('Sure! Here are the issues:\n[{"original":"teh","suggestion":"the"}]\nLet me know if you need more.')
    ).toEqual([{ original: "teh", suggestion: "the", explanation: "" }]);
    expect(
      parseCheckIssues('Here you go: ```json\n[{"original":"teh","suggestion":"the"}]\n``` Done.')
    ).toEqual([{ original: "teh", suggestion: "the", explanation: "" }]);
  });

  it("accepts an object wrapping the list and a single issue object", () => {
    expect(
      parseCheckIssues('{"issues":[{"original":"teh","suggestion":"the"}]}')
    ).toEqual([{ original: "teh", suggestion: "the", explanation: "" }]);
    expect(parseCheckIssues('{"original":"teh","suggestion":"the"}')).toEqual([
      { original: "teh", suggestion: "the", explanation: "" }
    ]);
  });

  it("keeps the entries that parse when one entry or the array end is broken", () => {
    // Unescaped quote inside the second entry breaks the array as a whole.
    expect(
      parseCheckIssues('[{"original":"teh","suggestion":"the"},{"original":"say "hi"","suggestion":"x"},{"original":"a","suggestion":"b"}]')
    ).toEqual([
      { original: "teh", suggestion: "the", explanation: "" },
      { original: "a", suggestion: "b", explanation: "" }
    ]);
    // Truncated by the token limit.
    expect(
      parseCheckIssues('[{"original":"teh","suggestion":"the"},{"original":"a","sugg')
    ).toEqual([{ original: "teh", suggestion: "the", explanation: "" }]);
  });

  it("does not trip over brackets inside strings", () => {
    expect(
      parseCheckIssues('[{"original":"list [1]","suggestion":"list [1] }","explanation":"x"}]')
    ).toEqual([{ original: "list [1]", suggestion: "list [1] }", explanation: "x" }]);
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

describe("currentDateInstruction", () => {
  it("names the weekday, date and time in local time", () => {
    expect(currentDateInstruction(new Date(2026, 9, 30, 9, 5))).toBe(
      "Current date and time (the user's local time): Friday, 2026-10-30 09:05."
    );
  });
});

describe("chat system prompt", () => {
  function systemPrompt(extra: Record<string, unknown> = {}): string {
    const [system] = toOpenAiCompatMessages(
      { messages: [{ role: "user", content: "hi" }], assistantInstruction: "", ...extra },
      "off",
      true
    );

    return String(system.content);
  }

  it("ends with the current date, so the cached start of the prompt stays unchanged", () => {
    expect(systemPrompt()).toMatch(/Current date and time \(the user's local time\): \w+, \d{4}-\d{2}-\d{2} \d{2}:\d{2}\.$/);
  });

  it("asks to keep reminder markers whether or not the reminder tools are on", () => {
    expect(systemPrompt()).toContain("keep the marker unchanged");
    expect(systemPrompt({ remindersEnabled: true })).toContain("keep the marker unchanged");
    expect(systemPrompt({ toolsDisabled: true })).not.toContain("keep the marker unchanged");
  });

  it("explains the reminder tools only when they are offered", () => {
    expect(systemPrompt()).not.toContain("set_reminder");
    expect(systemPrompt({ remindersEnabled: true })).toContain("set_reminder");
    expect(systemPrompt({ remindersEnabled: true, fileAccessEnabled: true })).toContain("pass its path");
  });
});

describe("canonicalToolName", () => {
  it("maps the reminder names models invent", () => {
    expect(canonicalToolName("add_reminder")).toBe("set_reminder");
    expect(canonicalToolName("Create_Reminder")).toBe("set_reminder");
    expect(canonicalToolName("delete_reminder")).toBe("remove_reminder");
    expect(canonicalToolName("get_reminders")).toBe("list_reminders");
  });
});
