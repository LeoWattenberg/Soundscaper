// SPDX-License-Identifier: AGPL-3.0-only

use serde::Deserialize;
use std::path::PathBuf;

const AUDIO: &[&str] = &[
    "wav", "wave", "aif", "aiff", "flac", "mp3", "mp2", "ogg", "oga", "opus", "wv", "wavpack",
    "aac", "m4a", "rf64", "bw64",
];
const PROJECT: &[&str] = &[
    "sscape",
    "scape",
    "fscape",
    "aup",
    "aup3",
    "aup4",
    "dawproject",
];

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub struct FileChoice {
    pub purpose: String,
    #[serde(default)]
    pub multiple: bool,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SaveChoice {
    pub purpose: String,
    pub suggested_name: String,
}

pub fn read_extensions(purpose: &str) -> Result<Vec<&'static str>, String> {
    match purpose {
        "audio" | "media" => Ok(AUDIO.to_vec()),
        "project" => Ok(PROJECT.iter().chain(AUDIO).copied().collect()),
        _ => Err("This prototype opens audio and project files only.".into()),
    }
}

pub fn save_name(choice: &SaveChoice) -> Result<&str, String> {
    let purposes = [
        "project",
        "project-copy",
        "audio",
        "audio-pcm-mix",
        "aup3",
        "aup4",
        "labels",
        "preset",
        "macro",
        "report",
        "attribution-csv",
        "interchange",
    ];
    if !purposes.contains(&choice.purpose.as_str()) {
        return Err("Unsupported prototype save purpose.".into());
    }
    let name = choice.suggested_name.trim();
    if name.is_empty()
        || name.len() > 255
        || name == "."
        || name == ".."
        || name
            .chars()
            .any(|c| c.is_control() || c == '/' || c == '\\')
    {
        return Err("A plain suggested filename is required.".into());
    }
    Ok(name)
}

pub fn choose_files(choice: FileChoice) -> Result<Vec<PathBuf>, String> {
    let extensions = read_extensions(&choice.purpose)?;
    let dialog = rfd::FileDialog::new()
        .set_title("Open audio or project files")
        .add_filter("Soundscaper files", &extensions);
    let paths: Vec<PathBuf> = if choice.multiple {
        dialog.pick_files().unwrap_or_default()
    } else {
        dialog.pick_file().into_iter().collect()
    };
    if paths.iter().any(|path| {
        !path
            .extension()
            .and_then(|extension| extension.to_str())
            .is_some_and(|extension| extensions.contains(&extension.to_lowercase().as_str()))
    }) {
        return Err("The selected file does not match this open purpose.".into());
    }
    Ok(paths)
}

pub fn choose_target(choice: SaveChoice) -> Result<Option<PathBuf>, String> {
    Ok(rfd::FileDialog::new()
        .set_title("Save from Soundscaper Tauri Prototype")
        .set_file_name(save_name(&choice)?)
        .save_file())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn file_purposes_cannot_grant_general_filesystem_access() {
        assert!(read_extensions("audio").unwrap().contains(&"wav"));
        assert!(read_extensions("project").unwrap().contains(&"sscape"));
        assert!(read_extensions("arbitrary").is_err());
        assert!(
            serde_json::from_str::<FileChoice>(r#"{"purpose":"audio","path":"/etc/passwd"}"#)
                .is_err()
        );
    }

    #[test]
    fn suggested_names_cannot_supply_a_path() {
        for name in ["../test.wav", "C:\\test.wav", "..", "a\0.wav", ""] {
            assert!(
                save_name(&SaveChoice {
                    purpose: "audio".into(),
                    suggested_name: name.into()
                })
                .is_err()
            );
        }
        assert_eq!(
            save_name(&SaveChoice {
                purpose: "project".into(),
                suggested_name: "Project.sscape".into()
            })
            .unwrap(),
            "Project.sscape"
        );
    }
}
