import { join } from "@tauri-apps/api/path";

import { decodeEscapedLineBreaks } from "@/lib/editor/markdownNormalize";
import { getRelativeDisplayPath, readMarkdownFile } from "@/lib/fileSystem";
import { useAppStore } from "@/store/useAppStore";
import { useStagedChangesStore } from "@/store/useStagedChangesStore";

import {
  assertVaultPath,
  normalizeVaultPath,
  stagedChangeKind,
  vaultPathKey,
  VaultPathError,
  type StagedChange
} from "./vaultStaging";

/**
 * Execution of the vault agent's file tools. Everything here proposes rather
 * than writes: a call ends in an entry in useStagedChangesStore, which the user
 * reviews and applies (see src/lib/chat/vaultStaging.ts).
 *
 * Kept out of agentTools.ts, which is the bridge to the *open editor* — these
 * tools work on every file except that one, and share nothing with it beyond
 * the ToolResult shape.
 */

/** Mirrors ToolResult in agentTools.ts; re-declared to keep the import one-way. */
type FileToolResult = {
  content: string;
  retryable?: boolean;
};

// Same ceiling read_note uses: a long note handed back whole would eat the
// context window in one tool result and push the user's question out of it.
const MAX_FILE_CHARS = 8_000;

// A vault can hold thousands of notes; a listing that long is not a list the
// model can work with, it is the context window gone.
const MAX_LISTED_FILES = 400;

const MAX_SEARCH_RESULTS_DEFAULT = 50;
const MAX_SEARCH_RESULTS_LIMIT = 200;
const MAX_SEARCH_LINE_CHARS = 200;

/**
 * Which chat turn the current tool calls belong to, so a staged entry can point
 * back at the message the undo button hangs on. Module-level for the same
 * reason the editor bridge is: the store driving the loop has no route to pass
 * it down through executeTool's signature.
 */
let turnContext: { sessionId: string; messageIndex: number } = { sessionId: "", messageIndex: -1 };

export function setAgentTurnContext(sessionId: string, messageIndex: number): void {
  turnContext = { sessionId, messageIndex };
}

/**
 * What the agent is allowed to do to files this turn — the same switches that
 * decide which tools are offered to the model (agentFileAccess,
 * agentAllowDelete).
 *
 * Enforced here as well as at the offer, because "the model never sees the
 * tool" stops being the whole story the moment a call is resolved by anything
 * other than an exact name: a hallucinated `create_file` mapped to write_file
 * (see canonicalToolName in agentTools.ts) would otherwise write to the vault
 * with the consent switch off. Closed by default, so a caller that forgets to
 * set them gets no file access rather than all of it.
 */
let capabilities = { fileAccess: false, allowDelete: false };

export function setAgentCapabilities(next: { fileAccess: boolean; allowDelete: boolean }): void {
  capabilities = { ...next };
}

function disabledResult(what: string): FileToolResult {
  return {
    content:
      `Error: ${what} is switched off in this app's AI settings, so you have no tool for it and cannot ` +
      "turn it on. Do not try another way round it. Tell the user in one sentence that the setting is off " +
      "and where to enable it (AI settings, agent options), and offer what you can do without it."
  };
}

function stageEntry(entry: Omit<StagedChange, "sessionId" | "messageIndex">): void {
  useStagedChangesStore.getState().stage({
    ...entry,
    sessionId: turnContext.sessionId,
    messageIndex: turnContext.messageIndex
  });
}

function pathError(error: unknown): FileToolResult {
  if (error instanceof VaultPathError) {
    // Retryable: every one of these messages names the shape of a correct path,
    // and the next attempt usually has it.
    return { content: `Error: ${error.message}`, retryable: true };
  }

  return { content: "Error: that path could not be used." };
}

type VaultContext = {
  folderPath: string;
  /** Vault-relative path -> absolute path, for every note in the tree. */
  filesByKey: Map<string, { relativePath: string; absolutePath: string }>;
  /** The open document, which the file tools refuse to touch. */
  openRelativePath: string | null;
};

