import { describe, expect, it } from "vitest";

import { imageSourcesInMarkdown } from "./documentImages";
import { extractImageAnchor } from "./insertAnchor";

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
