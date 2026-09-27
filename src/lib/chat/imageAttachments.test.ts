import { describe, expect, it, vi } from "vitest";

import type { AiChatMessage } from "@/lib/aiClient";
import {
  inlineAttachedImages,
  isAttachableImageName,
  type AttachedChatImage
} from "./imageAttachments";

// The vault side of the module reads files and decodes pixels; only the pure
// half is covered here — where an attached image lands in the outgoing payload,
// and that the two halves of the module share one budget instead of each
// spending it in full.
vi.mock("@/platform/paths", () => ({
  dirname: async (path: string) => path,
  join: async (...parts: string[]) => parts.join("/"),
  normalize: async (path: string) => path
}));
vi.mock("@/platform/vaultFs", () => ({
  readFile: async () => new Uint8Array(),
  stat: async () => ({ mtime: new Date(0), size: 0 })
}));
vi.mock("@/store/useAppStore", () => ({
  useAppStore: { getState: () => ({ folderPath: null, selectedFilePath: null }) }
}));

function image(name: string): AttachedChatImage {
  return { id: name, name, base64: `base64-of-${name}`, mimeType: "image/png" };
}

describe("isAttachableImageName", () => {
  it("takes the raster formats a vision request accepts", () => {
    expect(isAttachableImageName("foto.png")).toBe(true);
    expect(isAttachableImageName("Scan.JPEG")).toBe(true);
    expect(isAttachableImageName("logo.webp")).toBe(true);
  });

  it("refuses SVG and non-images", () => {
    // Markup, not pixels: no provider takes it and createImageBitmap refuses it,
    // so attaching one could only end in "unreadable".
    expect(isAttachableImageName("diagramm.svg")).toBe(false);
    expect(isAttachableImageName("Notiz.md")).toBe(false);
    expect(isAttachableImageName("README")).toBe(false);
  });
});

describe("inlineAttachedImages", () => {
  const question: AiChatMessage = { role: "user", content: "Was steht auf dem Bild?" };

  it("leaves the history untouched without attachments", () => {
    const messages = [question];

    expect(inlineAttachedImages(messages, [])).toBe(messages);
  });

  it("hangs the images on the newest user turn", () => {
    const result = inlineAttachedImages([question], [image("screenshot.png")]);

    expect(result[0].role).toBe("user");
    expect(result[0].role === "user" ? result[0].images : undefined).toEqual([
      { path: "screenshot.png", base64: "base64-of-screenshot.png", mimeType: "image/png" }
    ]);
  });

  it("tells the model the picture is already here", () => {
    // The transcript that prompted this: raw image blocks with nothing naming
    // them, and a small model answering "please upload the image".
    const result = inlineAttachedImages([question], [image("screenshot.png")]);
    const content = result[0].content;

    expect(content).toContain("screenshot.png");
    expect(content).toContain("nothing to upload");
    expect(content).toContain("get_image does not apply here");
    // The user's own words survive the note.
    expect(content).toContain("Was steht auf dem Bild?");
  });

  it("does not touch the input", () => {
    const messages: AiChatMessage[] = [question];

    inlineAttachedImages(messages, [image("a.png")]);

    expect(messages[0].role === "user" ? messages[0].images : undefined).toBeUndefined();
  });

  it("skips the turn that only carries an image the agent asked for", () => {
    // That turn is model-facing text with its own image resolved from
    // imagePaths; the user never wrote it, so the attachment does not belong
    // there — it belongs on the question they did write.
    const history: AiChatMessage[] = [
      question,
      { role: "assistant", content: "" },
      { role: "user", content: "Here is the image you requested", imagePaths: ["images/a.png"] }
    ];

    const result = inlineAttachedImages(history, [image("screenshot.png")]);

    expect(result[0].role === "user" ? result[0].images?.length : 0).toBe(1);
    expect(result[2].role === "user" ? result[2].images : undefined).toBeUndefined();
  });

  it("puts the attachments before an image the same turn already carries", () => {
    const history: AiChatMessage[] = [
      {
        role: "user",
        content: "Und dieses hier?",
        images: [{ path: "images/doc.png", base64: "doc", mimeType: "image/png" }]
      }
    ];

    const result = inlineAttachedImages(history, [image("screenshot.png")]);

    expect(result[0].role === "user" ? result[0].images?.map((entry) => entry.path) : []).toEqual([
      "screenshot.png",
      "images/doc.png"
    ]);
  });

  it("caps how many images one request carries", () => {
    const many = ["a", "b", "c", "d", "e", "f"].map((name) => image(`${name}.png`));

    const result = inlineAttachedImages([question], many);

    expect(result[0].role === "user" ? result[0].images?.length : 0).toBe(4);
  });
});

describe("attachImageData beside the attachments", () => {
  it("keeps the attached images and charges them against the shared cap", async () => {
    const { attachImageData } = await import("./imageAttachments");

    // The document image cannot resolve (no folder is open in this mock), so
    // what survives is exactly what inlineAttachedImages put there — the point
    // being that attachImageData appends rather than assigns.
    const history: AiChatMessage[] = [
      { role: "user", content: "Frage", imagePaths: ["images/doc.png"] },
      { role: "assistant", content: "" },
      { role: "user", content: "Und das?" }
    ];

    const withAttachment = inlineAttachedImages(history, [image("screenshot.png")]);
    const result = await attachImageData(withAttachment);

    expect(result[2].role === "user" ? result[2].images?.map((entry) => entry.path) : []).toEqual([
      "screenshot.png"
    ]);
  });
});
