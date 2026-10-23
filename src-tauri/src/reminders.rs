//! Reminders of the local vaults that are not open, for the bell's list
//! across vaults (src/hooks/useReminderScheduler.ts).
//!
//! The fs scope covers the open vault only, and it stays that way: widening it
//! to every recent folder would hand the webview read and write access to all
//! of them, which is far more than a list of reminders needs. This command
//! reads instead, and only hands back what the list is made of: which notes
//! there are (for the mtimes), and the text of the ones that carry a reminder
//! marker. It never writes, never follows a symlink, and leaves the metadata
//! directory alone.

use std::{
    collections::HashMap,
    fs,
    path::Path,
    time::UNIX_EPOCH,
};

use serde::Serialize;

use crate::VAULT_META_DIR_NAME;

/// A note bigger than this is not read; nobody keeps reminders in a dump.
const MAX_NOTE_BYTES: u64 = 4 * 1024 * 1024;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ReminderNote {
    file_path: String,
    relative_path: String,
    mtime_ms: f64,
    /// Only for a note read this time (its mtime changed) that has a marker.
    content: Option<String>,
}

/// Mirrors isMarkdownFileName in src/lib/vaultPaths.ts.
fn is_markdown(name: &str) -> bool {
    name.to_ascii_lowercase().ends_with(".md")
}

/// The same cheap test as reminderMarker.ts's marker, without its details:
/// a comment that starts with "reminder". Whatever passes is parsed properly
/// in the frontend; whatever does not is never handed over.
fn has_reminder_marker(text: &str) -> bool {
    text.match_indices("<!--").any(|(index, _)| {
        text[index + 4..]
            .trim_start_matches([' ', '\t'])
            .starts_with("reminder")
    })
}

fn mtime_ms(metadata: &fs::Metadata) -> f64 {
    metadata
        .modified()
        .ok()
        .and_then(|time| time.duration_since(UNIX_EPOCH).ok())
        .map(|duration| duration.as_millis() as f64)
        .unwrap_or(0.0)
}

fn collect(root: &Path, current: &Path, known: &HashMap<String, f64>, notes: &mut Vec<ReminderNote>) {
    let Ok(entries) = fs::read_dir(current) else {
        return;
    };

    for entry in entries.flatten() {
        let Ok(file_type) = entry.file_type() else {
            continue;
        };

        if file_type.is_symlink() {
            continue;
        }

        let name = entry.file_name().to_string_lossy().into_owned();
        let path = entry.path();

        if file_type.is_dir() {
            if name != VAULT_META_DIR_NAME {
                collect(root, &path, known, notes);
            }

            continue;
        }

        if !file_type.is_file() || !is_markdown(&name) {
            continue;
        }

        let Ok(metadata) = entry.metadata() else {
            continue;
        };

        let file_path = path.to_string_lossy().into_owned();
        let mtime_ms = mtime_ms(&metadata);
        let changed = known.get(&file_path) != Some(&mtime_ms);
        let content = if changed && metadata.len() <= MAX_NOTE_BYTES {
            fs::read_to_string(&path).ok().filter(|text| has_reminder_marker(text))
        } else {
            None
        };
        let relative_path = path
            .strip_prefix(root)
            .map(|relative| relative.to_string_lossy().replace('\\', "/"))
            .unwrap_or_else(|_| name.clone());

        notes.push(ReminderNote {
            file_path,
            relative_path,
            mtime_ms,
            content,
        });
    }
}

/// Every note of a local vault with its mtime, and the text of those that
/// changed since `known` (path to mtime, from the last scan) and carry a
/// reminder marker.
#[tauri::command]
pub async fn read_reminder_notes(
    folder_path: String,
    known: HashMap<String, f64>,
) -> Result<Vec<ReminderNote>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let root = Path::new(&folder_path);

        if !root.is_absolute() || !root.is_dir() {
            return Err("not a folder".to_string());
        }

        let mut notes = Vec::new();
        collect(root, root, &known, &mut notes);

        Ok(notes)
    })
    .await
    .map_err(|error| error.to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn recognizes_the_marker_only_in_a_comment() {
        assert!(has_reminder_marker("Text <!-- reminder: 2026-10-25 09:00 -->"));
        assert!(has_reminder_marker("Text <!--reminder: 2026-10-25 09:00 -->"));
        assert!(!has_reminder_marker("A reminder to myself"));
        assert!(!has_reminder_marker("<!-- note --> reminder"));
    }

    #[test]
    fn reads_only_changed_notes_with_a_marker_and_skips_metadata() {
        let root = std::env::temp_dir().join(format!("scribedog-reminders-{}", std::process::id()));
        let _ = fs::remove_dir_all(&root);
        fs::create_dir_all(root.join("sub")).unwrap();
        fs::create_dir_all(root.join(VAULT_META_DIR_NAME)).unwrap();
        fs::write(root.join("a.md"), "Do it <!-- reminder: 2026-10-25 09:00 -->\n").unwrap();
        fs::write(root.join("sub").join("b.md"), "Nothing here\n").unwrap();
        fs::write(root.join(VAULT_META_DIR_NAME).join("c.md"), "<!-- reminder: 2026-10-25 09:00 -->\n").unwrap();
        fs::write(root.join("d.txt"), "<!-- reminder: 2026-10-25 09:00 -->\n").unwrap();

        let mut notes = Vec::new();
        collect(&root, &root, &HashMap::new(), &mut notes);
        notes.sort_by(|a, b| a.relative_path.cmp(&b.relative_path));

        let summary: Vec<_> = notes
            .iter()
            .map(|note| (note.relative_path.as_str(), note.content.is_some()))
            .collect();
        assert_eq!(summary, vec![("a.md", true), ("sub/b.md", false)]);

        let known: HashMap<_, _> = notes.iter().map(|note| (note.file_path.clone(), note.mtime_ms)).collect();
        let mut again = Vec::new();
        collect(&root, &root, &known, &mut again);
        assert!(again.iter().all(|note| note.content.is_none()));

        let _ = fs::remove_dir_all(&root);
    }
}
