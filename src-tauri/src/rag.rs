//! Knowledge base ("Wissensbasis"): keyword search across the markdown files of
//! the opened vault, so the chat agent can look things up in the user's own
//! notes instead of only seeing the open document.
//!
//! Nothing here reaches the network. The frontend decides *which* files are in
//! scope (see src/lib/ragConfig.ts) and passes that list in with every call —
//! this module never walks the vault on its own, which makes the folder
//! selection the single place where inclusion is decided and keeps the two
//! implementations from drifting apart.
//!
//! Two search paths live here. Keyword search (BM25) needs nothing but the
//! files themselves. Meaning search compares the vectors of a passage against
//! the vector of the question — those vectors are produced by an embedding
//! service the frontend talks to (never this module: see the Rust/TypeScript
//! split in DOCS/wissensbasis-plan.md) and stored in one flat file per vault.

use std::{
    collections::HashMap,
    path::{Path, PathBuf},
    sync::Mutex,
    time::UNIX_EPOCH,
};

use serde::{Deserialize, Serialize};

/// Longest a single passage may get before it is split further. Long enough to
/// keep an argument together, short enough that a hit points the user at a
/// place rather than at a whole chapter — and small enough to survive the
/// embedding input limits stage 2 will run into.
const MAX_CHUNK_CHARS: usize = 1_500;

/// BM25 parameters. The literature's defaults; nothing about markdown notes
/// suggests tuning them, and an unexplained magic number would be worse.
const BM25_K1: f32 = 1.2;
const BM25_B: f32 = 0.75;

/// Smallest preview a single hit gets, however many hits share the budget.
const SNIPPET_CHARS: usize = 400;

/// How much passage text one search may hand back in total, split evenly across
/// the hits it actually returns. A search that finds one short note should
/// return that note *whole* rather than a 400-character teaser: the follow-up
/// read_note call is the step weak models skip, and they then answer from the
/// preview as if it were the full text. With the budget divided by the hit
/// count, anything up to four hits comes back as complete passages
/// (MAX_CHUNK_CHARS each) and only a wide search degrades to previews.
const SNIPPET_BUDGET_CHARS: usize = 4_000;

#[derive(Clone, Serialize)]
pub struct SearchHit {
    /// Vault-relative, slash separated.
    pub path: String,
    /// Heading trail of the passage, e.g. "Projekte > Kunde A > Entscheidungen".
    /// Empty for text above the first heading.
    pub heading_path: String,
    pub snippet: String,
    /// Whether the snippet is a cut-down preview of a longer passage. The
    /// frontend says so in words in the tool result — an "…" alone reads to a
    /// model like an ellipsis in the note itself, not like a truncation.
    pub truncated: bool,
    pub score: f32,
}

#[derive(Clone)]
struct Chunk {
    heading_path: String,
    text: String,
    /// Token counts of this passage, for scoring without re-tokenizing.
    term_frequencies: HashMap<String, usize>,
    token_count: usize,
}

#[derive(Clone)]
struct CachedFile {
    mtime_ms: u64,
    size: u64,
    chunks: Vec<Chunk>,
}

/// Parsed files, keyed by absolute path. Re-reading and re-splitting the whole
/// vault on every single search would be wasteful: one agent turn issues
/// several searches, and the vault rarely changes between them. Entries are
/// validated against mtime+size on each use, so an edit outside the app is
/// picked up without any invalidation plumbing.
#[derive(Default)]
pub struct RagState {
    files: Mutex<HashMap<PathBuf, CachedFile>>,
    /// The vectors of the vault currently open, mirrored from
    /// .scribedog/rag-index.bin (see VectorIndex).
    index: Mutex<VectorIndex>,
}

/// Splits text into lowercased alphanumeric runs.
///
/// Unicode-aware on purpose: the vault is as likely to be German or Portuguese
/// as English, and an ASCII-only tokenizer would cut "Präzision" in two and
/// then fail to match it against itself.
fn tokenize(text: &str) -> Vec<String> {
    let mut tokens = Vec::new();
    let mut current = String::new();

    for character in text.chars() {
        if character.is_alphanumeric() {
            current.extend(character.to_lowercase());
        } else if !current.is_empty() {
            tokens.push(std::mem::take(&mut current));
        }
    }

    if !current.is_empty() {
        tokens.push(current);
    }

    tokens
}

fn term_frequencies(text: &str) -> (HashMap<String, usize>, usize) {
    let tokens = tokenize(text);
    let mut frequencies: HashMap<String, usize> = HashMap::new();

    for token in &tokens {
        *frequencies.entry(token.clone()).or_insert(0) += 1;
    }

    (frequencies, tokens.len())
}

/// The heading trail at the current position, joined for display.
fn heading_path(stack: &[(usize, String)]) -> String {
    stack
        .iter()
        .map(|(_, title)| title.as_str())
        .collect::<Vec<_>>()
        .join(" > ")
}

/// Splits an over-long passage on paragraph boundaries, falling back to a hard
/// cut only when a single paragraph exceeds the limit on its own.
fn split_long_text(text: &str) -> Vec<String> {
    if text.chars().count() <= MAX_CHUNK_CHARS {
        return vec![text.to_string()];
    }

    let mut parts = Vec::new();
    let mut current = String::new();

    for paragraph in text.split("\n\n") {
        if !current.is_empty() && current.chars().count() + paragraph.chars().count() > MAX_CHUNK_CHARS {
            parts.push(std::mem::take(&mut current));
        }

        if paragraph.chars().count() > MAX_CHUNK_CHARS {
            // One paragraph longer than the whole budget — cut it on char
            // boundaries so no multi-byte character is torn apart.
            let characters: Vec<char> = paragraph.chars().collect();

            for window in characters.chunks(MAX_CHUNK_CHARS) {
                if !current.is_empty() {
                    parts.push(std::mem::take(&mut current));
                }

                parts.push(window.iter().collect());
            }

            continue;
        }

        if !current.is_empty() {
            current.push_str("\n\n");
        }

        current.push_str(paragraph);
    }

    if !current.trim().is_empty() {
        parts.push(current);
    }

    parts
}

