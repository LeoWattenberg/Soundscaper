// SPDX-License-Identifier: AGPL-3.0-only

use crate::{HostState, dialogs, files};
use serde::Deserialize;
use serde_json::{Value, json};
use std::sync::atomic::Ordering;
use tauri::{Emitter, State, WebviewWindow};

#[tauri::command]
pub fn prototype_environment() -> Value {
    json!({
        "productId": "soundscaper", "productName": "Soundscaper Tauri Prototype",
        "version": env!("CARGO_PKG_VERSION"), "locale": "en", "development": false,
        "platform": if cfg!(target_os = "macos") { "darwin" } else if cfg!(target_os = "windows") { "win32" } else { "linux" },
        "arch": std::env::consts::ARCH,
        "capabilities": { "displayAudio": false }
    })
}

#[tauri::command]
pub async fn prototype_choose_files(
    state: State<'_, HostState>,
    request: dialogs::FileChoice,
) -> Result<Vec<files::ReadDescriptor>, String> {
    dialogs::read_extensions(&request.purpose)?;
    let generation = state.generation.load(Ordering::SeqCst);
    let paths = if let Some(smoke) = &state.smoke {
        vec![smoke.fixture.clone()]
    } else {
        tauri::async_runtime::spawn_blocking(move || dialogs::choose_files(request))
            .await
            .map_err(|_| "File chooser failed")??
    };
    let mut files = state
        .files
        .lock()
        .map_err(|_| "File authority unavailable")?;
    if state.generation.load(Ordering::SeqCst) != generation {
        return Err("The editor changed while choosing files".into());
    }
    let mut descriptors: Vec<files::ReadDescriptor> = Vec::new();
    for path in paths {
        match files.register_read(path) {
            Ok(descriptor) => descriptors.push(descriptor),
            Err(error) => {
                for descriptor in descriptors {
                    files.revoke_read(&descriptor.id);
                }
                return Err(error);
            }
        }
    }
    Ok(descriptors)
}

#[tauri::command]
pub fn prototype_release_read(state: State<'_, HostState>, id: String) -> Result<bool, String> {
    Ok(state
        .files
        .lock()
        .map_err(|_| "File authority unavailable")?
        .revoke_read(&id))
}

#[tauri::command]
pub fn prototype_release_target(state: State<'_, HostState>, id: String) -> Result<bool, String> {
    Ok(state
        .files
        .lock()
        .map_err(|_| "File authority unavailable")?
        .revoke_target(&id))
}

#[tauri::command]
pub fn prototype_read_range(
    state: State<'_, HostState>,
    id: String,
    offset: u64,
    length: usize,
) -> Result<tauri::ipc::Response, String> {
    Ok(tauri::ipc::Response::new(
        state
            .files
            .lock()
            .map_err(|_| "File authority unavailable")?
            .read(&id, offset, length)?,
    ))
}

#[tauri::command]
pub async fn prototype_choose_save_target(
    state: State<'_, HostState>,
    request: dialogs::SaveChoice,
) -> Result<Option<files::TargetDescriptor>, String> {
    dialogs::save_name(&request)?;
    let generation = state.generation.load(Ordering::SeqCst);
    let path = if let Some(smoke) = &state.smoke {
        Some(smoke.output.clone())
    } else {
        tauri::async_runtime::spawn_blocking(move || dialogs::choose_target(request))
            .await
            .map_err(|_| "Save chooser failed")??
    };
    let mut files = state
        .files
        .lock()
        .map_err(|_| "File authority unavailable")?;
    if state.generation.load(Ordering::SeqCst) != generation {
        return Err("The editor changed while choosing a save target".into());
    }
    path.map(|path| files.register_target(path)).transpose()
}

#[tauri::command]
pub fn prototype_begin_write(
    state: State<'_, HostState>,
    request: files::BeginWriteRequest,
) -> Result<files::WriteDescriptor, String> {
    state
        .files
        .lock()
        .map_err(|_| "File authority unavailable")?
        .begin_write(request)
}

#[tauri::command]
pub fn prototype_write_chunk(
    state: State<'_, HostState>,
    request: files::WriteChunkRequest,
) -> Result<files::WriteProgress, String> {
    state
        .files
        .lock()
        .map_err(|_| "File authority unavailable")?
        .write_chunk(request)
}

#[tauri::command]
pub fn prototype_patch_final_prefix(
    state: State<'_, HostState>,
    request: files::PatchPrefixRequest,
) -> Result<files::ByteLength, String> {
    state
        .files
        .lock()
        .map_err(|_| "File authority unavailable")?
        .patch_final_prefix(request)
}

#[tauri::command]
pub fn prototype_finish_write(
    state: State<'_, HostState>,
    id: String,
) -> Result<files::ByteLength, String> {
    state
        .files
        .lock()
        .map_err(|_| "File authority unavailable")?
        .finish(&id)
}

#[tauri::command]
pub fn prototype_abort_write(state: State<'_, HostState>, id: String) -> Result<bool, String> {
    Ok(state
        .files
        .lock()
        .map_err(|_| "File authority unavailable")?
        .abort(&id))
}

#[tauri::command]
pub fn prototype_signal_ready(state: State<'_, HostState>) -> Result<(), String> {
    state
        .lifecycle
        .lock()
        .map_err(|_| "Window lifecycle unavailable")?
        .ready();
    Ok(())
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CloseResponse {
    request_id: String,
    allow: bool,
}

#[tauri::command]
pub fn prototype_respond_to_close(
    window: WebviewWindow,
    state: State<'_, HostState>,
    request: CloseResponse,
) -> Result<(), String> {
    let allow = state
        .lifecycle
        .lock()
        .map_err(|_| "Window lifecycle unavailable")?
        .respond(&request.request_id, request.allow)?;
    if allow {
        window.close().map_err(|_| "Could not close window")?;
    }
    Ok(())
}

#[tauri::command]
pub fn prototype_window_action(
    window: WebviewWindow,
    state: State<'_, HostState>,
    action: String,
) -> Result<(), String> {
    let result = match action.as_str() {
        "minimize" => window.minimize(),
        "toggle-maximize" => {
            if window.is_maximized().unwrap_or(false) {
                window.unmaximize()
            } else {
                window.maximize()
            }
        }
        "toggle-fullscreen" => window.set_fullscreen(!window.is_fullscreen().unwrap_or(false)),
        "quit" => window.close(),
        "reload" => {
            state.revoke_renderer();
            window.eval("location.reload()")
        }
        _ => return Err("Unsupported prototype window action".into()),
    };
    result.map_err(|_| "Window action failed")?;
    window.emit("prototype-window-state", json!({ "fullscreen": window.is_fullscreen().unwrap_or(false), "maximized": window.is_maximized().unwrap_or(false) })).map_err(|_| "Window state notification failed".into())
}
