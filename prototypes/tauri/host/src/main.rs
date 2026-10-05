// SPDX-License-Identifier: AGPL-3.0-only
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod commands;
mod dialogs;
mod files;
mod lifecycle;
mod navigation;
mod smoke;
mod wav_smoke;

use std::sync::Mutex;
use std::sync::atomic::{AtomicU64, Ordering};
use tauri::{Emitter, Manager, WebviewUrl, WebviewWindowBuilder, WindowEvent};

pub struct HostState {
    files: Mutex<files::FileCapabilities>,
    lifecycle: Mutex<lifecycle::Lifecycle>,
    generation: AtomicU64,
    smoke: Option<smoke::SmokeSession>,
}

impl HostState {
    fn revoke_renderer(&self) {
        if let Ok(mut files) = self.files.lock() {
            self.generation.fetch_add(1, Ordering::SeqCst);
            files.revoke_all();
        }
        if let Ok(mut lifecycle) = self.lifecycle.lock() {
            lifecycle.reset();
        }
    }
}

fn main() {
    if let Err(error) = run() {
        eprintln!("Soundscaper Tauri Prototype: {error}");
        std::process::exit(1);
    }
}

fn run() -> Result<(), Box<dyn std::error::Error>> {
    let smoke = smoke::SmokeSession::from_arguments(std::env::args().skip(1).collect())?;
    let smoke_mode = smoke.is_some();
    tauri::Builder::default()
        .manage(HostState {
            files: Mutex::default(),
            lifecycle: Mutex::default(),
            generation: AtomicU64::default(),
            smoke,
        })
        .invoke_handler(tauri::generate_handler![
            commands::prototype_environment,
            commands::prototype_choose_files,
            commands::prototype_release_read,
            commands::prototype_release_target,
            commands::prototype_read_range,
            commands::prototype_choose_save_target,
            commands::prototype_begin_write,
            commands::prototype_write_chunk,
            commands::prototype_patch_final_prefix,
            commands::prototype_finish_write,
            commands::prototype_abort_write,
            commands::prototype_signal_ready,
            commands::prototype_respond_to_close,
            commands::prototype_window_action,
            smoke::prototype_smoke_complete,
        ])
        .setup(move |app| {
            let state = app.state::<HostState>();
            let data_directory = if let Some(smoke) = &state.smoke {
                smoke.directory.path().join("webview")
            } else {
                app.path().app_data_dir()?.join("webview")
            };
            std::fs::create_dir_all(&data_directory)?;
            let navigation_app = app.handle().clone();
            let mut window =
                WebviewWindowBuilder::new(app, "main", WebviewUrl::App("index.html".into()))
                    .title("Soundscaper Tauri Prototype")
                    .inner_size(1280.0, 800.0)
                    .min_inner_size(800.0, 600.0)
                    .data_directory(data_directory)
                    .initialization_script(include_str!("../../../../.tauri-prototype/bridge.js"))
                    .on_navigation(move |url| {
                        let editor = navigation::allows_editor_navigation(
                            url.scheme(),
                            url.host_str(),
                            url.path(),
                        );
                        if editor {
                            navigation_app.state::<HostState>().revoke_renderer();
                        }
                        editor
                    });
            if smoke_mode {
                window = window
                    .initialization_script(include_str!("../../../../.tauri-prototype/smoke.js"));
                smoke::start_watchdog(app.handle().clone());
            }
            window.build()?;
            Ok(())
        })
        .on_window_event(|window, event| {
            let state = window.state::<HostState>();
            match event {
                WindowEvent::CloseRequested { api, .. } => {
                    if let Ok(mut lifecycle) = state.lifecycle.lock()
                        && let Some(request_id) = lifecycle.request_close()
                    {
                        api.prevent_close();
                        if let Err(error) = window.emit(
                            "prototype-close-requested",
                            serde_json::json!({ "requestId": request_id }),
                        ) {
                            eprintln!("Could not request editor shutdown: {error}");
                        }
                    }
                }
                WindowEvent::Destroyed => {
                    state.revoke_renderer();
                }
                _ => {}
            }
        })
        .run(tauri::generate_context!())?;
    Ok(())
}