/// Cuts a markdown document into passages at its headings, carrying the heading
/// trail into each passage.
///
/// Fenced code blocks are tracked so a `#` comment inside one — very common in
/// shell and Python samples — does not masquerade as a heading and shred the
/// document into nonsense passages.
fn split_markdown(markdown: &str) -> Vec<Chunk> {
    let mut chunks: Vec<Chunk> = Vec::new();
    let mut stack: Vec<(usize, String)> = Vec::new();
    let mut body = String::new();
    let mut current_heading = String::new();
    let mut fence: Option<String> = None;

    let flush = |heading: &str, body: &mut String, chunks: &mut Vec<Chunk>| {
        let trimmed = body.trim();

        if trimmed.is_empty() {
            body.clear();
            return;
        }

        for part in split_long_text(trimmed) {
            // The heading trail is prepended to the searchable text, not just
            // carried alongside it: a passage under "Kunde A > Liefertermin"
            // should match a search for "Liefertermin" even when the body never
            // repeats the word.
            let searchable = if heading.is_empty() {
                part.clone()
            } else {
                format!("{heading}\n{part}")
            };

            let (frequencies, token_count) = term_frequencies(&searchable);

            chunks.push(Chunk {
                heading_path: heading.to_string(),
                text: part,
                term_frequencies: frequencies,
                token_count,
            });
        }

        body.clear();
    };

    for line in markdown.lines() {
        let trimmed = line.trim_start();

        // Fence open/close. The marker has to be at least three of the same
        // character, and a fence only closes on its own kind.
        if trimmed.starts_with("```") || trimmed.starts_with("~~~") {
            let marker = if trimmed.starts_with("```") { "```" } else { "~~~" };

            match &fence {
                Some(open) if open == marker => fence = None,
                Some(_) => {}
                None => fence = Some(marker.to_string()),
            }

            body.push_str(line);
            body.push('\n');
            continue;
        }

        let heading_level = if fence.is_none() {
            let hashes = trimmed.chars().take_while(|character| *character == '#').count();

            if (1..=6).contains(&hashes) && trimmed.chars().nth(hashes) == Some(' ') {
                Some(hashes)
            } else {
                None
            }
        } else {
            None
        };

        if let Some(level) = heading_level {
            flush(&current_heading, &mut body, &mut chunks);

            let title = trimmed[level..].trim().to_string();
            stack.retain(|(existing_level, _)| *existing_level < level);
            stack.push((level, title));
            current_heading = heading_path(&stack);
            continue;
        }

        body.push_str(line);
        body.push('\n');
    }

    flush(&current_heading, &mut body, &mut chunks);

    chunks
}

fn normalize_relative_path(path: &str) -> String {
    path.replace('\\', "/")
}

/// Whether a path from the frontend is a plain vault-relative path.
///
/// The caller is the app's own frontend, which builds this list from the
/// vault's file list — but the list is the only thing standing between this
/// module and the rest of the disk, so it is checked rather than trusted. A
/// traversal segment or an absolute path is rejected outright instead of being
/// joined onto the root.
fn is_safe_relative_path(path: &str) -> bool {
    let normalized = normalize_relative_path(path);

    if normalized.is_empty() || normalized.starts_with('/') {
        return false;
    }

    // A Windows drive letter or UNC prefix would make the join absolute too.
    if Path::new(&normalized).is_absolute() || normalized.contains(':') {
        return false;
    }

    !normalized.split('/').any(|segment| segment == "..")
}

/// Resolves a vault-relative path against the vault root, but only if the
/// frontend listed it as in scope.
///
/// This allowlist is the security boundary, not a convenience. A path argument
/// on read_note originates from model output, so accepting an arbitrary one
/// would turn the tool into "read any file this app can reach" — the same
/// reasoning as get_image's allowlist in src/lib/chat/agentTools.ts.
fn resolve_allowed_path(root: &str, requested: &str, allowed: &[String]) -> Option<PathBuf> {
    let normalized = normalize_relative_path(requested);
    let normalized = normalized.trim_start_matches('/');

    let matched = allowed
        .iter()
        .filter(|candidate| is_safe_relative_path(candidate))
        .find(|candidate| normalize_relative_path(candidate).eq_ignore_ascii_case(normalized))
        // Models like to drop or add a leading folder; accept a unique suffix
        // match rather than bouncing a call that named a real file.
        .or_else(|| {
            let suffix_matches: Vec<&String> = allowed
                .iter()
                .filter(|candidate| is_safe_relative_path(candidate))
                .filter(|candidate| {
                    let candidate = normalize_relative_path(candidate).to_lowercase();
                    let requested = normalized.to_lowercase();
                    candidate.ends_with(&format!("/{requested}")) || requested.ends_with(&format!("/{candidate}"))
                })
                .collect();

            if suffix_matches.len() == 1 {
                Some(suffix_matches[0])
            } else {
                None
            }
        })?;

    let resolved = Path::new(root).join(normalize_relative_path(matched));

    // The allowlist already constrains this, but a relative path containing
    // ".." would still escape the root when joined. Checking the resolved
    // result costs nothing and closes that off for good.
    let canonical_root = std::fs::canonicalize(root).ok()?;
    let canonical_file = std::fs::canonicalize(&resolved).ok()?;

    canonical_file.starts_with(&canonical_root).then_some(resolved)
}

