// The editor-independent staging layer for the vault agent (v3).
//
// A proposal for the *open* document is a ProseMirror widget and lives in the
// editor (see src/lib/aiSuggestionWidget.ts). A file that is not open has no
// editor, so it has nowhere for a proposal to exist — which is why every change
// the agent proposes to another file lands here instead: one entry per file,
// describing the file's target state.
//
// State-based rather than an op log: a second tool call on the same file
// updates its entry instead of appending a second one. A model that proposes
// the same change twice (the failure mode blockedByOpenReview guards against in
// the single-document case) therefore cannot get in its own way.
//
// Pure logic on purpose — no store, no Tauri. The store half is
// src/store/useStagedChangesStore.ts, the persistence half
// src/lib/chat/stagedChangesFile.ts.

export type StagedChange = {
  // Vault-relative path BEFORE the change, "" for a newly created file.
  path: string;
  // Vault-relative path AFTER the change; equal to `path` when the file is not
  // renamed or moved. "" when the file is deleted.
  targetPath: string;
  // Content before the change; null = the file did not exist (new file).
  baseContent: string | null;
  // Content after the change; null = deleted.
  content: string | null;
  // Which chat turn proposed this — for checkpoint attribution and the chat's
  // own list of pending changes.
  sessionId: string;
  messageIndex: number;
  // Marker for the file that is currently open in the editor: its real
  // proposals are widgets in that editor, and this entry only exists so the
  // paw in the tree and "accept all" know about them. Never carries content;
  // accepting/discarding it delegates to the editor bridge.
  editorProposal?: boolean;
};

/** What a staged entry does, derived from the four fields above. */
export type StagedChangeKind = "create" | "edit" | "rename" | "rename-edit" | "delete" | "editor";

/** Thrown by assertVaultPath. Carries model-facing English, like a tool result. */
export class VaultPathError extends Error {}

/**
 * Windows paths are case-insensitive and the model writes both slash flavours,
 * so every comparison goes through this — same rule as fileVersions.ts.
 */
