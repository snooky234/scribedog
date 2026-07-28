import { describe, expect, it } from "vitest";

import { renderChatMarkdown } from "./renderMarkdown";

describe("renderChatMarkdown", () => {
  it("leaves a note name mentioned in prose unlinked", () => {
    // ".md" is a real TLD, so linkify used to turn the tail of a note path
    // with a space in it into a link to a stranger's website.
    const html = renderChatMarkdown("Your craft ideas are in Ideas/Craft Ideas.md.");

    expect(html).not.toContain("<a");
  });

  it("still links a URL that carries its own scheme", () => {
    const html = renderChatMarkdown("See https://example.com for details.");

    expect(html).toContain('href="https://example.com"');
  });

  it("escapes raw HTML from the model", () => {
    const html = renderChatMarkdown("<img src=x onerror=alert(1)>");

    expect(html).not.toContain("<img");
  });
});
