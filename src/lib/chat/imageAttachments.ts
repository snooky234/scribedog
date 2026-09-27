// Turns the image paths recorded on a chat message into actual vision data.
//
// Two-stage by design: the conversation history (persisted to
// .scribedog/chat-sessions.json) only ever stores an image's *path*, and the
// base64 payload is resolved here right before a request goes out and thrown
// away afterwards. Persisting base64 would bloat the session file by megabytes
// per image, and the file on disk is the source of truth anyway — an edited
// image should be re-read, not served from a stale copy in the history.

import { dirname, join, normalize } from "@/platform/paths";
import { readFile, stat } from "@/platform/vaultFs";

import type { AiChatImage, AiChatMessage } from "@/lib/aiClient";
import { ABSOLUTE_URL_PATTERN, guessImageMimeType, isPathInsideVault } from "@/lib/fileSystem";
import { encodeImageForVision } from "@/lib/imageEncoding";
import { useAppStore } from "@/store/useAppStore";

// Cap on how many images are sent with one request, newest first. Older image
// turns in the window degrade to their text line ("Attached image: …") so a
// long conversation about several images cannot pile up an unbounded number of
// vision payloads — which is what makes a local model crawl or overflow.
const MAX_ATTACHED_IMAGES = 4;

// Re-reading and re-scaling the same file on every step of the agent loop is
// pure waste (one send does several round trips carrying the same image), so
// encoded images are memoized. The key carries mtime and size, which is what
// makes an image edited on disk miss the cache instead of going stale.
const MAX_CACHE_ENTRIES = 8;
const encodedCache = new Map<string, AiChatImage>();

function cacheGet(key: string): AiChatImage | undefined {
  const hit = encodedCache.get(key);

  if (hit) {
    // Re-insert to make this the most recently used entry.
    encodedCache.delete(key);
    encodedCache.set(key, hit);
  }

  return hit;
}

function cacheSet(key: string, value: AiChatImage): void {
  encodedCache.set(key, value);

  while (encodedCache.size > MAX_CACHE_ENTRIES) {
    const oldest = encodedCache.keys().next().value;

    if (oldest === undefined) {
      break;
    }

    encodedCache.delete(oldest);
  }
}

/**
 * Normalizes a markdown image src for comparison: markdown uses forward
 * slashes and percent-encoding, while the same path typed by a model may come
 * back with backslashes, a "./" prefix or decoded spaces.
 */
export function normalizeImageSrc(src: string): string {
  let value = src.trim().replace(/\\/g, "/");

  try {
    value = decodeURI(value);
  } catch {
    // Malformed percent-escape: compare the raw form instead.
  }

  while (value.startsWith("./")) {
    value = value.slice(2);
  }

  return value;
}

/**
 * Resolves a document-relative image src to an absolute path inside the vault.
 *
 * The src reaching this function comes from a model, which in turn read it out
 * of a document that may itself be untrusted (a shared note can carry any
 * markdown). So a path is only accepted when it stays inside the opened folder
 * after normalization — that, plus the caller checking the src against the
 * images actually embedded in the document, is what keeps get_image from being
 * turned into "read any file on this machine".
 */
export async function resolveDocumentImagePath(src: string): Promise<string | null> {
  const normalizedSrc = normalizeImageSrc(src);

  if (!normalizedSrc || ABSOLUTE_URL_PATTERN.test(normalizedSrc)) {
    return null;
  }

  const { folderPath, selectedFilePath } = useAppStore.getState();

  if (!folderPath || !selectedFilePath) {
    return null;
  }

  // Image paths are relative to the markdown file that embeds them (the
  // "images/" folder sits at the vault root, so a file in a subfolder refers
  // to it as "../images/x.png") — same resolution the editor's ImageView does.
  const documentDir = await dirname(selectedFilePath);
  const absolutePath = await normalize(await join(documentDir, normalizedSrc));

  if (!isPathInsideVault(folderPath, absolutePath)) {
    return null;
  }

  return absolutePath;
}

/**
 * Reads and encodes one document image. Returns null when the path escapes the
 * vault or the file cannot be read; the caller turns that into a model-facing
 * error string.
 */
export async function loadDocumentImage(src: string): Promise<AiChatImage | null> {
  const absolutePath = await resolveDocumentImagePath(src);

  if (!absolutePath) {
    return null;
  }

  try {
    const info = await stat(absolutePath);
    const cacheKey = `${absolutePath}|${info.mtime?.getTime() ?? 0}|${info.size}`;
    const cached = cacheGet(cacheKey);

    if (cached) {
      return { ...cached, path: normalizeImageSrc(src) };
    }

    const bytes = await readFile(absolutePath);
    const encoded = await encodeImageForVision(bytes, guessImageMimeType(absolutePath));
    const image: AiChatImage = {
      path: normalizeImageSrc(src),
      base64: encoded.base64,
      mimeType: encoded.mimeType
    };

    cacheSet(cacheKey, image);

    return image;
  } catch {
    return null;
  }
}