fn file_signature(path: &Path) -> Option<(u64, u64)> {
    let metadata = std::fs::metadata(path).ok()?;
    let mtime_ms = metadata
        .modified()
        .ok()
        .and_then(|time| time.duration_since(UNIX_EPOCH).ok())
        .map(|duration| duration.as_millis() as u64)
        .unwrap_or(0);

    Some((mtime_ms, metadata.len()))
}

/// Returns the passages of one file, reading and splitting it only when the
/// cached copy is stale.
fn chunks_for_file(state: &RagState, path: &Path) -> Vec<Chunk> {
    let Some((mtime_ms, size)) = file_signature(path) else {
        return Vec::new();
    };

    if let Ok(cache) = state.files.lock() {
        if let Some(cached) = cache.get(path) {
            if cached.mtime_ms == mtime_ms && cached.size == size {
                return cached.chunks.clone();
            }
        }
    }

    let Ok(markdown) = std::fs::read_to_string(path) else {
        return Vec::new();
    };

    let chunks = split_markdown(&markdown);

    if let Ok(mut cache) = state.files.lock() {
        cache.insert(
            path.to_path_buf(),
            CachedFile {
                mtime_ms,
                size,
                chunks: chunks.clone(),
            },
        );
    }

    chunks
}

fn build_snippet(chunk: &Chunk, query_tokens: &[String], budget: usize) -> String {
    let characters: Vec<char> = chunk.text.chars().collect();

    if characters.len() <= budget {
        return chunk.text.clone();
    }

    // Start the preview at the first query term rather than at the top of the
    // passage — in a long passage the opening lines usually say nothing about
    // why it matched.
    let lowercase = chunk.text.to_lowercase();
    let first_match = query_tokens
        .iter()
        .filter_map(|token| lowercase.find(token.as_str()))
        .min()
        .unwrap_or(0);

    // find() gives a byte offset; convert it to a char offset before slicing.
    let match_char_index = lowercase[..first_match].chars().count();
    let start = match_char_index.saturating_sub(80).min(characters.len().saturating_sub(budget));
    let end = (start + budget).min(characters.len());

    let mut snippet = String::new();

    if start > 0 {
        snippet.push('…');
    }

    snippet.extend(characters[start..end].iter());

    if end < characters.len() {
        snippet.push('…');
    }

    snippet
}

#[derive(Deserialize)]
pub struct SearchRequest {
    /// Absolute path of the opened vault.
    pub root: String,
    /// Vault-relative paths of every file the folder selection includes.
    pub files: Vec<String>,
    pub query: String,
    pub limit: usize,
}

/// BM25 across the passages of the in-scope files.
#[tauri::command]
pub fn rag_search_text(state: tauri::State<'_, RagState>, request: SearchRequest) -> Vec<SearchHit> {
    let query_tokens = tokenize(&request.query);

    if query_tokens.is_empty() || request.files.is_empty() {
        return Vec::new();
    }

    // Gather the corpus first: BM25 needs document frequencies and the average
    // length before it can score anything.
    let mut corpus: Vec<(String, Chunk)> = Vec::new();

    for relative_path in &request.files {
        if !is_safe_relative_path(relative_path) {
            continue;
        }

        let path = Path::new(&request.root).join(normalize_relative_path(relative_path));

        for chunk in chunks_for_file(&state, &path) {
            corpus.push((normalize_relative_path(relative_path), chunk));
        }
    }

    if corpus.is_empty() {
        return Vec::new();
    }

    let total_chunks = corpus.len() as f32;
    let average_length =
        corpus.iter().map(|(_, chunk)| chunk.token_count).sum::<usize>() as f32 / total_chunks;

    let mut document_frequencies: HashMap<&str, usize> = HashMap::new();

    for token in &query_tokens {
        let count = corpus
            .iter()
            .filter(|(_, chunk)| chunk.term_frequencies.contains_key(token))
            .count();
        document_frequencies.insert(token.as_str(), count);
    }

    // Score first, cut to the limit, and only then build the previews: how much
    // text each hit may carry depends on how many hits survive the cut.
    let mut scored: Vec<(f32, &String, &Chunk)> = corpus
        .iter()
        .filter_map(|(path, chunk)| {
            let mut score = 0.0_f32;

            for token in &query_tokens {
                let Some(frequency) = chunk.term_frequencies.get(token) else {
                    continue;
                };

                let document_frequency = *document_frequencies.get(token.as_str()).unwrap_or(&0) as f32;
                // Standard BM25 IDF with the +1 that keeps a term appearing in
                // every passage from going negative.
                let idf = (((total_chunks - document_frequency + 0.5) / (document_frequency + 0.5)) + 1.0).ln();

                let frequency = *frequency as f32;
                let length_norm =
                    BM25_K1 * (1.0 - BM25_B + BM25_B * (chunk.token_count as f32 / average_length));

                score += idf * (frequency * (BM25_K1 + 1.0)) / (frequency + length_norm);
            }

            (score > 0.0).then_some((score, path, chunk))
        })
        .collect();

    scored.sort_by(|a, b| b.0.partial_cmp(&a.0).unwrap_or(std::cmp::Ordering::Equal));
    scored.truncate(request.limit.clamp(1, 20));

    let budget = (SNIPPET_BUDGET_CHARS / scored.len().max(1)).max(SNIPPET_CHARS);

    scored
        .into_iter()
        .map(|(score, path, chunk)| SearchHit {
            path: path.clone(),
            heading_path: chunk.heading_path.clone(),
            snippet: build_snippet(chunk, &query_tokens, budget),
            truncated: chunk.text.chars().count() > budget,
            score,
        })
        .collect()
}

