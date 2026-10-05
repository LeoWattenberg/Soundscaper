// SPDX-License-Identifier: AGPL-3.0-only

use super::*;
use std::fs;
use tempfile::TempDir;

fn exact(target: &TargetDescriptor, size: u64) -> BeginWriteRequest {
    BeginWriteRequest {
        target_id: target.id.clone(),
        size: Some(size),
        maximum_size: None,
        final_prefix_byte_length: None,
    }
}

fn chunk(write: &WriteDescriptor, offset: u64, bytes: &[u8]) -> WriteChunkRequest {
    WriteChunkRequest {
        write_id: write.write_id.clone(),
        offset,
        bytes: bytes.to_vec(),
    }
}

fn entries(directory: &TempDir) -> usize {
    fs::read_dir(directory.path()).unwrap().count()
}

#[test]
fn reads_are_opaque_bounded_and_revocable() {
    let directory = tempfile::tempdir().unwrap();
    let path = directory.path().join("example.wav");
    fs::write(&path, b"audio").unwrap();
    let mut files = FileCapabilities::default();
    let descriptor = files.register_read(&path).unwrap();
    assert_eq!(descriptor.name, "example.wav");
    assert_eq!(descriptor.size, 5);
    assert_eq!(descriptor.mime_type, "audio/wav");
    assert_eq!(descriptor.read_profile, "materialized-v1");
    assert!(!descriptor.id.contains("example"));
    assert_eq!(files.read(&descriptor.id, 1, 3).unwrap(), b"udi");
    assert!(files.read(&descriptor.id, 0, CHUNK_SIZE + 1).is_err());
    assert!(files.read(&descriptor.id, 4, 2).is_err());
    assert!(files.read(&descriptor.id, u64::MAX, 1).is_err());
    assert!(files.read(path.to_str().unwrap(), 0, 1).is_err());
    assert!(files.revoke_read(&descriptor.id));
    assert!(files.read(&descriptor.id, 0, 1).is_err());
}

#[test]
fn registers_scape_ranges_and_rejects_unsupported_or_oversized_files() {
    let directory = tempfile::tempdir().unwrap();
    let path = directory.path().join("session.sscape");
    fs::write(&path, b"project").unwrap();
    let mut files = FileCapabilities::default();
    let descriptor = files.register_read(&path).unwrap();
    assert_eq!(descriptor.read_profile, "scape-range-v1");
    assert_eq!(
        descriptor.mime_type,
        "application/vnd.soundscaper.scape+zip"
    );
    let unsupported = directory.path().join("script.sh");
    fs::write(&unsupported, b"ignored").unwrap();
    assert!(files.register_read(&unsupported).is_err());
    assert!(files.register_read(directory.path()).is_err());
    let large = directory.path().join("large.wav");
    File::create(&large)
        .unwrap()
        .set_len(MAX_FILE_SIZE + 1)
        .unwrap();
    assert!(files.register_read(&large).is_err());
}

#[test]
fn chooser_audio_aliases_and_project_formats_have_renderer_profiles() {
    let directory = tempfile::tempdir().unwrap();
    let mut files = FileCapabilities::default();
    for (extension, mime) in [
        ("oga", "audio/ogg"),
        ("opus", "audio/ogg; codecs=opus"),
        ("wv", "audio/x-wavpack"),
        ("wavpack", "audio/wavpack"),
        ("rf64", "audio/rf64"),
        ("bw64", "audio/bw64"),
        ("aup", "application/xml"),
        ("aup4", "application/vnd.audacity.aup4"),
        ("dawproject", "application/zip"),
    ] {
        let path = directory.path().join(format!("selected.{extension}"));
        fs::write(&path, b"fixture").unwrap();
        let descriptor = files.register_read(&path).unwrap();
        assert_eq!(descriptor.mime_type, mime, "{extension}");
        assert_eq!(descriptor.read_profile, "materialized-v1", "{extension}");
    }
    for extension in ["sscape", "fscape", "liscape", "scape", "FSCAPE"] {
        let path = directory.path().join(format!("selected.{extension}"));
        fs::write(&path, b"fixture").unwrap();
        let descriptor = files.register_read(&path).unwrap();
        assert_eq!(
            descriptor.mime_type,
            "application/vnd.soundscaper.scape+zip"
        );
        assert_eq!(descriptor.read_profile, "scape-range-v1", "{extension}");
    }
}