function vaultContext(): VaultContext | null {
  const { folderPath, filePaths, selectedFilePath } = useAppStore.getState();

  if (!folderPath) {
    return null;
  }

  const filesByKey = new Map<string, { relativePath: string; absolutePath: string }>();

  for (const absolutePath of filePaths) {
    const relativePath = normalizeVaultPath(getRelativeDisplayPath(folderPath, absolutePath));
    filesByKey.set(vaultPathKey(relativePath), { relativePath, absolutePath });
  }

  return {
    folderPath,
    filesByKey,
    openRelativePath: selectedFilePath
      ? normalizeVaultPath(getRelativeDisplayPath(folderPath, selectedFilePath))
      : null
  };
}

function noVaultResult(): FileToolResult {
  return { content: "Error: no folder is open, so there are no files to work on." };
}

/**
 * Refuses the open document, pointing at the tools that do work on it.
 *
 * Two mechanisms editing one document is the bug nobody can reproduce: the
 * editor's widgets and a staged whole-file replacement would each be built
 * against a different version of the text, and whichever is applied second
 * silently swallows the other.
 */
function openDocumentGuard(context: VaultContext, relativePath: string): FileToolResult | null {
  if (
    !context.openRelativePath ||
    vaultPathKey(context.openRelativePath) !== vaultPathKey(relativePath)
  ) {
    return null;
  }

  return {
    content:
      `Error: "${relativePath}" is the document currently open in the editor, and the file tools do not ` +
      "touch it. Use replace_passage (or replace_selection / insert_at_cursor) for this one — call " +
      "get_document first to see its current wording.",
    retryable: true
  };
}

/**
 * The content the model should see for a file: its staged version when the
 * agent has already proposed a change, otherwise what is in the editor's
 * in-memory document or on disk.
 *
 * Handing back the staged version is what makes a second edit_file on the same
 * file compose with the first instead of silently reverting it — the entry
 * describes a target state, and the next edit has to build on that state.
 */
async function effectiveContent(
  context: VaultContext,
  relativePath: string
): Promise<{ content: string | null; staged: StagedChange | undefined }> {
  const staged = useStagedChangesStore.getState().changeFor(relativePath);

  if (staged) {
    return { content: staged.content, staged };
  }

  const file = context.filesByKey.get(vaultPathKey(relativePath));

  if (!file) {
    return { content: null, staged: undefined };
  }

  const document = useAppStore.getState().fileDocuments[file.absolutePath];

  if (document) {
    return { content: document.content, staged: undefined };
  }

  return { content: await readMarkdownFile(file.absolutePath).catch(() => null), staged: undefined };
}

/** Content as it is right now, ignoring anything staged — a change's baseline. */
async function baselineContent(context: VaultContext, relativePath: string): Promise<string | null> {
  const file = context.filesByKey.get(vaultPathKey(relativePath));

  if (!file) {
    return null;
  }

  const document = useAppStore.getState().fileDocuments[file.absolutePath];

  return document ? document.content : await readMarkdownFile(file.absolutePath).catch(() => null);
}

function unknownFileResult(relativePath: string): FileToolResult {
  return {
    content:
      `Error: "${relativePath}" is not a note in this vault. Call list_files and use a path exactly as it ` +
      "reports it — never guess one.",
    retryable: true
  };
}

// --- Passage matching --------------------------------------------------------
//
// old_text comes from a language model quoting a file it read, so it is rarely
// character-identical: trailing spaces get dropped, indentation normalizes, a
// CRLF becomes an LF. An exact indexOf alone sends the model into a retry loop
// over a passage it identified perfectly well — hence the second, whitespace-
// tolerant pass. (The editor's findTextRange does the same job for ProseMirror
// documents; this is the plain-string case, where none of its position mapping
// applies.)

