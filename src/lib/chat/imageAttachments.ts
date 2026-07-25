// Turns the image paths recorded on a chat message into actual vision data.
//
// Two-stage by design: the conversation history (persisted to
// .scribedog/chat-sessions.json) only ever stores an image's *path*, and the
// base64 payload is resolved here right before a request goes out and thrown
// away afterwards. Persisting base64 would bloat the session file by megabytes
// per image, and the file on disk is the source of truth anyway — an edited
// image should be re-read, not served from a stale copy in the history.

import { dirname, join, normalize } from "@tauri-apps/api/path";
import { readFile, stat } from "@tauri-apps/plugin-fs";

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
      result[i] = { ...message, images };
    }
  }

  return result;
}