#[cfg(unix)]
#[test]
fn reads_keep_the_opened_file_when_its_path_is_replaced() {
    let directory = tempfile::tempdir().unwrap();
    let path = directory.path().join("example.aiff");
    fs::write(&path, b"original").unwrap();
    let mut files = FileCapabilities::default();
    let descriptor = files.register_read(&path).unwrap();
    fs::rename(&path, directory.path().join("moved.aiff")).unwrap();
    fs::write(&path, b"replacement").unwrap();
    assert_eq!(files.read(&descriptor.id, 0, 8).unwrap(), b"original");
}

#[test]
fn exact_save_replaces_target_only_after_finish() {
    let directory = tempfile::tempdir().unwrap();
    let path = directory.path().join("mix.wav");
    fs::write(&path, b"old").unwrap();
    let mut files = FileCapabilities::default();
    let target = files.register_target(&path).unwrap();
    let write = files.begin_write(exact(&target, 5)).unwrap();
    assert_eq!(write.chunk_size, CHUNK_SIZE);
    assert!(files.begin_write(exact(&target, 5)).is_err());
    assert_eq!(
        files
            .write_chunk(chunk(&write, 0, b"new"))
            .unwrap()
            .next_offset,
        3
    );
    assert_eq!(fs::read(&path).unwrap(), b"old");
    files.write_chunk(chunk(&write, 3, b"er")).unwrap();
    assert_eq!(files.finish(&write.write_id).unwrap().byte_length, 5);
    assert_eq!(fs::read(&path).unwrap(), b"newer");
    assert_eq!(entries(&directory), 1);
    assert!(files.finish(&write.write_id).is_err());
}

#[test]
fn maximum_save_can_finish_short_and_zero_size_save_is_valid() {
    let directory = tempfile::tempdir().unwrap();
    let path = directory.path().join("session.sscape");
    let mut files = FileCapabilities::default();
    let target = files.register_target(&path).unwrap();
    let write = files
        .begin_write(BeginWriteRequest {
            target_id: target.id,
            size: None,
            maximum_size: Some(50),
            final_prefix_byte_length: None,
        })
        .unwrap();
    files.write_chunk(chunk(&write, 0, b"zip")).unwrap();
    assert_eq!(files.finish(&write.write_id).unwrap().byte_length, 3);
    let target = files.register_target(&path).unwrap();
    let write = files.begin_write(exact(&target, 0)).unwrap();
    files.finish(&write.write_id).unwrap();
    assert_eq!(fs::read(path).unwrap(), b"");
}

#[test]
fn invalid_save_sizes_do_not_create_temporary_files() {
    let directory = tempfile::tempdir().unwrap();
    let mut files = FileCapabilities::default();
    let target = files
        .register_target(directory.path().join("mix.wav"))
        .unwrap();
    for (size, maximum_size) in [
        (None, None),
        (Some(1), Some(1)),
        (Some(MAX_FILE_SIZE + 1), None),
    ] {
        let request = BeginWriteRequest {
            size,
            maximum_size,
            ..exact(&target, 0)
        };
        assert!(files.begin_write(request).is_err());
    }
    assert_eq!(entries(&directory), 0);
}

#[test]
fn failed_save_cleans_temporary_file_and_preserves_destination() {
    let directory = tempfile::tempdir().unwrap();
    let path = directory.path().join("mix.wav");
    fs::write(&path, b"old").unwrap();
    let mut files = FileCapabilities::default();
    for failure in ["offset", "overflow", "incomplete", "chunk"] {
        let target = files.register_target(&path).unwrap();
        let write = files.begin_write(exact(&target, 4)).unwrap();
        let result = match failure {
            "offset" => files.write_chunk(chunk(&write, 1, b"x")).map(|_| ()),
            "overflow" => files.write_chunk(chunk(&write, 0, b"12345")).map(|_| ()),
            "chunk" => files
                .write_chunk(chunk(&write, 0, &vec![0; CHUNK_SIZE + 1]))
                .map(|_| ()),
            _ => files.finish(&write.write_id).map(|_| ()),
        };
        assert!(result.is_err(), "{failure}");
        assert!(!files.abort(&write.write_id));
        assert_eq!(fs::read(&path).unwrap(), b"old");
        assert_eq!(entries(&directory), 1);
    }
}

#[test]
fn final_prefix_is_required_and_patched_after_sequential_writes() {
    let directory = tempfile::tempdir().unwrap();
    let path = directory.path().join("mix.wav");
    let mut files = FileCapabilities::default();
    let target = files.register_target(&path).unwrap();
    let write = files
        .begin_write(BeginWriteRequest {
            final_prefix_byte_length: Some(32),
            ..exact(&target, 36)
        })
        .unwrap();
    files.write_chunk(chunk(&write, 0, &[0; 32])).unwrap();
    files.write_chunk(chunk(&write, 32, b"body")).unwrap();
    let patched = files
        .patch_final_prefix(PatchPrefixRequest {
            write_id: write.write_id.clone(),
            bytes: vec![7; 32],
        })
        .unwrap();
    assert_eq!(patched.byte_length, 32);
    files.finish(&write.write_id).unwrap();
    assert_eq!(
        fs::read(path).unwrap(),
        [vec![7; 32], b"body".to_vec()].concat()
    );
}

