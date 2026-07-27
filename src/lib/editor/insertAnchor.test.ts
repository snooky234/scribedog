import { describe, expect, it } from "vitest";
import type { Node as ProseMirrorNode } from "@tiptap/pm/model";

import { imageSourcesInMarkdown } from "./documentImages";
import { extractImageAnchor, hasAnchorableContent } from "./insertAnchor";

// Both halves of "write a poem below the image": recognizing that the anchor
// names an image (no text search can ever find one), and recognizing that a
// proposal carries an image the document already shows — which is how an image
// ended up in the document twice.

describe("extractImageAnchor", () => {
  it("reads the path out of image markdown", () => {
    expect(extractImageAnchor("![a mouse](images/mouse.png)")).toBe("images/mouse.png");
    expect(extractImageAnchor('![](./images/mouse.png "width=300")')).toBe("images/mouse.png");
  });

  it("takes a bare image path", () => {
    expect(extractImageAnchor("images/mouse.png")).toBe("images/mouse.png");
    expect(extractImageAnchor("  mouse.JPG  ")).toBe("mouse.JPG");
  });

  it("leaves a text anchor to the text search", () => {
    expect(extractImageAnchor("Ein kleines Tier")).toBeNull();
    // A sentence that merely mentions a file name is still text.
    expect(extractImageAnchor("the file images/mouse.png shows")).toBeNull();
  });
});

// Only the two things hasAnchorableContent reads — building a real ProseMirror
// document would drag the whole schema into a test about one predicate.
function stubDoc(text: string, nodeTypes: readonly string[] = []): ProseMirrorNode {
  return {
    textContent: text,
    descendants: (visit: (node: { type: { name: string } }) => boolean) => {
      for (const name of nodeTypes) {
        if (!visit({ type: { name } })) {
          break;
        }
      }
    }
  } as unknown as ProseMirrorNode;
}

// A note the user just created: the agent is told to always name where new text
// goes, so without this distinction every insertion into a fresh note came back
// "anchor not found" and never happened.
describe("hasAnchorableContent", () => {
  it("sees nothing to anchor to in a fresh note", () => {
    expect(hasAnchorableContent(stubDoc("", ["paragraph"]))).toBe(false);
    expect(hasAnchorableContent(stubDoc("  \n ", ["paragraph"]))).toBe(false);
  });

  it("counts any text", () => {
    expect(hasAnchorableContent(stubDoc("Ein kleines Tier", ["paragraph"]))).toBe(true);
  });

  // An image carries no text but is a perfectly good anchor ("below the image").
  it("counts an image in a document without text", () => {
    expect(hasAnchorableContent(stubDoc("", ["paragraph", "image"]))).toBe(true);
  });
});

describe("imageSourcesInMarkdown", () => {
  it("collects every embedded image once", () => {
    const markdown = "# Hallo\n\n![a](images/a.png)\n\ntext\n\n![b](./images/b.png)\n\n![a again](images/a.png)";

    expect(imageSourcesInMarkdown(markdown)).toEqual(["images/a.png", "images/b.png"]);
  });

  it("ignores links that are not images", () => {
    expect(imageSourcesInMarkdown("[a link](images/a.png)")).toEqual([]);
  });

  it("finds nothing in plain text", () => {
    expect(imageSourcesInMarkdown("Just a poem\nabout a mouse")).toEqual([]);
  });
});
