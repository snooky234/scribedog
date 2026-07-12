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
            watch_folder
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