#[derive(Deserialize)]
pub struct ReadRequest {
    pub root: String,
    pub files: Vec<String>,
    pub path: String,
    /// Heading trail of one passage, as returned by rag_search_text. Empty
    /// returns the whole file.
    #[serde(default)]
    pub section: String,
}

/// Reads one in-scope file, or just the passage under a given heading trail.
#[tauri::command]
pub fn rag_read_note(request: ReadRequest) -> Result<String, String> {
    let Some(path) = resolve_allowed_path(&request.root, &request.path, &request.files) else {
        return Err("not-allowed".to_string());
    };

    let markdown = std::fs::read_to_string(&path).map_err(|error| error.to_string())?;

    if request.section.trim().is_empty() {
        return Ok(markdown);
    }

    let wanted = request.section.trim();

    let section = split_markdown(&markdown)
        .into_iter()
        .filter(|chunk| chunk.heading_path == wanted)
        .map(|chunk| chunk.text)
        .collect::<Vec<_>>()
        .join("\n\n");

    // A heading the model half-remembered is not worth an error: the whole
    // file still answers the question it was about to ask.
    Ok(if section.is_empty() { markdown } else { section })
}

/// Drops the parsed-file cache. Called when the vault is closed or the folder
/// selection changes, so a file that just left the scope cannot linger in
/// memory.
#[tauri::command]
pub fn rag_clear_cache(state: tauri::State<'_, RagState>) {
    if let Ok(mut cache) = state.files.lock() {
        cache.clear();
    }
}

// ---------------------------------------------------------------------------
// Meaning search: stored vectors and cosine similarity
// ---------------------------------------------------------------------------

/// Metadata folder of a vault, mirroring VAULT_META_DIR_NAME in
/// src/lib/fileSystem.ts.
const VAULT_META_DIR: &str = ".scribedog";

/// The stored vectors of one vault. Flat file rather than a vector database:
/// a large vault is a few thousand passages, and brute-force cosine over that
/// takes about a millisecond — see DOCS/wissensbasis-plan.md.
const INDEX_FILE_NAME: &str = "rag-index.bin";
const INDEX_MAGIC: &[u8] = b"SDRAGIX1";

/// Bumped when the layout below changes. A file written by another version is
/// discarded rather than guessed at.
const INDEX_FORMAT_VERSION: u32 = 1;

/// Sanity bounds for a file that may have been truncated or corrupted. No
/// embedding model has more dimensions than this, and no vault has more
/// passages in one file.
const MAX_DIMENSIONS: usize = 8_192;
const MAX_CHUNKS_PER_FILE: usize = 100_000;

/// How many files may be stored before the index is written back to disk on
/// its own. A full rebuild would otherwise rewrite the whole file once per
/// note, which for a large vault is hundreds of megabytes of pointless writes;
/// leaving it entirely to an explicit flush would lose the work of a crash.
const AUTOSAVE_EVERY_FILES: usize = 25;

/// Which model produced the stored vectors.
///
/// Vectors from two different models are not comparable at all, so this is not
/// informational: on a mismatch everything stored is worthless and gets
/// rebuilt (with the user's consent — the frontend asks first, see
/// RagRebuildDialog). There is deliberately no silent fallback.
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
pub struct IndexHeader {
    pub provider: String,
    pub model: String,
    pub dimensions: u32,
    pub version: u32,
}

#[derive(Clone)]
struct IndexedFile {
    /// Signature the file had when it was embedded. A passage whose file has
    /// changed since is skipped: its vector describes text that is no longer
    /// there, and answering from it would be worse than not answering.
    mtime_ms: u64,
    size: u64,
    /// One vector per passage, in the order split_markdown produces them.
    vectors: Vec<Vec<f32>>,
    /// Precomputed lengths, so a search is one dot product per passage.
    norms: Vec<f32>,
}

impl IndexedFile {
    fn new(mtime_ms: u64, size: u64, vectors: Vec<Vec<f32>>) -> Self {
        let norms = vectors.iter().map(|vector| vector_norm(vector)).collect();

        Self {
            mtime_ms,
            size,
            vectors,
            norms,
        }
    }
}

/// The in-memory copy of one vault's stored vectors.
///
/// Held per vault: opening another folder replaces it wholesale, so vectors of
/// the vault the user just closed can never answer a search in the new one.
#[derive(Default)]
struct VectorIndex {
    /// Vault this belongs to. Empty means nothing is loaded yet.
    root: String,
    header: Option<IndexHeader>,
    /// Vault-relative path -> its passages' vectors.
    files: HashMap<String, IndexedFile>,
    /// Changes not yet written to disk.
    unsaved: usize,
}

fn vector_norm(vector: &[f32]) -> f32 {
    vector.iter().map(|value| value * value).sum::<f32>().sqrt()
}

fn cosine_similarity(a: &[f32], a_norm: f32, b: &[f32], b_norm: f32) -> f32 {
    if a.len() != b.len() || a_norm == 0.0 || b_norm == 0.0 {
        return 0.0;
    }

    let dot: f32 = a.iter().zip(b.iter()).map(|(x, y)| x * y).sum();

    dot / (a_norm * b_norm)
}