/**
 * Derived view of the trimmed history with vision data filled in: every
 * message carrying imagePaths gets its `images` resolved, newest first and
 * capped at MAX_ATTACHED_IMAGES. Never persisted — the returned messages go
 * straight into the request (see sendMessage in src/store/useChatStore.ts).
 */
export async function attachImageData(messages: AiChatMessage[]): Promise<AiChatMessage[]> {
  const result = [...messages];
  let remaining = MAX_ATTACHED_IMAGES;

  // Images the composer already hung on a turn (see inlineAttachedImages) are
  // payloads in this very request, so they are charged against the cap first —
  // otherwise the two halves of this module would each spend the whole budget
  // and one request would carry twice what the cap allows.
  for (const message of result) {
    if (message.role === "user" && message.images?.length) {
      remaining -= message.images.length;
    }
  }

  for (let i = result.length - 1; i >= 0 && remaining > 0; i -= 1) {
    const message = result[i];

    if (message.role !== "user" || !message.imagePaths?.length) {
      continue;
    }

    const images: AiChatImage[] = [];

    for (const path of message.imagePaths.slice(0, remaining)) {
      const image = await loadDocumentImage(path);

      if (image) {
        images.push(image);
      }
    }

    if (images.length > 0) {
      remaining -= images.length;
      // Appended, never assigned: a turn can carry both an attached image and
      // one get_image resolved, and the attached one was here first.
      result[i] = { ...message, images: [...(message.images ?? []), ...images] };
    }
  }

  return result;
}

// --- Images the user attached to the chat -------------------------------------
//
// The other half of this module: pictures the user dropped, pasted or picked in
// the composer, as opposed to the ones above that a model asked for with
// get_image.
//
// The two cannot share the path-based model. An image from get_image is by
// definition embedded in a vault document, so a path is all the history needs
// and re-reading it per request is the *right* behaviour. An image the user
// pasted from the clipboard has no path at all — the webview hands over bytes
// and nothing else — and one dropped from the Explorer sits outside the vault,
// where the fs capability does not reach. So these carry their payload with
// them, live in the chat store for as long as they stay attached (same
// lifetime as the attached files next door) and are folded into the outgoing
// request from there.
//
// Consequently nothing here is written to disk: not into the vault, and not
// into chat-sessions.json. The history keeps the *names* so a reopened
// transcript can still say what a question was asked about, which is the same
// split attachedFiles.ts uses for its content.

/** An image attached to the chat, already encoded for a vision request. */
export type AttachedChatImage = {
  // Stable per attachment so the chip's remove button addresses one entry even
  // when two folders hold a picture of the same name.
  id: string;
  name: string;
  // Already through encodeImageForVision, so what the chip previews is byte for
  // byte what the model is sent — a thumbnail of a different image than the one
  // being asked about is the confusing failure here.
  base64: string;
  mimeType: string;
};

/**
 * How many images one chat can carry. Deliberately the same number as
 * MAX_ATTACHED_IMAGES above, and charged against the same budget: both kinds
 * end up as vision payloads in one request, and it is the total that makes a
 * local model crawl.
 */
export const MAX_ATTACHED_IMAGES_PER_CHAT = MAX_ATTACHED_IMAGES;

// Refused before decoding. encodeImageForVision scales everything down to
// 1568px, so a file this large is not a picture someone means to ask about, and
// decoding it would freeze the UI for seconds before the pixels are thrown away.
const MAX_IMAGE_ATTACHMENT_BYTES = 20 * 1024 * 1024;

