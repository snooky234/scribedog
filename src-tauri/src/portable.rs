//! Portable mode — the app keeps everything it owns next to its own
//! executable instead of in the per-user OS directories, so a copy on a USB
//! stick carries its settings along and an ordinary folder needs no installer.
//!
//! The marker is the *file* `.scribedog/portable`, not the `.scribedog`
//! directory: that directory name is also the vault metadata directory (see
//! `VAULT_META_DIR_NAME`), so an installed build whose executable happens to
//! sit in a folder the user later opens as a vault would otherwise switch
//! itself into portable mode.
//!
//! Portable mode is **Windows-only**: `detect()` returns `Off` everywhere else,
//! so the marker file is inert there. The portable ZIP is built in the Windows
//! job alone, and on Linux the AppImage already runs without installing
//! anything.

use std::{
    fs,
    path::{Path, PathBuf},
    sync::OnceLock,
};

use serde::Serialize;

use crate::VAULT_META_DIR_NAME;

const MARKER_FILE_NAME: &str = "portable";
const DATA_DIR_NAME: &str = "app";
const WRITE_PROBE_FILE_NAME: &str = ".write-probe";

#[derive(Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum PortableMode {
    /// No marker next to the executable — the installed build's behaviour.
    Off,
    /// Marker found and the directory is writable.
    On,
    /// Marker found, but nothing can be written there (`C:\Program Files`, a
    /// read-only medium). Falling back to the OS directories *silently* would
    /// leave data behind on a machine the user expected to stay clean, so the
    /// fallback happens but the frontend says so.
    ReadOnly,
}

pub struct PortableState {
    mode: PortableMode,
    data_dir: Option<PathBuf>,
}

static STATE: OnceLock<PortableState> = OnceLock::new();

fn is_writable(dir: &Path) -> bool {
    if fs::create_dir_all(dir).is_err() {
        return false;
    }

    let probe = dir.join(WRITE_PROBE_FILE_NAME);

    if fs::write(&probe, b"").is_err() {
        return false;
    }

    let _ = fs::remove_file(&probe);

    true
}

fn detect() -> PortableState {
    // Windows only, and by decision rather than by limitation: what carries
    // localStorage is the webview redirection, and WEBVIEW2_USER_DATA_FOLDER
    // exists for WebView2 alone. Honouring the marker elsewhere would move the
    // shortcuts, the voice model and the window state while leaving the AI
    // configuration, the assistants and the chat history behind — half
    // portable is more confusing than not portable at all. On Linux the
    // AppImage already runs without installing anything, so there is nothing
    // here it would add. `cfg!` rather than `#[cfg]` keeps the rest of this
    // module compiled everywhere instead of spreading attributes over every
    // helper it uses.
    if !cfg!(windows) {
        return PortableState {
            mode: PortableMode::Off,
            data_dir: None,
        };
    }

    let exe_dir = std::env::current_exe()
        .ok()
        .and_then(|exe| exe.parent().map(Path::to_path_buf));

    let Some(exe_dir) = exe_dir else {
        return PortableState {
            mode: PortableMode::Off,
            data_dir: None,
        };
    };

    let meta_dir = exe_dir.join(VAULT_META_DIR_NAME);

    if !meta_dir.join(MARKER_FILE_NAME).is_file() {
        return PortableState {
            mode: PortableMode::Off,
            data_dir: None,
        };
    }

    let data_dir = meta_dir.join(DATA_DIR_NAME);

    if !is_writable(&data_dir) {
        return PortableState {
            mode: PortableMode::ReadOnly,
            data_dir: None,
        };
    }

    PortableState {
        mode: PortableMode::On,
        data_dir: Some(data_dir),
    }
}

/// Resolved once, on the first call. Must happen before the webview is
/// created, because that is when `WEBVIEW2_USER_DATA_FOLDER` is read.
fn state() -> &'static PortableState {
    STATE.get_or_init(detect)
}

pub fn mode() -> PortableMode {
    state().mode
}

/// `Some` only when portable mode is actually active — a read-only marker
/// resolves to `None` so every caller falls back to the OS directories on its
/// own, without repeating the check.
pub fn data_dir() -> Option<&'static Path> {
    state().data_dir.as_deref()
}

/// A subdirectory of the portable data root, created on demand. Only the
/// WebView2 redirection uses this, which is Windows-only — hence the allow.
#[cfg_attr(not(windows), allow(dead_code))]
pub fn data_subdir(name: &str) -> Option<PathBuf> {
    let dir = data_dir()?.join(name);
    fs::create_dir_all(&dir).ok()?;

    Some(dir)
}
