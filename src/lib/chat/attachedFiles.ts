// Files the user dragged onto the chat panel — this conversation's primary
// source of truth.
//
// Deliberately independent of the knowledge base ("Wissensbasis", see
// src/lib/ragSearch.ts): dragging a file in is itself the instruction to read
// *that* file, so it works with the feature switched off, works for files that
// are not part of the vault at all, and outranks anything search_vault might
// turn up. Consequently nothing here is gated on RagConfig.
//
// Same two-stage split as the image attachments next door: the persisted
// history only remembers the file *names* (so a reopened transcript can still
// say what a question was asked about), while the text itself lives in the chat
// store for as long as the file stays attached and is folded into the outgoing
// request right before it goes out. Persisting the content would write whole
// documents into chat-sessions.json once per turn.

import { readTextFile } from "@tauri-apps/plugin-fs";

import type { AiChatMessage } from "@/lib/aiClient";
import { getRelativeDisplayPath } from "@/lib/fileSystem";
import {
  SourceTooLargeError,
  classifyExtension,
  convertToMarkdown,
  extensionOf,
  sourceFromFile
} from "@/lib/import/convert";

export type AttachedChatFile = {
  // Stable per attachment so the chip's remove button addresses one entry even
  // when two folders hold a file of the same name.
  id: string;
  name: string;
  // Vault-relative for a note dragged out of the sidebar, "" for a file dropped
  // in from outside — a dropped File exposes no path in the webview. Only used
  // to tell the model where the text came from.
  path: string;
  // Already clamped to MAX_FILE_CHARS when it was read; `truncated` says so.
  content: string;
  truncated: boolean;
};

/** How many files one chat can carry. */
export const MAX_ATTACHED_FILES = 5;

// Cap per file at read time, so the store never holds a whole book in memory.
// The per-request budget below cuts further when the model's context is small.
const MAX_FILE_CHARS = 40_000;

// Refused before reading: a file this large is not a note, and decoding it as
// text would freeze the UI for seconds before the content is thrown away anyway.
// Documents get more room than plain text (a PDF carries fonts and images that
// never reach the model) — convert.ts caps the text formats far lower.
const MAX_FILE_BYTES = 25 * 1024 * 1024;

// Upper bound on what all attachments together contribute to one request, even
// with a huge context window. Beyond this the conversation itself starts losing
// turns to the trimming, which is a worse answer than a cut-off file.
const MAX_TOTAL_CHARS = 40_000;

// Share of the model's context the attachments may claim. Kept well below
// CONTEXT_BUDGET_RATIO (see contextWindow.ts) so the user's question and the
// recent history still fit beside them on a small local model.
const CONTEXT_SHARE = 0.3;

// Extensions read as text — the notes the file tree deals in. Files dropped
// from outside go through the converters instead (see readDroppedAttachment),
// which covers PDF and DOCX too.
const TEXT_EXTENSIONS = [
  "md",
  "markdown",
  "mdown",
  "txt",
  "text",
  "csv",
  "tsv",
  "json",
  "yaml",
  "yml",
  "log",
  "xml",
  "html",
  "htm"
];

