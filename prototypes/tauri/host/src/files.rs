// SPDX-License-Identifier: AGPL-3.0-only

//! Native-dialog capabilities and bounded file transactions for the prototype.
//! Paths enter only through native host code; renderer requests use opaque IDs.

use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fs::{self, File};
use std::io::{Read, Seek, SeekFrom, Write};
use std::path::{Path, PathBuf};
use tempfile::NamedTempFile;
use uuid::Uuid;

pub const CHUNK_SIZE: usize = 1024 * 1024;
pub const MAX_FILE_SIZE: u64 = 512 * 1024 * 1024;
const MAX_CAPABILITIES: usize = 128;
const FINAL_PREFIX_SIZE: usize = 32;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ReadDescriptor {
    pub id: String,
    pub name: String,
    pub size: u64,
    pub mime_type: String,
    pub read_profile: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TargetDescriptor {
    pub id: String,
    pub name: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct BeginWriteRequest {
    pub target_id: String,
    pub size: Option<u64>,
    pub maximum_size: Option<u64>,
    pub final_prefix_byte_length: Option<usize>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WriteDescriptor {
    pub write_id: String,
    pub chunk_size: usize,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct WriteChunkRequest {
    pub write_id: String,
    pub offset: u64,
    pub bytes: Vec<u8>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PatchPrefixRequest {
    pub write_id: String,
    pub bytes: Vec<u8>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WriteProgress {
    pub next_offset: u64,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ByteLength {
    pub byte_length: u64,
}

struct ReadCapability {
    file: File,
    size: u64,
}

struct WriteSession {
    target_id: String,
    path: PathBuf,
    temporary: NamedTempFile,
    limit: u64,
    exact: bool,
    written: u64,
    requires_prefix: bool,
    patched: bool,
}

#[derive(Default)]
pub struct FileCapabilities {
    reads: HashMap<String, ReadCapability>,
    targets: HashMap<String, PathBuf>,
    sessions: HashMap<String, WriteSession>,
}

impl FileCapabilities {
    pub fn register_read(&mut self, path: impl AsRef<Path>) -> Result<ReadDescriptor, String> {
        capacity(self.reads.len())?;
        let path = path.as_ref();
        let (mime_type, read_profile) = read_format(path)?;
        let file = File::open(path).map_err(|_| "Could not open the selected file.")?;
        let metadata = file
            .metadata()
            .map_err(|_| "Could not inspect the selected file.")?;
        if !metadata.is_file() || metadata.len() > MAX_FILE_SIZE {
            return Err("Select a regular audio/project file no larger than 512 MiB.".into());
        }
        let descriptor = ReadDescriptor {
            id: new_id(),
            name: file_name(path)?,
            size: metadata.len(),
            mime_type: mime_type.into(),
            read_profile: read_profile.into(),
        };
        self.reads.insert(
            descriptor.id.clone(),
            ReadCapability {
                file,
                size: metadata.len(),
            },
        );
        Ok(descriptor)
    }

    pub fn read(&mut self, id: &str, offset: u64, length: usize) -> Result<Vec<u8>, String> {
        let capability = self
            .reads
            .get_mut(id)
            .ok_or("The selected file capability expired.")?;
        if length > CHUNK_SIZE
            || offset > capability.size
            || length as u64 > capability.size - offset
        {
            return Err("The requested file range exceeds its bounds.".into());
        }
        let mut bytes = vec![0; length];
        capability
            .file
            .seek(SeekFrom::Start(offset))
            .and_then(|_| capability.file.read_exact(&mut bytes))
            .map_err(|_| "Could not read the selected file range.")?;
        Ok(bytes)
    }

    pub fn revoke_read(&mut self, id: &str) -> bool {
        self.reads.remove(id).is_some()
    }

    pub fn register_target(&mut self, path: impl AsRef<Path>) -> Result<TargetDescriptor, String> {
        capacity(self.targets.len())?;
        let path = path.as_ref();
        if !path.is_absolute() {
            return Err("The native save dialog must select an absolute destination.".into());
        }
        let name = file_name(path)?;
        let directory = path
            .parent()
            .ok_or("The destination has no parent directory.")?;
        let directory =
            fs::canonicalize(directory).map_err(|_| "The destination directory is unavailable.")?;
        if !directory.is_dir() {
            return Err("The destination parent is not a directory.".into());
        }
        let path = directory.join(
            path.file_name()
                .ok_or("The destination has no file name.")?,
        );
        match fs::symlink_metadata(&path) {
            Ok(metadata) if !metadata.is_file() => {
                return Err("Select a regular-file destination.".into());
            }
            Err(error) if error.kind() != std::io::ErrorKind::NotFound => {
                return Err("Could not inspect the selected destination.".into());
            }
            _ => {}
        }
        let descriptor = TargetDescriptor { id: new_id(), name };
        self.targets.insert(descriptor.id.clone(), path);
        Ok(descriptor)
    }

    pub fn revoke_target(&mut self, id: &str) -> bool {
        let removed = self.targets.remove(id).is_some();
        let previous = self.sessions.len();
        self.sessions.retain(|_, session| session.target_id != id);
        removed || previous != self.sessions.len()
    }

    pub fn revoke_all(&mut self) {
        self.reads.clear();
        self.targets.clear();
        self.sessions.clear();
    }

    pub fn begin_write(&mut self, request: BeginWriteRequest) -> Result<WriteDescriptor, String> {
        capacity(self.sessions.len())?;
        let (limit, exact) = match (request.size, request.maximum_size) {
            (Some(size), None) => (size, true),
            (None, Some(maximum)) => (maximum, false),
            _ => return Err("Declare exactly one exact size or maximum size.".into()),
        };
        if limit > MAX_FILE_SIZE {
            return Err("Prototype saves are limited to 512 MiB.".into());
        }
        let requires_prefix = request.final_prefix_byte_length.is_some();
        if requires_prefix
            && (request.final_prefix_byte_length != Some(FINAL_PREFIX_SIZE)
                || !exact
                || limit < FINAL_PREFIX_SIZE as u64)
        {
            return Err("A final prefix requires an exact-size save of at least 32 bytes and a 32-byte prefix.".into());
        }
        let path = self
            .targets
            .get(&request.target_id)
            .ok_or("The save target expired or was already used.")?;
        let directory = path
            .parent()
            .ok_or("The destination has no parent directory.")?;
        let temporary = tempfile::Builder::new()
            .prefix(".soundscaper-")
            .suffix(".part")
            .tempfile_in(directory)
            .map_err(|_| "Could not create a temporary file beside the destination.")?;
        let descriptor = WriteDescriptor {
            write_id: new_id(),
            chunk_size: CHUNK_SIZE,
        };
        let session = WriteSession {
            target_id: request.target_id.clone(),
            path: path.clone(),
            temporary,
            limit,
            exact,
            written: 0,
            requires_prefix,
            patched: false,
        };
        self.targets.remove(&request.target_id);
        self.sessions.insert(descriptor.write_id.clone(), session);
        Ok(descriptor)
    }

    pub fn write_chunk(&mut self, request: WriteChunkRequest) -> Result<WriteProgress, String> {
        self.with_session(&request.write_id, |session| {
            if request.offset != session.written
                || request.bytes.len() > CHUNK_SIZE
                || request.bytes.len() as u64 > session.limit - session.written
                || session.patched
            {
                return Err("The save chunk exceeds its bound or is out of sequence.".into());
            }
            session
                .temporary
                .write_all(&request.bytes)
                .map_err(|_| "Could not write the save chunk.")?;
            session.written += request.bytes.len() as u64;
            Ok(WriteProgress {
                next_offset: session.written,
            })
        })
    }

    pub fn patch_final_prefix(
        &mut self,
        request: PatchPrefixRequest,
    ) -> Result<ByteLength, String> {
        self.with_session(&request.write_id, |session| {
            if !session.requires_prefix || session.patched || session.written != session.limit
                || request.bytes.len() != FINAL_PREFIX_SIZE {
                return Err("Patch the declared 32-byte prefix once, after all sequential bytes are written.".into());
            }
            session.temporary.seek(SeekFrom::Start(0))
                .and_then(|_| session.temporary.write_all(&request.bytes))
                .map_err(|_| "Could not patch the final prefix.")?;
            session.patched = true;
            Ok(ByteLength { byte_length: FINAL_PREFIX_SIZE as u64 })
        })
    }

    pub fn finish(&mut self, write_id: &str) -> Result<ByteLength, String> {
        let session = self
            .sessions
            .remove(write_id)
            .ok_or("The save session expired.")?;
        if (session.exact && session.written != session.limit)
            || (session.requires_prefix && !session.patched)
        {
            return Err("The save is incomplete; its destination was preserved.".into());
        }
        session
            .temporary
            .as_file()
            .sync_all()
            .map_err(|_| "Could not sync the temporary save file.")?;
        session
            .temporary
            .persist(&session.path)
            .map_err(|_| "Could not atomically publish the save file.")?;
        Ok(ByteLength {
            byte_length: session.written,
        })
    }

    pub fn abort(&mut self, write_id: &str) -> bool {
        self.sessions.remove(write_id).is_some()
    }

    fn with_session<T>(
        &mut self,
        id: &str,
        operation: impl FnOnce(&mut WriteSession) -> Result<T, String>,
    ) -> Result<T, String> {
        // Ownership makes every error path drop the unpublished temporary file.
        let mut session = self
            .sessions
            .remove(id)
            .ok_or("The save session expired.")?;
        let result = operation(&mut session)?;
        self.sessions.insert(id.to_owned(), session);
        Ok(result)
    }
}

fn capacity(count: usize) -> Result<(), String> {
    if count >= MAX_CAPABILITIES {
        Err("The prototype file capability limit was reached.".into())
    } else {
        Ok(())
    }
}

fn new_id() -> String {
    Uuid::new_v4().to_string()
}

fn file_name(path: &Path) -> Result<String, String> {
    path.file_name()
        .map(|name| name.to_string_lossy().into_owned())
        .filter(|name| !name.is_empty())
        .ok_or_else(|| "Select a named file.".into())
}

fn read_format(path: &Path) -> Result<(&'static str, &'static str), String> {
    let extension = path
        .extension()
        .and_then(|value| value.to_str())
        .unwrap_or("")
        .to_ascii_lowercase();
    let mime = match extension.as_str() {
        "sscape" | "fscape" | "liscape" | "scape" => {
            return Ok(("application/vnd.soundscaper.scape+zip", "scape-range-v1"));
        }
        "wav" | "wave" => "audio/wav",
        "aif" | "aiff" | "aifc" => "audio/aiff",
        "flac" => "audio/flac",
        "mp2" | "mp3" => "audio/mpeg",
        "ogg" | "oga" => "audio/ogg",
        "opus" => "audio/ogg; codecs=opus",
        "m4a" => "audio/mp4",
        "aac" => "audio/aac",
        "wv" => "audio/x-wavpack",
        "wavpack" => "audio/wavpack",
        "rf64" => "audio/rf64",
        "bw64" => "audio/bw64",
        "aup" => "application/xml",
        "aup3" => "application/x-audacity-project",
        "aup4" => "application/vnd.audacity.aup4",
        "dawproject" => "application/zip",
        _ => {
            return Err(
                "This prototype opens supported audio and Soundscaper/Audacity project files."
                    .into(),
            );
        }
    };
    Ok((mime, "materialized-v1"))
}

#[cfg(test)]
#[path = "files_tests.rs"]
mod tests;
