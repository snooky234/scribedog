mod portable;
mod rag;
mod remote_vault;
mod voice;
mod window_state;

use std::{
    path::{Path, PathBuf},
    sync::Mutex,
};

use notify::{Config, Event, RecommendedWatcher, RecursiveMode, Watcher};
use tauri::{AppHandle, Emitter, Manager, State};
use tauri_plugin_fs::FsExt;

pub(crate) const FOLDER_FILES_CHANGED_EVENT: &str = "scribedog-folder-files-changed";

/// Mirrors VAULT_META_DIR_NAME in src/lib/fileSystem.ts.
const VAULT_META_DIR_NAME: &str = ".scribedog";

// The app writes its own state into the vault (staged changes, chat sessions,
// checkpoints, sort order), and every one of those writes lands under the
// watched folder. Reporting them would make the UI refresh the whole tree in
// reaction to something it just did itself — which is how a note that is only
// staged, and therefore not on disk, ended up being closed again right after
// the user opened it. A change is only interesting if it touches something
// outside the metadata directory.
fn is_metadata_path(path: &Path) -> bool {
    path.components()
        .any(|component| component.as_os_str() == VAULT_META_DIR_NAME)
}

fn is_metadata_only_event(event: &Event) -> bool {
    !event.paths.is_empty() && event.paths.iter().all(|path| is_metadata_path(path))
}

#[derive(Default)]
struct StartupState {
    folder_path: Option<String>,
}

#[derive(Default)]
pub(crate) struct FolderWatchState {
    pub(crate) watcher: Mutex<Option<RecommendedWatcher>>,
}

#[tauri::command]
fn get_startup_folder_path(state: State<'_, StartupState>) -> Option<String> {
    state.folder_path.clone()
}

#[tauri::command]
fn allow_folder_scope(app: AppHandle, folder_path: String) -> Result<(), String> {
    let _ = app.fs_scope().allow_directory(folder_path, true);
    Ok(())
}

#[tauri::command]
fn allow_file_scope(app: AppHandle, file_path: String) -> Result<(), String> {
    let _ = app.fs_scope().allow_file(file_path);
    Ok(())
}

/// Whether a recent vault is still there. A plain bool on purpose: the fs
/// scope only covers the open vault, and widening it to every recent folder
/// just to ask this would open far more than the question needs.
#[tauri::command]
fn folder_exists(folder_path: String) -> bool {
    Path::new(&folder_path).is_dir()
}

