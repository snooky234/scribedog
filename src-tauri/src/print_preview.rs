//! The window's close button while the print preview is open.
//!
//! `window.print()` opens Chromium's print preview inside the webview: modal,
//! and blocking the page's JavaScript until it closes. The close button of the
//! native window still reacts, but the request goes to the page, which cannot
//! answer, so nothing visible happens. What a click there means is "close this
//! dialog", so it is turned into the Escape that cancels the preview.
//!
//! WebView2 has no API to cancel a `window.print()` from outside; the key goes
//! through `SendInput` to the focused window, which after a click on the frame
//! is still the preview. Where it does not arrive, the page drops the request
//! it receives once the preview is closed (src/lib/printSession.ts), so the
//! worst case is the old "nothing happens", never an app that closes later.

use std::sync::atomic::{AtomicBool, Ordering};

#[derive(Default)]
pub struct PrintPreviewState(AtomicBool);

/// Set by the frontend right before `window.print()` and cleared after it.
#[tauri::command]
pub fn set_print_preview_open(state: tauri::State<'_, PrintPreviewState>, open: bool) {
    state.0.store(open, Ordering::SeqCst);
}

/// Whether a close request should cancel the preview instead of closing the
/// window. Clears the flag: should the frontend never get to clear it itself,
/// one click is lost to it, not the ability to close the app.
#[cfg_attr(not(windows), allow(dead_code))]
pub fn take_open(state: &PrintPreviewState) -> bool {
    state.0.swap(false, Ordering::SeqCst)
}

#[cfg(windows)]
pub fn cancel() {
    use windows_sys::Win32::UI::Input::KeyboardAndMouse::{
        SendInput, INPUT, INPUT_0, INPUT_KEYBOARD, KEYBDINPUT, KEYEVENTF_KEYUP, VK_ESCAPE,
    };

    let key = |flags| INPUT {
        r#type: INPUT_KEYBOARD,
        Anonymous: INPUT_0 {
            ki: KEYBDINPUT {
                wVk: VK_ESCAPE,
                wScan: 0,
                dwFlags: flags,
                time: 0,
                dwExtraInfo: 0,
            },
        },
    };
    let inputs = [key(0), key(KEYEVENTF_KEYUP)];

    // SAFETY: a valid array of two fully initialised keyboard inputs, with
    // the size of one element as the API asks.
    unsafe {
        SendInput(
            inputs.len() as u32,
            inputs.as_ptr(),
            std::mem::size_of::<INPUT>() as i32,
        );
    }
}