type PassageMatch = { start: number; end: number; occurrences: number };

function collapseWhitespace(text: string): { value: string; map: number[] } {
  let value = "";
  const map: number[] = [];
  let pendingSpace = false;

  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];

    if (/\s/.test(character)) {
      pendingSpace = value.length > 0;
      continue;
    }

    if (pendingSpace) {
      value += " ";
      map.push(index);
      pendingSpace = false;
    }

    value += character;
    map.push(index);
  }

  return { value, map };
}

export function findPassage(content: string, needle: string): PassageMatch | null {
  if (!needle) {
    return null;
  }

  const exact = content.indexOf(needle);

  if (exact !== -1) {
    let occurrences = 0;
    let cursor = 0;

    while (cursor !== -1) {
      cursor = content.indexOf(needle, cursor);

      if (cursor === -1) {
        break;
      }

      occurrences += 1;
      cursor += needle.length;
    }

    return { start: exact, end: exact + needle.length, occurrences };
  }

  const haystack = collapseWhitespace(content);
  const collapsedNeedle = collapseWhitespace(needle).value;

  if (!collapsedNeedle) {
    return null;
  }

  const index = haystack.value.indexOf(collapsedNeedle);

  if (index === -1) {
    return null;
  }

  let occurrences = 0;
  let cursor = 0;

  while (cursor !== -1) {
    cursor = haystack.value.indexOf(collapsedNeedle, cursor);

    if (cursor === -1) {
      break;
    }

    occurrences += 1;
    cursor += collapsedNeedle.length;
  }

  return {
    start: haystack.map[index],
    end: haystack.map[index + collapsedNeedle.length - 1] + 1,
    occurrences
  };
}

// --- The tools ---------------------------------------------------------------

async function listFiles(): Promise<FileToolResult> {
  const context = vaultContext();

  if (!context) {
    return noVaultResult();
  }

  const staged = useStagedChangesStore.getState().changes;
  const stagedKeys = new Set(
    staged.flatMap((change) => [vaultPathKey(change.path), vaultPathKey(change.targetPath)])
  );
  // Files the agent proposed into existence are not in the tree yet, but they
  // are files as far as the next tool call is concerned.
  const createdPaths = staged
    .filter((change) => !change.path && change.targetPath)
    .map((change) => change.targetPath);

  const all = [...[...context.filesByKey.values()].map((file) => file.relativePath), ...createdPaths].sort(
    (left, right) => left.localeCompare(right, undefined, { numeric: true, sensitivity: "base" })
  );

  if (all.length === 0) {
    return { content: "The vault contains no notes yet. write_file creates the first one." };
  }

  const shown = all.slice(0, MAX_LISTED_FILES);
  const lines = shown.map((relativePath) => {
    const marker = stagedKeys.has(vaultPathKey(relativePath)) ? "  [change already proposed]" : "";

    return `${relativePath}${marker}`;
  });

  const cutOff =
    all.length > shown.length
      ? `\n[…${all.length - shown.length} more. Use search_files to find what you need instead of listing everything.]`
      : "";

  return {
    content:
      `${all.length} note(s) in the vault. The open document is not listed as editable here — use the ` +
      `passage tools for it:\n${lines.join("\n")}${cutOff}`
  };
}