#[test]
fn missing_or_premature_prefix_patch_aborts_save() {
    let directory = tempfile::tempdir().unwrap();
    let path = directory.path().join("mix.wav");
    let mut files = FileCapabilities::default();
    for premature in [true, false] {
        let target = files.register_target(&path).unwrap();
        let write = files
            .begin_write(BeginWriteRequest {
                final_prefix_byte_length: Some(32),
                ..exact(&target, 32)
            })
            .unwrap();
        if premature {
            assert!(
                files
                    .patch_final_prefix(PatchPrefixRequest {
                        write_id: write.write_id,
                        bytes: vec![7; 32]
                    })
                    .is_err()
            );
        } else {
            files.write_chunk(chunk(&write, 0, &[0; 32])).unwrap();
            assert!(files.finish(&write.write_id).is_err());
        }
        assert_eq!(entries(&directory), 0);
    }
}

#[test]
fn abort_target_revocation_and_drop_remove_unpublished_files() {
    let directory = tempfile::tempdir().unwrap();
    let path = directory.path().join("mix.wav");
    let mut files = FileCapabilities::default();
    let target = files.register_target(&path).unwrap();
    let write = files.begin_write(exact(&target, 1)).unwrap();
    assert!(files.abort(&write.write_id));
    assert_eq!(entries(&directory), 0);
    let target = files.register_target(&path).unwrap();
    let write = files.begin_write(exact(&target, 1)).unwrap();
    assert!(files.revoke_target(&target.id));
    assert!(files.write_chunk(chunk(&write, 0, b"a")).is_err());
    assert_eq!(entries(&directory), 0);
    let target = files.register_target(&path).unwrap();
    files.begin_write(exact(&target, 1)).unwrap();
    drop(files);
    assert_eq!(entries(&directory), 0);
}

#[test]
fn capability_capacity_and_global_revocation_are_bounded() {
    let directory = tempfile::tempdir().unwrap();
    let path = directory.path().join("mix.wav");
    fs::write(&path, b"a").unwrap();
    let mut files = FileCapabilities::default();
    let mut read_ids = Vec::new();
    for _ in 0..MAX_CAPABILITIES {
        read_ids.push(files.register_read(&path).unwrap().id);
        files.register_target(&path).unwrap();
    }
    assert!(files.register_read(&path).is_err());
    assert!(files.register_target(&path).is_err());
    files.revoke_all();
    for id in read_ids {
        assert!(files.read(&id, 0, 1).is_err());
    }
    assert!(files.register_read(&path).is_ok());
    assert!(files.register_target(&path).is_ok());
}

#[test]
fn active_save_capacity_and_global_revocation_clean_every_temporary_file() {
    let directory = tempfile::tempdir().unwrap();
    let path = directory.path().join("mix.wav");
    let mut files = FileCapabilities::default();
    let mut write_ids = Vec::new();
    for _ in 0..MAX_CAPABILITIES {
        let target = files.register_target(&path).unwrap();
        write_ids.push(files.begin_write(exact(&target, 0)).unwrap().write_id);
    }
    let target = files.register_target(&path).unwrap();
    assert!(files.begin_write(exact(&target, 0)).is_err());
    assert_eq!(entries(&directory), MAX_CAPABILITIES);
    files.revoke_all();
    for id in write_ids {
        assert!(files.finish(&id).is_err());
    }
    assert_eq!(entries(&directory), 0);
}

#[test]
fn publication_failure_cleans_the_temporary_file() {
    let directory = tempfile::tempdir().unwrap();
    let path = directory.path().join("mix.wav");
    let mut files = FileCapabilities::default();
    let target = files.register_target(&path).unwrap();
    let write = files.begin_write(exact(&target, 3)).unwrap();
    files.write_chunk(chunk(&write, 0, b"new")).unwrap();
    // The destination became an occupied directory after the user's selection.
    fs::create_dir(&path).unwrap();
    fs::write(path.join("existing"), b"preserved").unwrap();
    assert!(files.finish(&write.write_id).is_err());
    assert_eq!(entries(&directory), 1);
    assert_eq!(fs::read(path.join("existing")).unwrap(), b"preserved");
}