export function normalizeVaultPath(path: string): string {
  return path.replace(/\\/g, "/").replace(/^\.\//, "").replace(/^\/+/, "").replace(/\/+$/, "");
}

export function vaultPathKey(path: string): string {
  return normalizeVaultPath(path).toLowerCase();
}

// Directories the agent may never touch: `.scribedog/` is the vault's own
// metadata (versions, checkpoints, chat sessions — writing there corrupts the
// app's state), `images/` holds binaries the markdown tools cannot handle
// meaningfully and whose cleanup is driven by the documents referencing them.
const FORBIDDEN_ROOT_SEGMENTS = [".scribedog", "images"];

/**
 * The security boundary for every path argument. Path arguments come out of
 * model output, so `read_file` with a free path would read "any file this app
 * can reach" — this is what keeps it to markdown inside the opened vault.
 *
 * Answers with the normalized vault-relative path, or throws VaultPathError
 * with a message the tool hands straight back to the model.
 */
export function assertVaultPath(rawPath: unknown, { requireMarkdown = true } = {}): string {
  if (typeof rawPath !== "string" || !rawPath.trim()) {
    throw new VaultPathError("no path given. Pass a vault-relative path such as Notizen/Idee.md.");
  }

  const path = normalizeVaultPath(rawPath.trim());

  if (!path) {
    throw new VaultPathError("no path given. Pass a vault-relative path such as Notizen/Idee.md.");
  }

  // A Windows drive letter, a UNC prefix or a leading slash all mean the model
  // is naming a place outside the vault.
  if (/^[a-z]:/i.test(path) || rawPath.trim().startsWith("\\\\") || rawPath.trim().startsWith("/")) {
    throw new VaultPathError(
      `"${rawPath}" is an absolute path. Only paths relative to the vault root are allowed, e.g. Notizen/Idee.md.`
    );
  }

  const segments = path.split("/");

  if (segments.some((segment) => segment === ".." || segment === ".")) {
    throw new VaultPathError(
      `"${rawPath}" leaves the vault. Only paths relative to the vault root are allowed, without ".." segments.`
    );
  }

  if (segments.some((segment) => !segment)) {
    throw new VaultPathError(`"${rawPath}" is not a usable path.`);
  }

  if (FORBIDDEN_ROOT_SEGMENTS.includes(segments[0].toLowerCase())) {
    throw new VaultPathError(
      `"${rawPath}" is inside a folder that is off limits (${FORBIDDEN_ROOT_SEGMENTS.join(", ")}). ` +
        "Work on the user's notes instead."
    );
  }

  if (requireMarkdown && !/\.md$/i.test(path)) {
    throw new VaultPathError(
      `"${rawPath}" is not a Markdown file. Every file the agent works on ends in .md — add the extension.`
    );
  }

  return path;
}

/** What the entry does, for the UI and for the apply order. */
export function stagedChangeKind(change: StagedChange): StagedChangeKind {
  if (change.editorProposal) {
    return "editor";
  }

  if (!change.targetPath) {
    return "delete";
  }

  if (!change.path) {
    return "create";
  }

  const renamed = vaultPathKey(change.path) !== vaultPathKey(change.targetPath);
  const edited = change.content !== change.baseContent;

  if (renamed) {
    return edited ? "rename-edit" : "rename";
  }

  return "edit";
}

/**
 * The key an entry is addressed by. A new file has no `path`, so it is keyed by
 * its target — which is also what makes "at most one entry per file" hold for a
 * file the agent creates and then edits again.
 */
export function stagedChangeKey(change: StagedChange): string {
  return vaultPathKey(change.path || change.targetPath);
}

/**
 * Finds the entry that currently owns a path. Matches both sides, because a
 * staged rename means the file the model now calls "new.md" is the entry filed
 * under "old.md" — looking only at `path` would stage a second entry for what
 * is one file.
 */
export function findStagedChange(changes: StagedChange[], path: string): StagedChange | undefined {
  const key = vaultPathKey(path);

  return changes.find(
    (change) => vaultPathKey(change.path) === key || vaultPathKey(change.targetPath) === key
  );
}

/**
 * Folds a new proposal into the entry that already exists for that file.
 *
 * The existing entry owns the "before" (its original path and content), the new
 * one the "after" — which is the whole merge. It is what keeps a rename
 * followed by an edit one entry that renames *and* edits, instead of two that
 * contradict each other.
 */
export function mergeStagedChange(existing: StagedChange, next: StagedChange): StagedChange {
  return {
    path: existing.path,
    baseContent: existing.baseContent,
    targetPath: next.targetPath,
    content: next.content,
    sessionId: next.sessionId,
    messageIndex: next.messageIndex,
    ...(next.editorProposal ? { editorProposal: true as const } : {})
  };
}

/**
 * Puts `change` into the list, merging it into an existing entry for the same
 * file. A file the agent created and then deleted again disappears entirely —
 * there is nothing left to propose.
 */
export function upsertStagedChange(changes: StagedChange[], change: StagedChange): StagedChange[] {
  const existing = findStagedChange(changes, change.path || change.targetPath);

  if (!existing) {
    return [...changes, change];
  }

  const merged = mergeStagedChange(existing, change);

  if (!merged.path && !merged.targetPath) {
    return changes.filter((entry) => entry !== existing);
  }

  return changes.map((entry) => (entry === existing ? merged : entry));
}

export function removeStagedChange(changes: StagedChange[], path: string): StagedChange[] {
  const target = findStagedChange(changes, path);

  return target ? changes.filter((entry) => entry !== target) : changes;
}

/** One filesystem step of an apply run. */
export type ApplyOp =
  | { kind: "create"; path: string; content: string }
  | { kind: "write"; path: string; content: string }
  | { kind: "rename"; path: string; targetPath: string }
  | { kind: "delete"; path: string };

/**
 * The order a batch has to be applied in: contents first, then renames, then
 * deletions.
 *
 * An entry that both edits and renames writes under its OLD path and is moved
 * afterwards — that way moveFileVersionHistory carries the history along with
 * the file it belongs to, instead of the write landing on a path the history
 * knows nothing about.
 *
 * Deletions come last so a batch that renames A→B and deletes C cannot delete
 * something a rename still needs.
 */
export function resolveApplyOrder(changes: StagedChange[]): ApplyOp[] {
  const writes: ApplyOp[] = [];
  const renames: ApplyOp[] = [];
  const deletes: ApplyOp[] = [];

  for (const change of changes) {
    if (change.editorProposal) {
      continue;
    }

    const kind = stagedChangeKind(change);

    if (kind === "delete") {
      deletes.push({ kind: "delete", path: change.path });
      continue;
    }

    if (kind === "create") {
      writes.push({ kind: "create", path: change.targetPath, content: change.content ?? "" });
      continue;
    }

    if (change.content !== null && change.content !== change.baseContent) {
      writes.push({ kind: "write", path: change.path, content: change.content });
    }

    if (kind === "rename" || kind === "rename-edit") {
      renames.push({ kind: "rename", path: change.path, targetPath: change.targetPath });
    }
  }

  return [...writes, ...renames, ...deletes];
}

/** Every path a batch touches, before and after — what a checkpoint has to cover. */
export function affectedPaths(changes: StagedChange[]): string[] {
  const seen = new Set<string>();
  const paths: string[] = [];

  for (const change of changes) {
    if (change.editorProposal) {
      continue;
    }

    for (const path of [change.path, change.targetPath]) {
      const key = vaultPathKey(path);

      if (path && !seen.has(key)) {
        seen.add(key);
        paths.push(normalizeVaultPath(path));
      }
    }
  }

  return paths;
}

/** Defensive normalization for what comes back off disk (see stagedChangesFile.ts). */
export function normalizeStagedChange(raw: unknown): StagedChange | null {
  if (typeof raw !== "object" || raw === null) {
    return null;
  }

  const candidate = raw as Partial<StagedChange>;

  if (typeof candidate.path !== "string" || typeof candidate.targetPath !== "string") {
    return null;
  }

  const path = normalizeVaultPath(candidate.path);
  const targetPath = normalizeVaultPath(candidate.targetPath);

  if (!path && !targetPath) {
    return null;
  }

  const baseContent = typeof candidate.baseContent === "string" ? candidate.baseContent : null;
  const content = typeof candidate.content === "string" ? candidate.content : null;

  return {
    path,
    targetPath,
    baseContent,
    content,
    sessionId: typeof candidate.sessionId === "string" ? candidate.sessionId : "",
    messageIndex: typeof candidate.messageIndex === "number" ? candidate.messageIndex : -1,
    ...(candidate.editorProposal === true ? { editorProposal: true as const } : {})
  };
}