async function readFile(args: Record<string, unknown>): Promise<FileToolResult> {
  const context = vaultContext();

  if (!context) {
    return noVaultResult();
  }

  let relativePath: string;

  try {
    relativePath = assertVaultPath(args.path);
  } catch (error) {
    return pathError(error);
  }

  const { content, staged } = await effectiveContent(context, relativePath);

  if (content === null) {
    if (staged && stagedChangeKind(staged) === "delete") {
      return { content: `"${relativePath}" is staged for deletion — there is nothing left to read.` };
    }

    return unknownFileResult(relativePath);
  }

  if (!content.trim()) {
    return { content: `"${relativePath}" is empty.` };
  }

  const truncated = content.length > MAX_FILE_CHARS;
  const body = truncated ? `${content.slice(0, MAX_FILE_CHARS)}\n\n[…file continues]` : content;
  // Saying which version this is matters: the model is about to quote a passage
  // back as old_text, and a mismatch between "what I read" and "what edit_file
  // searches" is the one failure it cannot diagnose from the error message.
  const note = staged
    ? "\n\n[Note: this is YOUR proposed version of the file, not what is on disk — it has not been " +
      "applied yet. Further edits build on the text above.]"
    : "";

  return { content: `${relativePath}:\n\n${body}${note}` };
}

async function writeFile(args: Record<string, unknown>): Promise<FileToolResult> {
  const context = vaultContext();

  if (!context) {
    return noVaultResult();
  }

  let relativePath: string;

  try {
    relativePath = assertVaultPath(args.path);
  } catch (error) {
    return pathError(error);
  }

  const blocked = openDocumentGuard(context, relativePath);

  if (blocked) {
    return blocked;
  }

  // Every text a model hands in goes through this: a file written with literal
  // "\n" instead of line breaks is one long unreadable paragraph, and the user
  // only finds out after applying the batch.
  const content = typeof args.content === "string" ? decodeEscapedLineBreaks(args.content) : "";
  const staged = useStagedChangesStore.getState().changeFor(relativePath);
  const existing = staged ? staged.baseContent : await baselineContent(context, relativePath);
  const isNew = existing === null;

  stageEntry({
    path: staged ? staged.path : isNew ? "" : relativePath,
    targetPath: staged ? staged.targetPath || relativePath : relativePath,
    baseContent: existing,
    content
  });

  const verb = isNew ? "creating" : "replacing the whole content of";

  return {
    content:
      `OK: proposed ${verb} "${relativePath}". It is waiting for review in the file tree and is not on ` +
      `disk yet.${staged ? " This replaced your earlier proposal for this file rather than adding a second one." : ""}`
  };
}

/** One edit for edit_file and multi_edit alike; answers with what to tell the model. */
async function applyPassageEdit(
  context: VaultContext,
  rawPath: unknown,
  oldText: unknown,
  newText: unknown
): Promise<{ ok: boolean; message: string; retryable?: boolean }> {
  let relativePath: string;

  try {
    relativePath = assertVaultPath(rawPath);
  } catch (error) {
    return {
      ok: false,
      message: error instanceof VaultPathError ? error.message : "unusable path.",
      retryable: true
    };
  }

  const blocked = openDocumentGuard(context, relativePath);

  if (blocked) {
    return { ok: false, message: blocked.content.replace(/^Error: /, ""), retryable: true };
  }

  if (typeof oldText !== "string" || !oldText) {
    return { ok: false, message: `no old_text given for "${relativePath}".`, retryable: true };
  }

  const replacement = typeof newText === "string" ? decodeEscapedLineBreaks(newText) : "";
  const needle = decodeEscapedLineBreaks(oldText);
  const { content, staged } = await effectiveContent(context, relativePath);

  if (content === null) {
    return {
      ok: false,
      message: `"${relativePath}" is not a note in this vault — call list_files and use an exact path.`,
      retryable: true
    };
  }

  const match = findPassage(content, needle);

  if (!match) {
    return {
      ok: false,
      // The same advice replace_passage gives: repeating "copy it verbatim" is
      // what produces the retry loop, since the lookup already tolerates
      // whitespace. A miss almost always means old_text was too long.
      message:
        `passage not found in "${relativePath}". Do not retry with the same old_text — use a shorter, ` +
        "distinctive fragment from a single line, or read_file again.",
      retryable: true
    };
  }

  const next = content.slice(0, match.start) + replacement + content.slice(match.end);
  const baseContent = staged ? staged.baseContent : await baselineContent(context, relativePath);

  stageEntry({
    path: staged ? staged.path : baseContent === null ? "" : relativePath,
    targetPath: staged ? staged.targetPath || relativePath : relativePath,
    baseContent,
    content: next
  });

  const ambiguous =
    match.occurrences > 1
      ? ` (that passage occurs ${match.occurrences} times — the first one was changed)`
      : "";

  return { ok: true, message: `"${relativePath}" updated${ambiguous}` };
}

