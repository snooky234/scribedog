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
//! Stage 1 of DOCS/wissensbasis-plan.md: keyword search only. Vector storage
//! and cosine search are stage 2 and land beside this.

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
}
