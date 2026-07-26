import { describe, expect, it } from "vitest";

import {
  buildFileLinkHref,
  filterVaultFileOptions,
  getFileLinkLabel,
  isFileLinkHref,
  resolveFileLinkTarget,
  type VaultFileOption
} from "./fileLinks";

// Windows paths (backslashes, case-insensitive) and vault-relative hrefs are
// the two spellings of the same location that have to survive a round trip:
// buildFileLinkHref writes the link, resolveFileLinkTarget opens it again.

const VAULT = [
  "C:\\vault\\index.md",
  "C:\\vault\\notes\\meeting.md",
  "C:\\vault\\notes\\sub\\deep note.md",
  "C:\\vault\\archive\\Übersicht.md"
];

describe("buildFileLinkHref", () => {
  it("links inside the same folder without a prefix", () => {
    expect(buildFileLinkHref("C:\\vault\\notes\\meeting.md", "C:\\vault\\notes\\sub\\deep note.md")).toBe(
      "sub/deep%20note.md"
    );
  });

  it("walks up out of subfolders", () => {
    expect(buildFileLinkHref("C:\\vault\\notes\\sub\\deep note.md", "C:\\vault\\index.md")).toBe(
      "../../index.md"
    );
    expect(buildFileLinkHref("C:\\vault\\notes\\meeting.md", "C:\\vault\\archive\\Übersicht.md")).toBe(
      "../archive/%C3%9Cbersicht.md"
    );
  });

  it("works with posix paths too", () => {
    expect(buildFileLinkHref("/vault/notes/meeting.md", "/vault/notes/other.md")).toBe("other.md");
  });
});

describe("isFileLinkHref", () => {
  it("accepts relative markdown paths", () => {
    expect(isFileLinkHref("notes/meeting.md")).toBe(true);
    expect(isFileLinkHref("../index.MD")).toBe(true);
    expect(isFileLinkHref("./notes/meeting.md#section")).toBe(true);
  });

  it("leaves anything with a scheme, a fragment or another extension alone", () => {
    expect(isFileLinkHref("https://example.com/notes.md")).toBe(false);
    expect(isFileLinkHref("mailto:someone@example.com")).toBe(false);
    expect(isFileLinkHref("//example.com/notes.md")).toBe(false);
    expect(isFileLinkHref("#heading")).toBe(false);
    expect(isFileLinkHref("images/photo.png")).toBe(false);
    expect(isFileLinkHref("")).toBe(false);
  });
});

describe("resolveFileLinkTarget", () => {
  it("resolves a link back to the vault's own spelling of the path", () => {
    expect(resolveFileLinkTarget("sub/deep%20note.md", "C:\\vault\\notes\\meeting.md", VAULT)).toBe(
      "C:\\vault\\notes\\sub\\deep note.md"
    );
    expect(
      resolveFileLinkTarget("../../index.md", "C:\\vault\\notes\\sub\\deep note.md", VAULT)
    ).toBe("C:\\vault\\index.md");
    expect(
      resolveFileLinkTarget("../archive/%C3%9Cbersicht.md", "C:\\vault\\notes\\meeting.md", VAULT)
    ).toBe("C:\\vault\\archive\\Übersicht.md");
  });

  it("ignores a fragment and matches case-insensitively", () => {
    expect(resolveFileLinkTarget("./NOTES/Meeting.md#top", "C:\\vault\\index.md", VAULT)).toBe(
      "C:\\vault\\notes\\meeting.md"
    );
  });

  it("returns null for a target outside the vault", () => {
    expect(resolveFileLinkTarget("../outside.md", "C:\\vault\\index.md", VAULT)).toBeNull();
    expect(resolveFileLinkTarget("gone.md", "C:\\vault\\index.md", VAULT)).toBeNull();
  });
});

describe("getFileLinkLabel", () => {
  it("uses the file name without the extension", () => {
    expect(getFileLinkLabel("C:\\vault\\notes\\meeting.md")).toBe("meeting");
    expect(getFileLinkLabel("/vault/Notes.MD")).toBe("Notes");
  });
});

describe("filterVaultFileOptions", () => {
  const options: VaultFileOption[] = [
    { filePath: "a", relativePath: "notes/meeting.md", label: "meeting" },
    { filePath: "b", relativePath: "archive/old meeting.md", label: "old meeting" },
    { filePath: "c", relativePath: "meeting/index.md", label: "index" },
    { filePath: "d", relativePath: "todo.md", label: "todo" }
  ];

  it("ranks name prefixes before name matches before path matches", () => {
    expect(filterVaultFileOptions(options, "meet").map((option) => option.relativePath)).toEqual([
      "notes/meeting.md",
      "archive/old meeting.md",
      "meeting/index.md"
    ]);
  });

  it("lists the first entries for an empty query", () => {
    expect(filterVaultFileOptions(options, "  ", 2)).toHaveLength(2);
  });
});
