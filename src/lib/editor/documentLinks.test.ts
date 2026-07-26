import { describe, expect, it } from "vitest";

import {
  collectBacklinks,
  collectOutgoingFileLinks,
  extractMarkdownLinkHrefs
} from "./documentLinks";

const VAULT = ["C:\\vault\\index.md", "C:\\vault\\notes\\meeting.md", "C:\\vault\\notes\\todo.md"];

describe("extractMarkdownLinkHrefs", () => {
  it("collects inline link destinations and skips images", () => {
    const markdown = [
      "See [the notes](notes/meeting.md) and [the web](https://example.com).",
      "![a photo](images/photo.png)",
      '[with title](notes/todo.md "Todo")',
      "[angled](<notes/deep note.md>)"
    ].join("\n");

    expect(extractMarkdownLinkHrefs(markdown)).toEqual([
      "notes/meeting.md",
      "https://example.com",
      "notes/todo.md",
      "notes/deep note.md"
    ]);
  });

  it("unescapes parentheses the serializer escaped", () => {
    expect(extractMarkdownLinkHrefs("[note](notes/plan\\(v2\\).md)")).toEqual(["notes/plan(v2).md"]);
  });
});

describe("collectOutgoingFileLinks", () => {
  it("resolves note links, keeps unresolved ones and drops web links", () => {
    const markdown =
      "[meeting](notes/meeting.md) [again](notes/meeting.md) [gone](notes/removed.md) [web](https://example.com)";

    expect(collectOutgoingFileLinks(markdown, "C:\\vault\\index.md", VAULT)).toEqual([
      { href: "notes/meeting.md", targetFilePath: "C:\\vault\\notes\\meeting.md" },
      { href: "notes/removed.md", targetFilePath: null }
    ]);
  });

  it("ignores a link to the document itself", () => {
    expect(collectOutgoingFileLinks("[self](index.md)", "C:\\vault\\index.md", VAULT)).toEqual([]);
  });
});

describe("collectBacklinks", () => {
  it("counts every link pointing at the target", () => {
    const sources = [
      { filePath: "C:\\vault\\index.md", markdown: "[a](notes/meeting.md) [b](./notes/meeting.md)" },
      { filePath: "C:\\vault\\notes\\todo.md", markdown: "[c](meeting.md)" },
      { filePath: "C:\\vault\\notes\\meeting.md", markdown: "[self](meeting.md)" }
    ];

    expect(collectBacklinks("C:\\vault\\notes\\meeting.md", sources, VAULT)).toEqual([
      { filePath: "C:\\vault\\index.md", count: 2 },
      { filePath: "C:\\vault\\notes\\todo.md", count: 1 }
    ]);
  });
});