async function editFile(args: Record<string, unknown>): Promise<FileToolResult> {
  const context = vaultContext();

  if (!context) {
    return noVaultResult();
  }

  const result = await applyPassageEdit(context, args.path, args.old_text, args.new_text);

  if (!result.ok) {
    return { content: `Error: ${result.message}`, ...(result.retryable ? { retryable: true } : {}) };
  }

  return {
    content: `OK: change proposed — ${result.message}. Nothing reaches the disk until it is applied.`
  };
}

async function multiEdit(args: Record<string, unknown>): Promise<FileToolResult> {
  const context = vaultContext();

  if (!context) {
    return noVaultResult();
  }

  const rawEdits = Array.isArray(args.edits) ? args.edits : [];

  if (rawEdits.length === 0) {
    return {
      content: "Error: no edits given. Pass edits as a list of {path, old_text, new_text} objects.",
      retryable: true
    };
  }

  const succeeded: string[] = [];
  const failed: string[] = [];

  for (const raw of rawEdits) {
    const edit = (typeof raw === "object" && raw !== null ? raw : {}) as Record<string, unknown>;
    const result = await applyPassageEdit(context, edit.path, edit.old_text, edit.new_text);

    if (result.ok) {
      succeeded.push(result.message);
    } else {
      failed.push(result.message);
    }
  }

  // Per edit, never a blanket verdict: told "multi_edit failed", a model
  // repeats the edits that worked as well, and each repetition is another
  // proposal on a file that already has one.
  if (failed.length === 0) {
    return {
      content:
        `OK: ${succeeded.length} change(s) proposed — ${succeeded.join("; ")}. Nothing reaches the ` +
        "disk until they are applied."
    };
  }

  if (succeeded.length === 0) {
    return { content: `Error: none of the ${failed.length} edits worked: ${failed.join("; ")}`, retryable: true };
  }

  return {
    content:
      `Partial: ${succeeded.length} of ${rawEdits.length} change(s) proposed — ${succeeded.join("; ")}. ` +
      `Failed, retry ONLY these: ${failed.join("; ")}`,
    retryable: true
  };
}

async function renameFile(args: Record<string, unknown>): Promise<FileToolResult> {
  const context = vaultContext();

  if (!context) {
    return noVaultResult();
  }

  let relativePath: string;
  let targetPath: string;

  try {
    relativePath = assertVaultPath(args.path);
    targetPath = assertVaultPath(args.new_path);
  } catch (error) {
    return pathError(error);
  }

  const blocked = openDocumentGuard(context, relativePath);

  if (blocked) {
    return blocked;
  }

  if (vaultPathKey(relativePath) === vaultPathKey(targetPath)) {
    return { content: `Error: "${relativePath}" already has that path — nothing to rename.`, retryable: true };
  }

  const staged = useStagedChangesStore.getState().changeFor(relativePath);
  const baseContent = staged ? staged.baseContent : await baselineContent(context, relativePath);

  if (baseContent === null && !staged) {
    return unknownFileResult(relativePath);
  }

  if (context.filesByKey.has(vaultPathKey(targetPath))) {
    return {
      content: `Error: "${targetPath}" already exists. Choose a different name.`,
      retryable: true
    };
  }

  stageEntry({
    path: staged ? staged.path : relativePath,
    targetPath,
    baseContent,
    content: staged ? staged.content : baseContent
  });

  return {
    content:
      `OK: proposed renaming "${relativePath}" to "${targetPath}". Nothing is moved until it is ` +
      "applied."
  };
}