fn index_file_path(root: &str) -> PathBuf {
    Path::new(root).join(VAULT_META_DIR).join(INDEX_FILE_NAME)
}

fn push_u32(buffer: &mut Vec<u8>, value: u32) {
    buffer.extend_from_slice(&value.to_le_bytes());
}

fn push_u64(buffer: &mut Vec<u8>, value: u64) {
    buffer.extend_from_slice(&value.to_le_bytes());
}

fn push_string(buffer: &mut Vec<u8>, value: &str) {
    push_u32(buffer, value.len() as u32);
    buffer.extend_from_slice(value.as_bytes());
}

/// Reads the flat layout back, refusing anything that does not add up rather
/// than trusting lengths from a file that may have been truncated.
struct ByteReader<'a> {
    data: &'a [u8],
    offset: usize,
}

impl<'a> ByteReader<'a> {
    fn new(data: &'a [u8]) -> Self {
        Self { data, offset: 0 }
    }

    fn take(&mut self, count: usize) -> Option<&'a [u8]> {
        let end = self.offset.checked_add(count)?;
        let slice = self.data.get(self.offset..end)?;
        self.offset = end;

        Some(slice)
    }

    fn u32(&mut self) -> Option<u32> {
        Some(u32::from_le_bytes(self.take(4)?.try_into().ok()?))
    }

    fn u64(&mut self) -> Option<u64> {
        Some(u64::from_le_bytes(self.take(8)?.try_into().ok()?))
    }

    fn string(&mut self) -> Option<String> {
        let length = self.u32()? as usize;

        String::from_utf8(self.take(length)?.to_vec()).ok()
    }

    fn vector(&mut self, dimensions: usize) -> Option<Vec<f32>> {
        let bytes = self.take(dimensions.checked_mul(4)?)?;

        Some(
            bytes
                .chunks_exact(4)
                .map(|chunk| f32::from_le_bytes([chunk[0], chunk[1], chunk[2], chunk[3]]))
                .collect(),
        )
    }
}

fn serialize_index(index: &VectorIndex) -> Option<Vec<u8>> {
    let header = index.header.as_ref()?;
    let header_json = serde_json::to_string(header).ok()?;

    let mut buffer = Vec::new();
    buffer.extend_from_slice(INDEX_MAGIC);
    push_string(&mut buffer, &header_json);
    push_u32(&mut buffer, index.files.len() as u32);

    for (path, file) in &index.files {
        push_string(&mut buffer, path);
        push_u64(&mut buffer, file.mtime_ms);
        push_u64(&mut buffer, file.size);
        push_u32(&mut buffer, file.vectors.len() as u32);

        for vector in &file.vectors {
            for value in vector {
                buffer.extend_from_slice(&value.to_le_bytes());
            }
        }
    }

    Some(buffer)
}

fn deserialize_index(root: &str, data: &[u8]) -> Option<VectorIndex> {
    let mut reader = ByteReader::new(data);

    if reader.take(INDEX_MAGIC.len())? != INDEX_MAGIC {
        return None;
    }

    let header: IndexHeader = serde_json::from_str(&reader.string()?).ok()?;

    if header.version != INDEX_FORMAT_VERSION {
        return None;
    }

    let dimensions = header.dimensions as usize;

    if dimensions == 0 || dimensions > MAX_DIMENSIONS {
        return None;
    }

    let file_count = reader.u32()? as usize;
    let mut files = HashMap::with_capacity(file_count);

    for _ in 0..file_count {
        let path = reader.string()?;
        let mtime_ms = reader.u64()?;
        let size = reader.u64()?;
        let chunk_count = reader.u32()? as usize;

        if chunk_count > MAX_CHUNKS_PER_FILE {
            return None;
        }

        let mut vectors = Vec::with_capacity(chunk_count);

        for _ in 0..chunk_count {
            vectors.push(reader.vector(dimensions)?);
        }

        files.insert(path, IndexedFile::new(mtime_ms, size, vectors));
    }

    Some(VectorIndex {
        root: root.to_string(),
        header: Some(header),
        files,
        unsaved: 0,
    })
}

fn write_index(index: &mut VectorIndex) -> Result<(), String> {
    let Some(buffer) = serialize_index(index) else {
        return Ok(());
    };

    let path = index_file_path(&index.root);

    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|error| error.to_string())?;
    }

    std::fs::write(&path, buffer).map_err(|error| error.to_string())?;
    index.unsaved = 0;

    Ok(())
}

/// Runs `action` against the vectors of `root`, loading them from disk first if
/// this is a different vault than the one currently held (or the first access).
///
/// A file that cannot be read or does not parse yields an empty index, not an
/// error: the answer to "nothing usable is stored" is the same as to "nothing
/// is stored", and the frontend's status call reports it as work to be done.
fn with_index<T>(state: &RagState, root: &str, action: impl FnOnce(&mut VectorIndex) -> T) -> T {
    let mut index = match state.index.lock() {
        Ok(index) => index,
        Err(poisoned) => poisoned.into_inner(),
    };

    if index.root != root {
        *index = std::fs::read(index_file_path(root))
            .ok()
            .and_then(|data| deserialize_index(root, &data))
            .unwrap_or_else(|| VectorIndex {
                root: root.to_string(),
                ..VectorIndex::default()
            });
    }

    action(&mut index)
}

