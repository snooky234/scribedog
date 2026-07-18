use std::{path::PathBuf, sync::Mutex};

use notify::{Config, Event, RecommendedWatcher, RecursiveMode, Watcher};
use tauri::{AppHandle, Emitter, State};
use tauri_plugin_fs::FsExt;

const FOLDER_FILES_CHANGED_EVENT: &str = "scribedog-folder-files-changed";

#[derive(Default)]
struct StartupState {
    folder_path: Option<String>,
}

#[derive(Default)]
struct FolderWatchState {
    watcher: Mutex<Option<RecommendedWatcher>>,
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

#[tauri::command]
fn watch_folder(
    app: AppHandle,
    folder_watch_state: State<'_, FolderWatchState>,
    folder_path: String,
) -> Result<(), String> {
    let folder_path = PathBuf::from(folder_path);

    if !folder_path.is_dir() {
        return Err("Der Ordner konnte nicht überwacht werden.".to_string());
    }

    let folder_path_for_event = folder_path.to_string_lossy().into_owned();
    let app_handle = app.clone();

    let mut watcher = RecommendedWatcher::new(
        move |result: notify::Result<Event>| {
            if result.is_ok() {
                let _ = app_handle.emit(FOLDER_FILES_CHANGED_EVENT, folder_path_for_event.clone());
            }
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

const KEYRING_SERVICE: &str = "scribedog";
const KEYRING_ACCOUNT: &str = "ai-api-key";

fn api_key_entry() -> Result<keyring::Entry, String> {
    keyring::Entry::new(KEYRING_SERVICE, KEYRING_ACCOUNT).map_err(|error| error.to_string())
}

#[tauri::command]
fn store_api_key(api_key: String) -> Result<(), String> {
    let entry = api_key_entry()?;

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
fn get_api_key() -> Result<String, String> {
    let entry = api_key_entry()?;

    match entry.get_password() {
        Ok(api_key) => Ok(api_key),
        Err(keyring::Error::NoEntry) => Ok(String::new()),
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

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let mut builder = tauri::Builder::default()
        .plugin(
            tauri_plugin_window_state::Builder::default()
                .with_state_flags(
                    tauri_plugin_window_state::StateFlags::SIZE
                        | tauri_plugin_window_state::StateFlags::MAXIMIZED,
                )
                .build(),
        )
        .plugin(tauri_plugin_http::init())
        .manage(StartupState {
            folder_path: collect_startup_folder_path(),
        })
        .manage(FolderWatchState::default())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_opener::init());

    #[cfg(windows)]
    {
        builder = builder
            .plugin(tauri_plugin_updater::Builder::new().build())
            .plugin(tauri_plugin_process::init());
    }

    builder
        .invoke_handler(tauri::generate_handler![
            get_startup_folder_path,
            allow_folder_scope,
            allow_file_scope,
            watch_folder,
            check_spellcheck_dictionary,
            store_api_key,
            get_api_key
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
