// Preparing the vault for meaning search: passages go to the embedding service,
// the vectors that come back are stored per vault in .scribedog/rag-index.bin.
//
// The division of labour is the one from DOCS/wissensbasis-plan.md: Rust owns
// everything that touches files (splitting, storing, comparing), this module
// owns the orchestration and the network calls — the latter through
// aiClient.embedTexts, so the endpoint rules that protect the chat protect this
// too, rather than being reimplemented next to them.

import { invoke } from "@tauri-apps/api/core";

import { embedTexts, type EmbeddingSettings } from "@/lib/aiClient";
import { currentScope } from "@/lib/ragScope";
import { useAppStore } from "@/store/useAppStore";
import { currentEmbeddingSettings } from "@/store/useRagEmbeddingStore";

/**
 * Passages per request. Small enough that a local model on CPU answers within
 * the request timeout and that a cancel takes effect quickly, large enough that
 * a vault of a few hundred notes is not a few thousand round trips.
 */
const EMBEDDING_BATCH_SIZE = 16;

export type KnowledgeIndexStatus = {
  /** What produced the stored vectors, or null when nothing is stored. */
  provider: string | null;
  model: string | null;
  readyFiles: number;
  readyChunks: number;
  /** In-scope files that still need to be embedded. */
  pendingFiles: string[];
  /** Stored files the selection no longer covers; dropped on the next run. */
  obsoleteFiles: number;
  /** False when something is stored, but from a different model. */
  matchesSettings: boolean;
};

export type IndexBuildProgress = {
  done: number;
  total: number;
  /** Vault-relative path currently being prepared, for the status line. */
  file: string;
};

export type IndexBuildResult = {
  preparedFiles: number;
  cancelled: boolean;
};

type RustFileChunks = {
  path: string;
  mtimeMs: number;
  size: number;
  texts: string[];
};

/** The vault's root, whether or not the knowledge base is switched on. */
function vaultRoot(): string | null {
  return useAppStore.getState().folderPath;
}

/**
 * What is stored for the open vault, measured against the current selection and
 * the currently configured model. Null when no folder is open.
 */
export async function knowledgeIndexStatus(): Promise<KnowledgeIndexStatus | null> {
  const scope = currentScope({ requireEnabled: false });

  if (!scope) {
    const root = vaultRoot();

    if (!root) {
      return null;
    }

    // A vault whose selection covers nothing still has stored data to report
    // (and to offer for deletion).
    return invoke<KnowledgeIndexStatus>("rag_index_status", {
      request: { root, files: [], ...modelIdentity() }
    });
  }

  return invoke<KnowledgeIndexStatus>("rag_index_status", {
    request: { root: scope.root, files: scope.files, ...modelIdentity() }
  });
}

function modelIdentity(settings: EmbeddingSettings = currentEmbeddingSettings()): {
  provider: string;
  model: string;
} {
  return { provider: settings.provider, model: settings.model.trim() };
}

/** Forgets every stored vector of this vault. The notes stay untouched. */
export async function clearKnowledgeIndex(): Promise<void> {
  const root = vaultRoot();

  if (!root) {
    return;
  }

  await invoke("rag_clear_index", { request: { root } });
}

/**
 * Embeds everything the selection covers that is not stored yet, file by file.
 *
 * Incremental by construction: Rust reports which files are new or changed
 * (mtime + size), so a second run after editing one note re-embeds that one
 * note. Progress is per file rather than per passage — that is the unit the
 * user recognizes, and it is the unit at which a cancelled run keeps its work.
 */
export async function buildKnowledgeIndex(options: {
  signal?: AbortSignal;
  onProgress?: (progress: IndexBuildProgress) => void;
}): Promise<IndexBuildResult> {
  const scope = currentScope();

  if (!scope) {
    return { preparedFiles: 0, cancelled: false };
  }

  const settings = currentEmbeddingSettings();
  const identity = modelIdentity(settings);

  const status = await invoke<KnowledgeIndexStatus>("rag_index_status", {
    request: { root: scope.root, files: scope.files, ...identity }
  });

  const pending = status.pendingFiles;
  let prepared = 0;
  let cancelled = false;

  try {
    for (const [position, path] of pending.entries()) {
      if (options.signal?.aborted) {
        cancelled = true;
        break;
      }

      options.onProgress?.({ done: position, total: pending.length, file: path });

      const chunks = await invoke<RustFileChunks>("rag_file_chunks", {
        request: { root: scope.root, files: scope.files, path }
      });

      const vectors: number[][] = [];

      for (let start = 0; start < chunks.texts.length; start += EMBEDDING_BATCH_SIZE) {
        if (options.signal?.aborted) {
          cancelled = true;
          break;
        }

        vectors.push(
          ...(await embedTexts(settings, chunks.texts.slice(start, start + EMBEDDING_BATCH_SIZE), options.signal))
        );
      }

      if (cancelled) {
        break;
      }

      // Written per file, but flushed to disk only every so often (Rust
      // decides) — except on the last file, where waiting for an autosave that
      // will never come would throw the whole run away.
      await invoke("rag_store_file_vectors", {
        request: {
          root: scope.root,
          ...identity,
          path: chunks.path,
          mtimeMs: chunks.mtimeMs,
          size: chunks.size,
          vectors,
          flush: position === pending.length - 1
        }
      });

      prepared += 1;
    }
  } catch (error) {
    // A cancel aborts the request in flight, which surfaces here as a fetch
    // error. That is not a failure to report — the user pressed the button.
    if (!options.signal?.aborted) {
      throw error;
    }

    cancelled = true;
  }

  // Both on a finished and on a cancelled run: files that left the selection
  // must not keep their vectors, and whatever was prepared belongs on disk.
  await invoke("rag_prune_index", { request: { root: scope.root, files: scope.files } });

  options.onProgress?.({ done: prepared, total: pending.length, file: "" });

  return { preparedFiles: prepared, cancelled };
}

/**
 * The question as a vector, or null when meaning search cannot answer right now
 * (no connection configured, service unreachable, nothing prepared). Null is
 * not an error here: keyword search still answers, and a lookup that fails
 * because of a setting is worse for the user than a slightly weaker answer.
 */
export async function embedQuery(query: string, signal?: AbortSignal): Promise<number[] | null> {
  try {
    const [vector] = await embedTexts(currentEmbeddingSettings(), [query], signal);

    return vector ?? null;
  } catch {
    return null;
  }
}