async function deleteFile(args: Record<string, unknown>): Promise<FileToolResult> {
  const context = vaultContext();

  if (!context) {
    return noVaultResult();
  }

  let relativePath: string;

  try {
    relativePath = assertVaultPath(args.path);
  } catch (error) {
    return pathError(error);
  }

  const blocked = openDocumentGuard(context, relativePath);

  if (blocked) {
    return blocked;
  }

  const staged = useStagedChangesStore.getState().changeFor(relativePath);
  const baseContent = staged ? staged.baseContent : await baselineContent(context, relativePath);

  if (baseContent === null && !staged) {
    return unknownFileResult(relativePath);
  }

  stageEntry({
    path: staged ? staged.path : relativePath,
    targetPath: "",
    baseContent,
    content: null
  });

  return {
    content:
      `OK: proposed deleting "${relativePath}". It needs a confirmation and can be taken back ` +
      "afterwards — but say plainly in your reply that this deletes the note."
  };
}

async function createFolder(args: Record<string, unknown>): Promise<FileToolResult> {
  const context = vaultContext();

  if (!context) {
    return noVaultResult();
  }

  let relativePath: string;

  try {
    relativePath = assertVaultPath(args.path, { requireMarkdown: false });
  } catch (error) {
    return pathError(error);
  }

  const absolute = await join(context.folderPath, ...relativePath.split("/"));
  const created = await useAppStore.getState().createFolderAtPath(absolute);

  if (!created) {
    return { content: `Error: the folder "${relativePath}" could not be created.` };
  }

  // Unlike every other file tool this one takes effect immediately, the same
  // way set_image_width does: an empty folder carries no text there would be
  // anything to review, and the user removes it in the tree with one click.
  return {
    content:
      `OK: the folder "${relativePath}" now exists. Unlike the other file tools this took effect right ` +
      "away — do not say it has to be applied."
  };
}