/// Opens a folder in the OS file manager, positioned *inside* it. The opener
/// plugin's `reveal_item_in_dir` instead opens the item's parent with the item
/// selected — correct for a file, but for a folder that lands the user one
/// level too high, which is not what "open in Explorer" means for a folder row
/// in the tree.
#[tauri::command]
fn open_folder_in_file_manager(folder_path: String) -> Result<(), String> {
    #[cfg(target_os = "windows")]
    let result = std::process::Command::new("explorer").arg(&folder_path).spawn();

    #[cfg(target_os = "macos")]
    let result = std::process::Command::new("open").arg(&folder_path).spawn();

    #[cfg(all(unix, not(target_os = "macos")))]
    let result = std::process::Command::new("xdg-open").arg(&folder_path).spawn();

    result.map(|_| ()).map_err(|error| error.to_string())
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct PortableStatus {
    mode: portable::PortableMode,
    config_dir: String,
}

/// Where the frontend keeps the files it owns (`shortcuts.json`), plus whether
/// portable mode is on. One command rather than two, because every caller that
/// wants the directory also has to know when the marker was found but could
/// not be written to.
#[tauri::command]
fn get_portable_status(app: AppHandle) -> Result<PortableStatus, String> {
    let dir = match portable::data_dir() {
        Some(dir) => dir.to_path_buf(),
        None => app
            .path()
            .app_config_dir()
            .map_err(|error| error.to_string())?,
    };

    // The static capability only covers the OS config dir, so the portable
    // directory has to be opened up at runtime — the same mechanism the
    // user-chosen vault folder goes through.
    let _ = app.fs_scope().allow_directory(&dir, true);

    Ok(PortableStatus {
        mode: portable::mode(),
        config_dir: dir.to_string_lossy().into_owned(),
    })
}

#[tauri::command]
fn watch_folder(
    app: AppHandle,
    folder_watch_state: State<'_, FolderWatchState>,
    remote_vault_state: State<'_, remote_vault::RemoteVaultState>,
    folder_path: String,
) -> Result<(), String> {
    let folder_path = PathBuf::from(folder_path);

    if !folder_path.is_dir() {
        return Err("Der Ordner konnte nicht überwacht werden.".to_string());
    }

    // Only one vault is open at a time: a server vault's live connection,
    // if any, ends when a local folder takes over.
    remote_vault::stop_watch(&remote_vault_state);

    let folder_path_for_event = folder_path.to_string_lossy().into_owned();
    let app_handle = app.clone();

    let mut watcher = RecommendedWatcher::new(
        move |result: notify::Result<Event>| {
            let Ok(event) = result else {
                return;
            };

            if is_metadata_only_event(&event) {
                return;
            }

            let _ = app_handle.emit(FOLDER_FILES_CHANGED_EVENT, folder_path_for_event.clone());
        },
        Config::default(),
    )
    .map_err(|error| error.to_string())?;

    watcher
        .watch(&folder_path, RecursiveMode::Recursive)
        .map_err(|error| error.to_string())?;

    let mut watcher_slot = folder_watch_state
        .watcher
        .lock()
        .map_err(|_| "Der Ordner-Watcher konnte nicht aktualisiert werden.".to_string())?;
    *watcher_slot = Some(watcher);

    Ok(())
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct SpellcheckDictionaryStatus {
    available: bool,
    install_command: Option<String>,
}

// Debian/Ubuntu name a handful of common dictionaries with a locale suffix
// (hunspell-de-de, hunspell-en-us, hunspell-pt-br) instead of the bare
// language code that Fedora/Arch use (hunspell-de, hunspell-pt, …). This is
// a best-effort guess, not a verified package list — good enough for a "here's
// roughly what to run" hint, not a guarantee the exact package name exists.
#[cfg(target_os = "linux")]
fn apt_package_name(language: &str) -> String {
    match language {
        "de" => "hunspell-de-de".to_string(),
        "en" => "hunspell-en-us".to_string(),
        "pt" => "hunspell-pt-br".to_string(),
        other => format!("hunspell-{other}"),
    }
}

// Checking `<manager> --version` is read-only and side-effect free — enough
// to tell which of the three most common desktop package managers is
// present, without needing to shell out to distro-detection files that vary
// in format across releases.
#[cfg(target_os = "linux")]
fn detect_linux_package_manager() -> Option<&'static str> {
    ["apt", "dnf", "pacman"]
        .into_iter()
        .find(|&manager| {
            std::process::Command::new(manager)
                .arg("--version")
                .output()
                .map(|output| output.status.success())
                .unwrap_or(false)
        })
}

#[cfg(target_os = "linux")]
fn build_install_command(language: &str) -> Option<String> {
    match detect_linux_package_manager()? {
        "apt" => Some(format!("sudo apt install {}", apt_package_name(language))),
        "dnf" => Some(format!("sudo dnf install hunspell-{language}")),
        "pacman" => Some(format!("sudo pacman -S hunspell-{language}")),
        _ => None,
    }
}

// Native spellcheck on Linux comes from WebKitGTK via libenchant, which picks
// dictionaries up from whatever Hunspell/Aspell/Nuspell packages happen to be
// installed on the system — there's no JS/webview API to ask "is a
// dictionary for X installed?". `enchant-lsmod` ships alongside libenchant
// itself (WebKitGTK's own spellcheck backend), so asking it directly reuses
// the exact same source of truth instead of guessing at distro-specific
// dictionary paths.
#[tauri::command]
fn check_spellcheck_dictionary(language: String) -> SpellcheckDictionaryStatus {
    #[cfg(target_os = "linux")]
    {
        let language = language.to_lowercase();
        let output = std::process::Command::new("enchant-lsmod")
            .arg("-list-dicts")
            .output();

        let available = match output {
            Ok(output) if output.status.success() => {
                let prefix = format!("{language}_");
                let stdout = String::from_utf8_lossy(&output.stdout);

                stdout.lines().any(|line| {
                    let token = line.trim().to_lowercase();
                    token == language || token.starts_with(&prefix)
                })
            }
            // enchant-lsmod missing or failing to run isn't proof that no
            // dictionary exists — fail open rather than block a feature that
            // might work fine.
            _ => true,
        };

        let install_command = if available {
            None
        } else {
            build_install_command(&language)
        };

        SpellcheckDictionaryStatus {
            available,
            install_command,
        }
    }

    #[cfg(not(target_os = "linux"))]
    {
        let _ = language;
        SpellcheckDictionaryStatus {
            available: true,
            install_command: None,
        }
    }
}

pub(crate) const KEYRING_SERVICE: &str = "scribedog";
// Pre-multi-provider versions kept every provider's key under this one
// account. Each provider now gets its own account (see api_key_entry); this
// legacy account is only ever read once, to migrate that single leftover key
// to whichever provider first asks (see get_api_key).
const LEGACY_KEYRING_ACCOUNT: &str = "ai-api-key";

fn api_key_entry(provider: &str) -> Result<keyring::Entry, String> {
    let account = format!("{LEGACY_KEYRING_ACCOUNT}:{provider}");
    keyring::Entry::new(KEYRING_SERVICE, &account).map_err(|error| error.to_string())
}

fn legacy_api_key_entry() -> Result<keyring::Entry, String> {
    keyring::Entry::new(KEYRING_SERVICE, LEGACY_KEYRING_ACCOUNT).map_err(|error| error.to_string())
}

#[tauri::command]
fn store_api_key(provider: String, api_key: String) -> Result<(), String> {
    let entry = api_key_entry(&provider)?;

    if api_key.is_empty() {
        // Deleting a credential that was never stored is not an error.
        return match entry.delete_credential() {
            Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
            Err(error) => Err(error.to_string()),
        };
    }

    entry.set_password(&api_key).map_err(|error| error.to_string())
}

#[tauri::command]
fn get_api_key(provider: String) -> Result<String, String> {
    let entry = api_key_entry(&provider)?;

    match entry.get_password() {
        Ok(api_key) => Ok(api_key),
        Err(keyring::Error::NoEntry) => {
            // One-time migration: a pre-multi-provider install has at most one
            // leftover key, under the shared legacy account. It belonged to
            // whichever provider was configured back then, so the first
            // provider to ask for a key after upgrading inherits it; deleting
            // the legacy entry afterward means no other provider ever sees it.
            let legacy_entry = legacy_api_key_entry()?;

            match legacy_entry.get_password() {
                Ok(legacy_api_key) => {
                    entry
                        .set_password(&legacy_api_key)
                        .map_err(|error| error.to_string())?;
                    let _ = legacy_entry.delete_credential();
                    Ok(legacy_api_key)
                }
                Err(keyring::Error::NoEntry) => Ok(String::new()),
                Err(error) => Err(error.to_string()),
            }
        }
        Err(error) => Err(error.to_string()),
    }
}

fn collect_startup_folder_path() -> Option<String> {
    std::env::args_os().skip(1).find_map(|argument| {
        let path = PathBuf::from(argument);

        if path.is_dir() {
            Some(path.to_string_lossy().into_owned())
        } else {
            None
        }
    })
}

/// Why `dangerousDisableAssetCspModification: ["style-src"]` is in
/// tauri.conf.json, despite the name:
///
/// Tauri adds a nonce to the CSP at runtime, and the CSP spec says a nonce
/// makes the browser *ignore* `'unsafe-inline'`. Everything that styles itself
/// from script is blocked from that moment on — the webview says "Applying
/// inline style violates ... 'unsafe-inline' is ignored if either a hash or
/// nonce value is present". It only shows up in a packaged build: the dev
/// server and the browser build never see this CSP, which is why the emoji
/// picker rendered as a bare grid with no search or categories there and
/// nowhere else (emoji-mart injects its stylesheet into a shadow root), while
/// ProseMirror's inline styles were refused alongside it.
///
/// Only the style directive is exempted. `script-src` keeps its nonce, and
/// that is the one that stops injected code; an inline stylesheet cannot
/// execute anything.
#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // Resolved before anything else: creating the webview is what reads
    // WEBVIEW2_USER_DATA_FOLDER, and by the time the builder runs it is too
    // late to redirect where localStorage lives.
    #[cfg(windows)]
    if let Some(dir) = portable::data_subdir("webview") {
        std::env::set_var("WEBVIEW2_USER_DATA_FOLDER", dir);
    }

    let mut builder = tauri::Builder::default()
        .plugin(tauri_plugin_http::init())
        .manage(StartupState {
            folder_path: collect_startup_folder_path(),
        })
        .manage(FolderWatchState::default())
        .manage(voice::VoiceState::default())
        .manage(rag::RagState::default())
        .manage(remote_vault::RemoteVaultState::default())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_opener::init());

    // The plugin writes into Tauri's app config directory and that path cannot
    // be redirected, so in portable mode `window_state` takes over and writes
    // next to the executable instead.
    if portable::data_dir().is_none() {
        builder = builder.plugin(
            tauri_plugin_window_state::Builder::default()
                .with_state_flags(
                    tauri_plugin_window_state::StateFlags::SIZE
                        | tauri_plugin_window_state::StateFlags::MAXIMIZED,
                )
                .build(),
        );
    }

    #[cfg(windows)]
    {
        builder = builder
            .plugin(tauri_plugin_updater::Builder::new().build())
            .plugin(tauri_plugin_process::init());
    }

    builder
        .setup(|app| {
            // The window is created hidden so the light default webview
            // background can never flash before the themed UI paints; the
            // frontend reveals it. This is the safety net that shows it anyway
            // if the frontend never gets that far.
            if let Some(window) = app.get_webview_window("main") {
                if let Some(dir) = portable::data_dir() {
                    window_state::restore(&window, dir);

                    let tracked = window.clone();
                    window.on_window_event(move |event| {
                        if matches!(event, tauri::WindowEvent::CloseRequested { .. }) {
                            window_state::save(&tracked, dir);
                        }
                    });
                }

                std::thread::spawn(move || {
                    std::thread::sleep(std::time::Duration::from_secs(5));
                    let _ = window.show();
                });
            }

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            get_startup_folder_path,
            allow_folder_scope,
            allow_file_scope,
            folder_exists,
            open_folder_in_file_manager,
            get_portable_status,
            watch_folder,
            check_spellcheck_dictionary,
            store_api_key,
            get_api_key,
            remote_vault::allow_remote_vault_origin,
            remote_vault::remote_vault_request,
            remote_vault::store_remote_vault_token,
            remote_vault::get_remote_vault_token,
            remote_vault::delete_remote_vault_token,
            remote_vault::watch_remote_vault,
            voice::voice_model_status,
            voice::download_voice_model,
            voice::start_voice_recording,
            voice::stop_voice_recording,
            voice::cancel_voice_recording,
            rag::rag_search_text,
            rag::rag_read_note,
            rag::rag_clear_cache,
            rag::rag_index_status,
            rag::rag_file_chunks,
            rag::rag_store_file_vectors,
            rag::rag_prune_index,
            rag::rag_clear_index,
            rag::rag_search_vectors
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