function createId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }

  return `image-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

// SVG is deliberately absent: it is markup, no vision model takes it, and
// createImageBitmap refuses it in the webview too — so it would be attached,
// silently fail to encode and be reported as unreadable. Everything else
// guessImageMimeType knows is a raster format a provider accepts.
const ATTACHABLE_IMAGE_MIME_TYPES = ["image/png", "image/jpeg", "image/gif", "image/webp", "image/bmp"];

function isAttachableImageMimeType(mimeType: string): boolean {
  return ATTACHABLE_IMAGE_MIME_TYPES.includes(mimeType);
}

/** Whether this file name is one of the image formats a vision request takes. */
export function isAttachableImageName(name: string): boolean {
  return isAttachableImageMimeType(guessImageMimeType(name));
}

/** The data: URL that previews an attachment in its chip. */
export function imagePreviewUrl(image: AttachedChatImage): string {
  return `data:${image.mimeType};base64,${image.base64}`;
}

export type ImageAttachmentError = "unsupported" | "tooLarge" | "failed";

export type ImageAttachmentResult =
  | { ok: true; attachment: AttachedChatImage }
  | { ok: false; reason: ImageAttachmentError };

async function encodeAttachment(
  name: string,
  bytes: Uint8Array,
  mimeType: string
): Promise<ImageAttachmentResult> {
  try {
    const encoded = await encodeImageForVision(bytes, mimeType);

    return {
      ok: true,
      attachment: {
        id: createId(),
        name,
        base64: encoded.base64,
        mimeType: encoded.mimeType
      }
    };
  } catch {
    return { ok: false, reason: "failed" };
  }
}

/**
 * Reads an image handed over by the webview — dropped from outside the app,
 * pasted from the clipboard or picked in the file dialog.
 *
 * Needs no filesystem permission at all: the drop, paste or pick *is* the user
 * handing the picture over, and the bytes come with it. Same reasoning as
 * readDroppedAttachment in attachedFiles.ts.
 */
export async function readAttachedImageFile(file: File): Promise<ImageAttachmentResult> {
  // A pasted screenshot arrives as "image.png" or with no useful name at all,
  // so the type the clipboard reports decides and the extension is only the
  // fallback for a file dragged in from the Explorer.
  const mimeType = isAttachableImageMimeType(file.type)
    ? file.type
    : guessImageMimeType(file.name);

  if (!isAttachableImageMimeType(mimeType)) {
    return { ok: false, reason: "unsupported" };
  }

  if (file.size > MAX_IMAGE_ATTACHMENT_BYTES) {
    return { ok: false, reason: "tooLarge" };
  }

  try {
    const bytes = new Uint8Array(await file.arrayBuffer());

    return await encodeAttachment(file.name || "image", bytes, mimeType);
  } catch {
    return { ok: false, reason: "failed" };
  }
}

/**
 * Model-facing English, like the note inlineAttachedFiles builds next door.
 *
 * Without it the turn carries raw image blocks and nothing that says where they
 * came from, and a small model meets them with "please upload the image" — the
 * transcript that prompted this. Saying the picture is already here, and that
 * there is no upload step and nothing to fetch, is what turns it into something
 * the model acts on instead of asking about.
 */
function buildImageAttachmentNote(images: readonly AttachedChatImage[]): string {
  const isSingle = images.length === 1;
  const names = images.map((image) => image.name).join(", ");

  return (
    `[Attached image${isSingle ? "" : "s"}: the user attached ${isSingle ? "this picture" : "these pictures"} ` +
    `to the conversation (${names}), and ${isSingle ? "it is" : "they are"} included in this message as ` +
    `${isSingle ? "an image you can see" : "images you can see"}. There is nothing to upload, nothing to ` +
    "fetch and no path to look up: look at the picture and answer from what is in it. Never ask the user " +
    "to send or upload it, and never say you cannot see it — if you genuinely cannot, say that your model " +
    `has no vision support. get_image does not apply here; that tool reads images out of the open ` +
    "document, not the ones attached to the chat.]"
  );
}

/**
 * Derived view of the history with the attached images hung on the newest user
 * turn, mirroring inlineAttachedFiles.
 *
 * Only that one turn carries them: they are the same pictures for every turn of
 * the conversation, so repeating them per turn would spend the whole context
 * window — and several megabytes of base64 — on the same image. Never
 * persisted: detaching an image in the composer is enough to make the next
 * request go out without it.
 *
 * Runs before attachImageData, which then tops the turn up with whatever
 * get_image resolved, up to the shared cap.
 */
export function inlineAttachedImages(
  messages: AiChatMessage[],
  images: readonly AttachedChatImage[]
): AiChatMessage[] {
  if (images.length === 0) {
    return messages;
  }

  const taken = images.slice(0, MAX_ATTACHED_IMAGES_PER_CHAT);
  const attached: AiChatImage[] = taken.map((image) => ({
    path: image.name,
    base64: image.base64,
    mimeType: image.mimeType
  }));
  const note = buildImageAttachmentNote(taken);

  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const message = messages[i];

    // Never the turn that only exists to carry an image the agent asked for:
    // the user did not write it, and its own images are resolved from
    // imagePaths. Same guard as inlineAttachedFiles.
    if (message.role !== "user" || message.imagePaths?.length) {
      continue;
    }

    const expanded = [...messages];
    expanded[i] = {
      ...message,
      content: `${note}

${message.content}`,
      images: [...attached, ...(message.images ?? [])]
    };

    return expanded;
  }

  return messages;
}
