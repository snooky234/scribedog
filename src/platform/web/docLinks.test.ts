// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { browserDocLinks, formatDocHash, parseDocHash } from "./docLinks";

describe("formatDocHash", () => {
  it("names a document of the own vault by its vault-relative path", () => {
    expect(formatDocHash({ folderPath: "/vault", filePath: "/vault/Projects/Roadmap.md" })).toBe(
      "#/doc/Projects/Roadmap.md"
    );
  });

  it("names a document of a shared vault by the vault's id", () => {
    expect(formatDocHash({ folderPath: "/shared/1a2b", filePath: "/shared/1a2b/Chapter 1.md" })).toBe(
      "#/v/1a2b/doc/Chapter%201.md"
    );
  });

  it("encodes every segment on its own", () => {
    expect(formatDocHash({ folderPath: "/vault", filePath: "/vault/Ä & B/Was? #1.md" })).toBe(
      "#/doc/%C3%84%20%26%20B/Was%3F%20%231.md"
    );
  });

  it("is empty for no document and null for a vault it cannot name", () => {
    expect(formatDocHash(null)).toBe("");
    expect(formatDocHash({ folderPath: "/elsewhere", filePath: "/elsewhere/a.md" })).toBeNull();
    expect(formatDocHash({ folderPath: "/vault", filePath: "/other/a.md" })).toBeNull();
    expect(formatDocHash({ folderPath: "/vault", filePath: "/vault" })).toBeNull();
  });
});

describe("parseDocHash", () => {
  it("reads back what formatDocHash writes", () => {
    for (const target of [
      { folderPath: "/vault", filePath: "/vault/Projects/Roadmap.md" },
      { folderPath: "/vault", filePath: "/vault/Ä & B/Was? #1.md" },
      { folderPath: "/shared/1a2b", filePath: "/shared/1a2b/Chapter 1.md" }
    ]) {
      expect(parseDocHash(formatDocHash(target) ?? "")).toEqual(target);
    }
  });

  it("ignores parameters after the path", () => {
    expect(parseDocHash("#/doc/Roadmap.md?h=milestones&x=1")).toEqual({
      folderPath: "/vault",
      filePath: "/vault/Roadmap.md"
    });
  });

  it("refuses what is not a document address", () => {
    for (const hash of [
      "",
      "#",
      "#/",
      "#/doc",
      "#/doc/",
      "#doc/a.md",
      "#/folder/Projects",
      "#/note/a.md",
      "#/v/xyz/doc/a.md",
      "#/v/1a2b/a.md",
      "#/doc/a//b.md",
      "#/doc/../secret.md",
      "#/doc/a/%2E%2E/b.md",
      "#/doc/a%2Fb.md",
      "#/doc/a%5Cb.md",
      "#/doc/%E0%A4%A.md"
    ]) {
      expect(parseDocHash(hash), hash).toBeNull();
    }
  });
});

describe("browserDocLinks", () => {
  const own = (path: string) => ({ folderPath: "/vault", filePath: `/vault/${path}` });

  beforeEach(() => {
    window.history.replaceState(null, "", "/anna/");
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("replaces the bare address with the first document and pushes the next ones", () => {
    const push = vi.spyOn(window.history, "pushState");
    const replace = vi.spyOn(window.history, "replaceState");

    browserDocLinks.show(own("a.md"));
    expect(replace).toHaveBeenCalledTimes(1);
    expect(window.location.pathname + window.location.hash).toBe("/anna/#/doc/a.md");

    browserDocLinks.show(own("b.md"));
    expect(push).toHaveBeenCalledTimes(1);
    expect(browserDocLinks.current()).toEqual(own("b.md"));
  });

  it("does nothing when the address already names the document", () => {
    browserDocLinks.show(own("a.md"));
    const push = vi.spyOn(window.history, "pushState");
    const replace = vi.spyOn(window.history, "replaceState");

    browserDocLinks.show(own("a.md"));
    expect(push).not.toHaveBeenCalled();
    expect(replace).not.toHaveBeenCalled();
  });

  it("clears the address in place when no document is open", () => {
    browserDocLinks.show(own("a.md"));
    browserDocLinks.show(null);

    expect(window.location.hash).toBe("");
    expect(window.location.pathname).toBe("/anna/");
  });

  it("reports changes the person makes to the address", () => {
    const handler = vi.fn();
    const unsubscribe = browserDocLinks.subscribe(handler);

    window.location.hash = "#/doc/c.md";
    window.dispatchEvent(new HashChangeEvent("hashchange"));
    expect(handler).toHaveBeenLastCalledWith(own("c.md"));

    unsubscribe();
    handler.mockClear();
    window.dispatchEvent(new HashChangeEvent("hashchange"));
    expect(handler).not.toHaveBeenCalled();
  });
});
