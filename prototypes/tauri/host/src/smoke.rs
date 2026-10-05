// SPDX-License-Identifier: AGPL-3.0-only

use crate::HostState;
use serde_json::{Value, json};
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::{Duration, Instant};
use tauri::{AppHandle, Manager, State, WebviewWindow};

pub struct SmokeSession {
    pub directory: tempfile::TempDir,
    pub fixture: PathBuf,
    pub output: PathBuf,
    report: PathBuf,
    started: Instant,
    complete: AtomicBool,
}

impl SmokeSession {
    pub fn from_arguments(args: Vec<String>) -> Result<Option<Self>, String> {
        if args.is_empty() {
            return Ok(None);
        }
        if args.len() != 3 || args[0] != "--smoke" || args[1] != "--smoke-report" {
            return Err(
                "Usage: soundscaper-tauri-prototype [--smoke --smoke-report /absolute/report.json]"
                    .into(),
            );
        }
        let report = PathBuf::from(&args[2]);
        if !report.is_absolute() {
            return Err("Smoke report must be an absolute path".into());
        }
        let directory = tempfile::tempdir().map_err(|_| "Could not create smoke directory")?;
        let fixture = directory.path().join("tauri-prototype-tone.wav");
        let output = directory.path().join("tauri-prototype-export.wav");
        std::fs::write(&fixture, tone_wav()).map_err(|_| "Could not create smoke fixture")?;
        Ok(Some(Self {
            directory,
            fixture,
            output,
            report,
            started: Instant::now(),
            complete: AtomicBool::new(false),
        }))
    }

    fn write_report(&self, renderer: Value) -> Result<bool, String> {
        let output = std::fs::read(&self.output).unwrap_or_default();
        let (valid_wave, non_silent) = crate::wav_smoke::inspect_wav(&output);
        let success = renderer["success"] == true
            && renderer["editorReady"] == true
            && renderer["importedViaMenu"] == true
            && renderer["exportedViaMenu"] == true
            && renderer["nodeExposed"] == false
            && valid_wave
            && non_silent;
        let report = json!({
            "success": success, "host": "tauri", "platform": std::env::consts::OS,
            "architecture": std::env::consts::ARCH,
            "elapsedMs": self.started.elapsed().as_millis(),
            "exportBytes": output.len(), "validWave": valid_wave, "nonSilent": non_silent,
            "renderer": renderer
        });
        std::fs::write(
            &self.report,
            serde_json::to_vec_pretty(&report).map_err(|_| "Could not encode smoke report")?,
        )
        .map_err(|_| "Could not write smoke report")?;
        self.complete.store(true, Ordering::SeqCst);
        Ok(success)
    }
}

#[tauri::command]
pub fn prototype_smoke_complete(
    app: AppHandle,
    window: WebviewWindow,
    state: State<'_, HostState>,
    report: Value,
) -> Result<(), String> {
    let smoke = state.smoke.as_ref().ok_or("Smoke mode is not enabled")?;
    if smoke.complete.load(Ordering::SeqCst) {
        return Err("Smoke already completed".into());
    }
    if smoke.write_report(report)? {
        // Exercise the normal editor flush/close handshake before the process exits.
        window
            .close()
            .map_err(|_| "Smoke could not request editor close")?;
    } else {
        app.exit(1);
    }
    Ok(())
}

pub fn start_watchdog(app: AppHandle) {
    std::thread::spawn(move || {
        std::thread::sleep(Duration::from_secs(105));
        let state = app.state::<HostState>();
        if let Some(smoke) = &state.smoke
            && !smoke.complete.load(Ordering::SeqCst)
        {
            let _ = smoke.write_report(
                json!({ "success": false, "error": "Native smoke watchdog expired" }),
            );
            app.exit(1);
        }
    });
}

fn tone_wav() -> Vec<u8> {
    let frames = 24_000_u32;
    let mut bytes = Vec::with_capacity(44 + frames as usize * 2);
    bytes.extend(b"RIFF");
    bytes.extend((36 + frames * 2).to_le_bytes());
    bytes.extend(b"WAVEfmt ");
    bytes.extend(16_u32.to_le_bytes());
    bytes.extend(1_u16.to_le_bytes());
    bytes.extend(1_u16.to_le_bytes());
    bytes.extend(48_000_u32.to_le_bytes());
    bytes.extend(96_000_u32.to_le_bytes());
    bytes.extend(2_u16.to_le_bytes());
    bytes.extend(16_u16.to_le_bytes());
    bytes.extend(b"data");
    bytes.extend((frames * 2).to_le_bytes());
    for frame in 0..frames {
        let phase = frame as f64 * 440.0 * std::f64::consts::TAU / 48_000.0;
        bytes.extend(((phase.sin() * 8_000.0) as i16).to_le_bytes());
    }
    bytes
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn smoke_cannot_be_enabled_by_a_renderer_or_relative_report() {
        assert!(SmokeSession::from_arguments(vec![]).unwrap().is_none());
        assert!(SmokeSession::from_arguments(vec!["--smoke".into()]).is_err());
        assert!(
            SmokeSession::from_arguments(vec![
                "--smoke".into(),
                "--smoke-report".into(),
                "relative.json".into()
            ])
            .is_err()
        );
    }

    #[test]
    fn native_fixture_has_exact_pcm_geometry() {
        let bytes = tone_wav();
        assert_eq!(bytes.len(), 48_044);
        assert_eq!(&bytes[0..4], b"RIFF");
        assert_eq!(&bytes[8..12], b"WAVE");
        assert_eq!(
            u32::from_le_bytes(bytes[40..44].try_into().unwrap()),
            48_000
        );
        assert!(bytes[44..].iter().any(|&byte| byte != 0));
    }
}