/// Whether the stored vectors were made by the model that is configured now.
fn header_matches(header: Option<&IndexHeader>, provider: &str, model: &str) -> bool {
    header.is_some_and(|header| header.provider == provider && header.model == model)
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct IndexScopeRequest {
    pub root: String,
    /// Vault-relative paths of every file the folder selection includes.
    pub files: Vec<String>,
    pub provider: String,
    pub model: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct IndexStatus {
    pub provider: Option<String>,
    pub model: Option<String>,
    /// Files with usable, up-to-date vectors.
    pub ready_files: usize,
    pub ready_chunks: usize,
    /// In-scope files that still need to be embedded — new, changed, or all of
    /// them when the stored vectors are from a different model.
    pub pending_files: Vec<String>,
    /// Stored files the selection no longer covers. They are dropped on the
    /// next prune; counted here so the tab can say the stored data is stale.
    pub obsolete_files: usize,
    /// False when something is stored but from another model, which is what
    /// triggers the rebuild prompt.
    pub matches_settings: bool,
}

/// What is stored for this vault, and what is missing for the current scope.
#[tauri::command]
pub fn rag_index_status(state: tauri::State<'_, RagState>, request: IndexScopeRequest) -> IndexStatus {
    with_index(&state, &request.root, |index| {
        let matches = header_matches(index.header.as_ref(), &request.provider, &request.model);

        let mut ready_files = 0;
        let mut ready_chunks = 0;
        let mut pending_files = Vec::new();

        for relative_path in &request.files {
            if !is_safe_relative_path(relative_path) {
                continue;
            }

            let normalized = normalize_relative_path(relative_path);
            let path = Path::new(&request.root).join(&normalized);
            let signature = file_signature(&path);

            let stored = if matches { index.files.get(&normalized) } else { None };

            match (stored, signature) {
                (Some(stored), Some((mtime_ms, size)))
                    if stored.mtime_ms == mtime_ms && stored.size == size =>
                {
                    ready_files += 1;
                    ready_chunks += stored.vectors.len();
                }
                _ => pending_files.push(normalized),
            }
        }

        let in_scope: std::collections::HashSet<String> = request
            .files
            .iter()
            .map(|path| normalize_relative_path(path))
            .collect();

        IndexStatus {
            provider: index.header.as_ref().map(|header| header.provider.clone()),
            model: index.header.as_ref().map(|header| header.model.clone()),
            ready_files,
            ready_chunks,
            pending_files,
            obsolete_files: index
                .files
                .keys()
                .filter(|path| !in_scope.contains(*path))
                .count(),
            matches_settings: matches || index.header.is_none(),
        }
    })
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FileChunksRequest {
    pub root: String,
    pub files: Vec<String>,
    pub path: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FileChunks {
    pub path: String,
    pub mtime_ms: u64,
    pub size: u64,
    /// The passages as they go to the embedding service, heading trail and all.
    pub texts: Vec<String>,
}

/// The passages of one in-scope file, ready to be embedded.
///
/// The heading trail is prepended exactly as it is for keyword search: a
/// passage under "Kunde A > Liefertermin" is about the delivery date even when
/// its own sentences never say so, and the vector has no other way to learn it.
#[tauri::command]
pub fn rag_file_chunks(
    state: tauri::State<'_, RagState>,
    request: FileChunksRequest,
) -> Result<FileChunks, String> {
    let Some(path) = resolve_allowed_path(&request.root, &request.path, &request.files) else {
        return Err("not-allowed".to_string());
    };

    let Some((mtime_ms, size)) = file_signature(&path) else {
        return Err("unreadable".to_string());
    };

    let texts = chunks_for_file(&state, &path)
        .into_iter()
        .map(|chunk| {
            if chunk.heading_path.is_empty() {
                chunk.text
            } else {
                format!("{}\n{}", chunk.heading_path, chunk.text)
            }
        })
        .collect();

    Ok(FileChunks {
        path: normalize_relative_path(&request.path),
        mtime_ms,
        size,
        texts,
    })
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StoreVectorsRequest {
    pub root: String,
    pub provider: String,
    pub model: String,
    pub path: String,
    pub mtime_ms: u64,
    pub size: u64,
    pub vectors: Vec<Vec<f32>>,
    /// Write to disk now, rather than waiting for the autosave. The frontend
    /// sets this on the last file of a run and when the user cancels.
    #[serde(default)]
    pub flush: bool,
}

/// Stores one file's vectors.
///
/// If the request names a different model than what is stored, everything
/// stored is dropped here rather than mixed: comparing vectors from two models
/// produces confident nonsense. The user has already been asked at this point —
/// this is the last line of defence, not the prompt.
#[tauri::command]
pub fn rag_store_file_vectors(
    state: tauri::State<'_, RagState>,
    request: StoreVectorsRequest,
) -> Result<(), String> {
    if !is_safe_relative_path(&request.path) {
        return Err("not-allowed".to_string());
    }

    let dimensions = request.vectors.first().map(|vector| vector.len()).unwrap_or(0);

    if dimensions > MAX_DIMENSIONS
        || request
            .vectors
            .iter()
            .any(|vector| vector.len() != dimensions)
    {
        return Err("inconsistent-dimensions".to_string());
    }

    with_index(&state, &request.root, |index| {
        if !header_matches(index.header.as_ref(), &request.provider, &request.model) {
            index.files.clear();
            index.header = None;
        }

        // A file that split into nothing (empty note) carries no vectors and
        // must not decide the index's dimensions.
        if index.header.is_none() && dimensions > 0 {
            index.header = Some(IndexHeader {
                provider: request.provider.clone(),
                model: request.model.clone(),
                dimensions: dimensions as u32,
                version: INDEX_FORMAT_VERSION,
            });
        }

        if let Some(header) = index.header.as_ref() {
            if dimensions > 0 && header.dimensions as usize != dimensions {
                return Err("inconsistent-dimensions".to_string());
            }
        }

        index.files.insert(
            normalize_relative_path(&request.path),
            IndexedFile::new(request.mtime_ms, request.size, request.vectors),
        );
        index.unsaved += 1;

        if request.flush || index.unsaved >= AUTOSAVE_EVERY_FILES {
            write_index(index)?;
        }

        Ok(())
    })
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PruneRequest {
    pub root: String,
    pub files: Vec<String>,
}

/// Drops the vectors of files the selection no longer covers — a note the user
/// deleted, or a folder they just unticked. Nothing about that folder may
/// survive in the stored data, which is what the settings tab promises.
#[tauri::command]
pub fn rag_prune_index(
    state: tauri::State<'_, RagState>,
    request: PruneRequest,
) -> Result<(), String> {
    with_index(&state, &request.root, |index| {
        let in_scope: std::collections::HashSet<String> = request
            .files
            .iter()
            .map(|path| normalize_relative_path(path))
            .collect();

        let before = index.files.len();
        index.files.retain(|path, _| in_scope.contains(path));

        if index.files.len() != before || index.unsaved > 0 {
            write_index(index)?;
        }

        Ok(())
    })
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RootRequest {
    pub root: String,
}

/// Forgets everything stored for this vault, in memory and on disk. The notes
/// themselves are never touched — see the "how do I get rid of this" section of
/// the explainer dialog.
#[tauri::command]
pub fn rag_clear_index(state: tauri::State<'_, RagState>, request: RootRequest) -> Result<(), String> {
    with_index(&state, &request.root, |index| {
        index.files.clear();
        index.header = None;
        index.unsaved = 0;
    });

    match std::fs::remove_file(index_file_path(&request.root)) {
        Ok(()) => Ok(()),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(error) => Err(error.to_string()),
    }
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct VectorSearchRequest {
    pub root: String,
    pub files: Vec<String>,
    pub provider: String,
    pub model: String,
    /// The question, already embedded by the frontend.
    pub vector: Vec<f32>,
    pub limit: usize,
}

/// Brute-force cosine over the stored vectors of the in-scope files.
///
/// Returns nothing at all when the stored vectors are from another model:
/// those distances are meaningless, and a plausible-looking wrong passage is
/// worse here than no passage — keyword search still answers in that case.
#[tauri::command]
pub fn rag_search_vectors(
    state: tauri::State<'_, RagState>,
    request: VectorSearchRequest,
) -> Vec<SearchHit> {
    let query_norm = vector_norm(&request.vector);

    if request.vector.is_empty() || query_norm == 0.0 {
        return Vec::new();
    }

    // Scoring only needs the index; building the snippets afterwards needs the
    // files. Collecting the winners first keeps the index lock short and reads
    // at most `limit` files instead of all of them.
    let scored = with_index(&state, &request.root, |index| {
        if !header_matches(index.header.as_ref(), &request.provider, &request.model) {
            return Vec::new();
        }

        let mut scored: Vec<(f32, String, usize)> = Vec::new();

        for relative_path in &request.files {
            if !is_safe_relative_path(relative_path) {
                continue;
            }

            let normalized = normalize_relative_path(relative_path);

            let Some(stored) = index.files.get(&normalized) else {
                continue;
            };

            // A note edited since it was embedded describes text that no longer
            // exists. Keyword search covers it until the next rebuild.
            let path = Path::new(&request.root).join(&normalized);

            match file_signature(&path) {
                Some((mtime_ms, size)) if mtime_ms == stored.mtime_ms && size == stored.size => {}
                _ => continue,
            }

            for (position, vector) in stored.vectors.iter().enumerate() {
                let score = cosine_similarity(
                    &request.vector,
                    query_norm,
                    vector,
                    stored.norms.get(position).copied().unwrap_or(0.0),
                );

                if score > 0.0 {
                    scored.push((score, normalized.clone(), position));
                }
            }
        }

        scored.sort_by(|a, b| b.0.partial_cmp(&a.0).unwrap_or(std::cmp::Ordering::Equal));
        scored.truncate(request.limit.clamp(1, 20));

        scored
    });

    if scored.is_empty() {
        return Vec::new();
    }

    let budget = (SNIPPET_BUDGET_CHARS / scored.len()).max(SNIPPET_CHARS);

    scored
        .into_iter()
        .filter_map(|(score, relative_path, position)| {
            let path = Path::new(&request.root).join(&relative_path);
            let chunks = chunks_for_file(&state, &path);
            let chunk = chunks.get(position)?;

            Some(SearchHit {
                path: relative_path,
                heading_path: chunk.heading_path.clone(),
                // No query terms to centre the preview on — a vector match is
                // about the passage as a whole, so it starts at its beginning.
                snippet: build_snippet(chunk, &[], budget),
                truncated: chunk.text.chars().count() > budget,
                score,
            })
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn splits_at_headings_and_carries_the_trail() {
        let chunks = split_markdown("# A\n\ntext a\n\n## B\n\ntext b\n");

        assert_eq!(chunks.len(), 2);
        assert_eq!(chunks[0].heading_path, "A");
        assert_eq!(chunks[1].heading_path, "A > B");
        assert!(chunks[1].text.contains("text b"));
    }

    #[test]
    fn keeps_a_sibling_heading_from_nesting() {
        let chunks = split_markdown("## A\n\na\n\n## B\n\nb\n");

        assert_eq!(chunks[0].heading_path, "A");
        assert_eq!(chunks[1].heading_path, "B");
    }

    #[test]
    fn ignores_hashes_inside_a_code_fence() {
        let chunks = split_markdown("# Real\n\n```sh\n# not a heading\necho hi\n```\n\nafter\n");

        assert_eq!(chunks.len(), 1);
        assert_eq!(chunks[0].heading_path, "Real");
        assert!(chunks[0].text.contains("# not a heading"));
    }

    #[test]
    fn rejects_paths_that_would_escape_the_vault() {
        assert!(is_safe_relative_path("Projekte/Kunde A.md"));
        assert!(is_safe_relative_path("liste.md"));

        assert!(!is_safe_relative_path("../secrets.md"));
        assert!(!is_safe_relative_path("Projekte/../../secrets.md"));
        assert!(!is_safe_relative_path("/etc/passwd"));
        assert!(!is_safe_relative_path("C:/Windows/system.ini"));
        assert!(!is_safe_relative_path("..\\secrets.md"));
        assert!(!is_safe_relative_path(""));
    }

    #[test]
    fn tokenizes_non_ascii_words_whole() {
        assert_eq!(tokenize("Präzision, Größe!"), vec!["präzision", "größe"]);
    }

    #[test]
    fn a_passage_within_the_budget_comes_back_whole() {
        // The case that made a short poem look unfinished: a note longer than
        // SNIPPET_CHARS but well inside the per-hit budget of a small result
        // set has to arrive complete, without a trailing "…".
        let body = "zeile eins\n".repeat(50);
        let chunks = split_markdown(&format!("# Gedicht\n\n{body}"));
        let snippet = build_snippet(&chunks[0], &["zeile".to_string()], 1_000);

        assert!(snippet.chars().count() > SNIPPET_CHARS);
        assert_eq!(snippet, chunks[0].text);
        assert!(!snippet.contains('…'));
    }

    #[test]
    fn a_passage_over_the_budget_is_marked_as_a_preview() {
        let body = "zeile eins\n".repeat(50);
        let chunks = split_markdown(&format!("# Gedicht\n\n{body}"));
        let snippet = build_snippet(&chunks[0], &["zeile".to_string()], 200);

        assert!(snippet.chars().count() <= 202);
        assert!(snippet.ends_with('…'));
    }

    #[test]
    fn heading_terms_are_searchable_without_appearing_in_the_body() {
        let chunks = split_markdown("# Liefertermin\n\nWir einigten uns auf Freitag.\n");

        assert!(chunks[0].term_frequencies.contains_key("liefertermin"));
        // …but the passage text itself stays clean, so the snippet does not
        // repeat the heading back to the user.
        assert!(!chunks[0].text.contains("Liefertermin"));
    }

    fn sample_index() -> VectorIndex {
        let mut files = HashMap::new();
        files.insert(
            "Projekte/Kunde A.md".to_string(),
            IndexedFile::new(1_700_000_000_000, 512, vec![vec![0.5, -0.25, 1.0], vec![0.0, 1.0, 0.0]]),
        );

        VectorIndex {
            root: "C:/vault".to_string(),
            header: Some(IndexHeader {
                provider: "ollama".to_string(),
                model: "nomic-embed-text".to_string(),
                dimensions: 3,
                version: INDEX_FORMAT_VERSION,
            }),
            files,
            unsaved: 0,
        }
    }

    #[test]
    fn stored_vectors_survive_a_round_trip() {
        let index = sample_index();
        let bytes = serialize_index(&index).expect("serializable");
        let restored = deserialize_index("C:/vault", &bytes).expect("readable");

        let file = restored.files.get("Projekte/Kunde A.md").expect("file kept");

        assert_eq!(restored.header, index.header);
        assert_eq!(file.mtime_ms, 1_700_000_000_000);
        assert_eq!(file.vectors, vec![vec![0.5, -0.25, 1.0], vec![0.0, 1.0, 0.0]]);
    }

    #[test]
    fn a_truncated_index_file_is_rejected_rather_than_half_read() {
        let bytes = serialize_index(&sample_index()).expect("serializable");

        assert!(deserialize_index("C:/vault", &bytes[..bytes.len() - 5]).is_none());
        assert!(deserialize_index("C:/vault", b"not an index").is_none());
    }

    #[test]
    fn vectors_from_another_model_are_never_used() {
        let header = sample_index().header;

        assert!(header_matches(header.as_ref(), "ollama", "nomic-embed-text"));
        // Same provider, other model — the distances would be meaningless.
        assert!(!header_matches(header.as_ref(), "ollama", "mxbai-embed-large"));
        assert!(!header_matches(None, "ollama", "nomic-embed-text"));
    }

    #[test]
    fn cosine_ranks_the_closer_passage_first() {
        let query = vec![1.0, 0.0, 0.0];
        let query_norm = vector_norm(&query);
        let near = vec![0.9, 0.1, 0.0];
        let far = vec![0.0, 1.0, 0.0];

        let near_score = cosine_similarity(&query, query_norm, &near, vector_norm(&near));
        let far_score = cosine_similarity(&query, query_norm, &far, vector_norm(&far));

        assert!(near_score > far_score);
        // A zero vector cannot be compared to anything and must not score.
        assert_eq!(cosine_similarity(&query, query_norm, &[0.0, 0.0, 0.0], 0.0), 0.0);
    }
}