function createId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }

  return `attachment-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

/** Last segment of a path, in either separator style. */
export function fileNameFromPath(path: string): string {
  return path.replace(/\\/g, "/").split("/").pop() ?? path;
}

export function isAttachableFileName(name: string): boolean {
  const extension = name.toLowerCase().split(".").pop() ?? "";

  return name.includes(".") && TEXT_EXTENSIONS.includes(extension);
}

function clampContent(content: string): { content: string; truncated: boolean } {
  return content.length > MAX_FILE_CHARS
    ? { content: content.slice(0, MAX_FILE_CHARS), truncated: true }
    : { content, truncated: false };
}

/**
 * Reads a note dragged out of the file tree. `folderPath` only shapes the label
 * the model sees — the path itself comes from the drag payload the sidebar
 * wrote, so it is a file of the opened vault by construction.
 */
export async function readVaultAttachment(
  folderPath: string | null,
  absolutePath: string
): Promise<AttachedChatFile | null> {
  const name = fileNameFromPath(absolutePath);

  if (!isAttachableFileName(name)) {
    return null;
  }

  try {
    const { content, truncated } = clampContent(await readTextFile(absolutePath));

    return {
      id: createId(),
      name,
      path: folderPath ? getRelativeDisplayPath(folderPath, absolutePath) : name,
      content,
      truncated
    };
  } catch {
    return null;
  }
}

export type DroppedAttachmentError =
  | "unsupported"
  | "legacyDoc"
  | "ocrNoModel"
  | "tooLarge"
  | "failed";

export type DroppedAttachmentResult =
  | { ok: true; attachment: AttachedChatFile }
  | { ok: false; reason: DroppedAttachmentError };

/**
 * Reads a file dragged in from outside the app as chat context, converting it
 * to markdown on the way — the same converters the file tree's import uses,
 * only without embedding images: nothing is written to disk here, and an image
 * in a PDF costs seconds of decoding for text the model never sees.
 *
 * Needs no filesystem permission at all: the drop *is* the user handing the
 * file over, and the webview passes its content along with it.
 */
export async function readDroppedAttachment(file: File): Promise<DroppedAttachmentResult> {
  const kind = classifyExtension(extensionOf(file.name));

  if (kind === "legacyDoc") {
    return { ok: false, reason: "legacyDoc" };
  }

  if (kind === "unsupported") {
    return { ok: false, reason: "unsupported" };
  }

  if (kind === "image") {
    const { isAiOcrConfigured } = await import("@/lib/import/imageImporter");

    if (!isAiOcrConfigured()) {
      return { ok: false, reason: "ocrNoModel" };
    }
  }

  if (file.size > MAX_FILE_BYTES) {
    return { ok: false, reason: "tooLarge" };
  }

  try {
    const markdown = await convertToMarkdown(sourceFromFile(file), { embedImages: false });
    const { content, truncated } = clampContent(markdown);

    return {
      ok: true,
      attachment: { id: createId(), name: file.name, path: "", content, truncated }
    };
  } catch (error) {
    return { ok: false, reason: error instanceof SourceTooLargeError ? "tooLarge" : "failed" };
  }
}

/**
 * Model-facing English, like the tool results in agentTools.ts — the user only
 * ever sees the localized chips in the composer.
 *
 * The precedence sentence is the whole point of the note: with the knowledge
 * base switched on, rule V1 of VAULT_INSTRUCTION tells the model to search the
 * vault before answering, and without something outranking it a model will
 * happily answer from a search hit while the file the user just handed it says
 * something else.
 */
function buildAttachmentNote(files: readonly AttachedChatFile[], budget: number): string {
  // An equal share each, so one long file cannot crowd the others out entirely.
  const perFile = Math.max(500, Math.floor(budget / files.length));

  const blocks = files.map((file) => {
    const label = file.path || file.name;
    const cut = file.content.length > perFile;
    const body = cut ? file.content.slice(0, perFile) : file.content;

    return [
      `--- attached file: ${label} ---`,
      body,
      cut || file.truncated ? "[…file continues; this is the beginning of it]" : "",
      `--- end of attached file: ${label} ---`
    ]
      .filter(Boolean)
      .join("\n");
  });

  return [
    `[Attached files: the user attached ${files.length === 1 ? "this file" : "these files"} to the ` +
      "conversation. Their content follows in full, so there is nothing to look up for them.",
    ...blocks,
    "These files are the primary source for this conversation: answer from them first, and prefer them " +
      "over your own knowledge, over the open document and over anything the vault search returns. Search " +
      "the vault only for what they do not cover, and say plainly when they do not answer the question. " +
      "Quote and refer to them by the file name given above.]"
  ].join("\n");
}

/**
 * Derived view of the history with the attached files' content folded into the
 * newest user turn.
 *
 * Only that one turn carries them: they are the same files for every turn of
 * the conversation, so repeating them per turn would spend the whole context
 * window on the same text. Runs before the window is trimmed (see
 * selectMessagesForModel) so the content is charged against the budget like any
 * other content, and is never persisted — detaching a file in the composer is
 * enough to make the next request go out without it.
 */
export function inlineAttachedFiles(
  messages: AiChatMessage[],
  files: readonly AttachedChatFile[],
  contextLength: number
): AiChatMessage[] {
  if (files.length === 0) {
    return messages;
  }

  const budget = Math.max(
    2_000,
    Math.min(MAX_TOTAL_CHARS, Math.floor(contextLength * 4 * CONTEXT_SHARE))
  );
  const note = buildAttachmentNote(files, budget);

  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const message = messages[i];

    // Never the turn that only exists to carry an image the agent asked for:
    // the user did not write it, and it is followed by nothing they did write.
    if (message.role !== "user" || message.imagePaths?.length) {
      continue;
    }

    const expanded = [...messages];
    expanded[i] = { ...message, content: `${note}\n\n${message.content}` };

    return expanded;
  }

  return messages;
}