async function searchFiles(args: Record<string, unknown>): Promise<FileToolResult> {
  const context = vaultContext();

  if (!context) {
    return noVaultResult();
  }

  const query = typeof args.query === "string" ? args.query : "";

  if (!query.trim()) {
    return { content: "Error: no search query given.", retryable: true };
  }

  const useRegex = args.regex === true || args.regex === "true";
  const glob = typeof args.glob === "string" ? args.glob.trim().toLowerCase() : "";
  const requested =
    typeof args.max_results === "number"
      ? args.max_results
      : Number.parseInt(String(args.max_results ?? ""), 10);
  const limit = Number.isFinite(requested)
    ? Math.min(Math.max(requested, 1), MAX_SEARCH_RESULTS_LIMIT)
    : MAX_SEARCH_RESULTS_DEFAULT;

  let pattern: RegExp;

  try {
    pattern = useRegex ? new RegExp(query, "i") : new RegExp(escapeRegExp(query), "i");
  } catch (error) {
    // The engine's own message is the only useful thing to say here, and a bad
    // regex is something the model fixes on its next attempt.
    return {
      content: `Error: that regular expression is invalid (${(error as Error).message}). Fix it or set regex to false.`,
      retryable: true
    };
  }

  const hits: string[] = [];
  let searchedFiles = 0;

  for (const file of context.filesByKey.values()) {
    if (hits.length >= limit) {
      break;
    }

    if (glob && !file.relativePath.toLowerCase().includes(glob)) {
      continue;
    }

    const { content } = await effectiveContent(context, file.relativePath);

    if (content === null) {
      continue;
    }

    searchedFiles += 1;

    const lines = content.split(/\r?\n/);

    for (let index = 0; index < lines.length && hits.length < limit; index += 1) {
      if (!pattern.test(lines[index])) {
        continue;
      }

      const line = lines[index].trim();
      const shown =
        line.length > MAX_SEARCH_LINE_CHARS ? `${line.slice(0, MAX_SEARCH_LINE_CHARS)}…` : line;

      hits.push(`${file.relativePath}:${index + 1}  ${shown}`);
    }
  }

  if (hits.length === 0) {
    return {
      content:
        `No hit for "${query}" in ${searchedFiles} note(s). This is a literal text search — try other ` +
        "wording, a name or a shorter fragment before concluding there is nothing.",
      retryable: true
    };
  }

  const capped = hits.length >= limit ? `\n[…cut off at ${limit} hits — narrow the query.]` : "";

  return { content: `${hits.length} hit(s) for "${query}":\n${hits.join("\n")}${capped}` };
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// Headings straight off the markdown. The knowledge base's own heading trails
// are built in the Rust index (src-tauri), which the frontend cannot call into
// for a single file — and a fenced-code-aware "# " scan is short enough that
// reaching across that boundary would cost more than it saves.
export function outlineOf(content: string): { level: number; title: string; line: number }[] {
  const headings: { level: number; title: string; line: number }[] = [];
  let inFence = false;

  content.split(/\r?\n/).forEach((line, index) => {
    if (/^\s*(```|~~~)/.test(line)) {
      inFence = !inFence;
      return;
    }

    if (inFence) {
      return;
    }

    const match = /^(#{1,6})\s+(.+?)\s*#*\s*$/.exec(line);

    if (match) {
      headings.push({ level: match[1].length, title: match[2].trim(), line: index + 1 });
    }
  });

  return headings;
}

async function getOutline(args: Record<string, unknown>): Promise<FileToolResult> {
  const context = vaultContext();

  if (!context) {
    return noVaultResult();
  }

  let relativePath: string;

  try {
    relativePath = assertVaultPath(args.path);
  } catch (error) {
    return pathError(error);
  }

  const { content } = await effectiveContent(context, relativePath);

  if (content === null) {
    return unknownFileResult(relativePath);
  }

  const headings = outlineOf(content);
  const lineCount = content.split(/\r?\n/).length;

  if (headings.length === 0) {
    return {
      content: `"${relativePath}" has no headings (${lineCount} lines). Call read_file for its text.`
    };
  }

  const lines = headings.map(
    (heading) => `${"  ".repeat(heading.level - 1)}${"#".repeat(heading.level)} ${heading.title}  (line ${heading.line})`
  );

  return { content: `Outline of "${relativePath}" (${lineCount} lines):\n${lines.join("\n")}` };
}

/**
 * The names this module answers to. Kept as a set next to the switch so the
 * capability check above can tell "not a file tool" (fall through to the editor
 * tools) apart from "a file tool that is switched off".
 */
const FILE_TOOL_DISPATCH = new Set([
  "list_files",
  "read_file",
  "write_file",
  "edit_file",
  "multi_edit",
  "rename_file",
  "delete_file",
  "create_folder",
  "search_files",
  "get_outline"
]);

/** Dispatch. Returns null for a name that is not a file tool. */
export async function executeFileTool(
  name: string,
  args: Record<string, unknown>
): Promise<FileToolResult | null> {
  if (!FILE_TOOL_DISPATCH.has(name)) {
    return null;
  }

  if (!capabilities.fileAccess) {
    return disabledResult("working on notes other than the open one");
  }

  if (name === "delete_file" && !capabilities.allowDelete) {
    return disabledResult("deleting notes");
  }

  switch (name) {
    case "list_files":
      return listFiles();
    case "read_file":
      return readFile(args);
    case "write_file":
      return writeFile(args);
    case "edit_file":
      return editFile(args);
    case "multi_edit":
      return multiEdit(args);
    case "rename_file":
      return renameFile(args);
    case "delete_file":
      return deleteFile(args);
    case "create_folder":
      return createFolder(args);
    case "search_files":
      return searchFiles(args);
    case "get_outline":
      return getOutline(args);
    default:
      return null;
  }
}
