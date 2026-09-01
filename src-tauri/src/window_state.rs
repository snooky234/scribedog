//! A minimal stand-in for `tauri-plugin-window-state`, used only in portable
//! mode. The plugin writes into Tauri's app config directory, and that path
//! cannot be redirected from the outside — which would leave exactly the trace
//! behind that portable mode promises not to leave. Kept here is only what the
//! plugin was configured to keep (`StateFlags::SIZE | MAXIMIZED`): the window
//! size and whether it was maximized. Nothing here is worth failing a startup
//! or a shutdown over, so every error is swallowed.

use std::{fs, path::Path};

use serde::{Deserialize, Serialize};
use tauri::{LogicalSize, WebviewWindow};

const FILE_NAME: &str = "window-state.json";

#[derive(Serialize, Deserialize, Clone, Copy)]
struct WindowState {
    width: f64,
    height: f64,
    maximized: bool,
}

fn read(dir: &Path) -> Option<WindowState> {
    let raw = fs::read_to_string(dir.join(FILE_NAME)).ok()?;
    // Unlike the installed build's copy in AppData, this file sits in plain
    // sight next to the executable, so it does get opened in an editor — and
    // plenty of them add a BOM that serde_json would choke on.
    let state: WindowState = serde_json::from_str(raw.trim_start_matches('\u{feff}')).ok()?;

    // A hand-edited or truncated file must not shrink the window to nothing.
    if !state.width.is_finite() || !state.height.is_finite() || state.width < 1.0 || state.height < 1.0
    {
        return None;
    }

    Some(state)
}

pub fn restore(window: &WebviewWindow, dir: &Path) {
    let Some(state) = read(dir) else {
        return;
    };

    let _ = window.set_size(LogicalSize::new(state.width, state.height));

    if state.maximized {
        let _ = window.maximize();
    }
}

pub fn save(window: &WebviewWindow, dir: &Path) {
    let maximized = window.is_maximized().unwrap_or(false);

    // While maximized the current size *is* the screen, so storing it would
    // lose the size to restore to when the user un-maximizes later. Keep what
    // the last un-maximized run wrote instead.
    let size = match (maximized, read(dir)) {
        (true, Some(previous)) => Some((previous.width, previous.height)),
        _ => window.inner_size().ok().map(|physical| {
            let scale = window.scale_factor().unwrap_or(1.0);

            (
                f64::from(physical.width) / scale,
                f64::from(physical.height) / scale,
            )
        }),
    };

    let Some((width, height)) = size else {
        return;
    };

    let state = WindowState {
        width,
        height,
        maximized,
    };

    if let Ok(serialized) = serde_json::to_string_pretty(&state) {
        let _ = fs::write(dir.join(FILE_NAME), serialized);
    }
}
