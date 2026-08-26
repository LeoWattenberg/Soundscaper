# SPDX-License-Identifier: AGPL-3.0-only

"""Bounded filesystem, manifest, and archive custody for the offline tool."""

from __future__ import annotations

import hashlib
import json
import os
from pathlib import Path, PurePosixPath
import stat
import tarfile
import tempfile

from .specs import PROTOCOL

SHA256_LENGTH = 64
MAX_JSON_BYTES = 8 * 1024 * 1024
MAX_ARCHIVE_BYTES = 4 * 1024**3
MAX_EXTRACTED_BYTES = 8 * 1024**3
MAX_ARCHIVE_MEMBERS = 50_000
POLICY_ENVIRONMENT = {
    "CUBLAS_WORKSPACE_CONFIG": ":4096:8",
    "CUDA_VISIBLE_DEVICES": "",
    "MKL_NUM_THREADS": "1",
    "OMP_NUM_THREADS": "1",
    "OPENBLAS_NUM_THREADS": "1",
    "PYTHONHASHSEED": "0",
    "TF_DETERMINISTIC_OPS": "1",
}


class ContractError(RuntimeError):
    """A closed conversion-protocol contract was not satisfied."""


def validate_policy_environment() -> None:
    for name, expected in POLICY_ENVIRONMENT.items():
        if os.environ.get(name) != expected:
            raise ContractError(f"The deterministic environment variable {name} is invalid.")


def workspace() -> Path:
    root = Path.cwd()
    if not root.is_absolute() or not root.is_dir() or root.resolve() != root:
        raise ContractError("The conversion workspace must be one canonical directory.")
    return root


def relative_path(root: Path, value: str, label: str, must_exist: bool = True) -> Path:
    if not isinstance(value, str) or not value or len(value) > 512 or "\\" in value or "\0" in value:
        raise ContractError(f"The {label} path is invalid.")
    pure = PurePosixPath(value)
    if pure.is_absolute() or value != pure.as_posix() or any(part in ("", ".", "..") for part in pure.parts):
        raise ContractError(f"The {label} path must be normalized and workspace-relative.")
    path = root.joinpath(*pure.parts)
    if must_exist:
        try:
            info = path.lstat()
        except FileNotFoundError as error:
            raise ContractError(f"The {label} file is missing.") from error
        if not stat.S_ISREG(info.st_mode) or stat.S_ISLNK(info.st_mode) or path.resolve() != path:
            raise ContractError(f"The {label} must be one canonical regular file.")
    elif path.parent.resolve() != path.parent or root not in (path.parent, *path.parent.parents):
        raise ContractError(f"The {label} destination escaped the workspace.")
    return path


def read_json(root: Path, value: str, label: str) -> dict:
    path = relative_path(root, value, label)
    info = path.stat()
    if info.st_size < 2 or info.st_size > MAX_JSON_BYTES:
        raise ContractError(f"The {label} JSON is outside its byte bound.")
    try:
        parsed = json.loads(path.read_text(encoding="utf-8", errors="strict"))
    except (UnicodeError, json.JSONDecodeError) as error:
        raise ContractError(f"The {label} is malformed UTF-8 JSON.") from error
    if not isinstance(parsed, dict):
        raise ContractError(f"The {label} must be one JSON object.")
    return parsed


def exact_record(value, fields, label: str) -> dict:
    if not isinstance(value, dict) or set(value) != set(fields):
        raise ContractError(f"The {label} fields are invalid.")
    return value


def sha256_file(path: Path) -> str:
    return digest_file(path, "sha256")


def digest_file(path: Path, algorithm: str) -> str:
    digest = hashlib.new(algorithm)
    with path.open("rb") as source:
        while chunk := source.read(4 * 1024 * 1024):
            digest.update(chunk)
    return digest.hexdigest()


def verify_file(path: Path, byte_length: int, sha256: str, label: str) -> dict:
    if not isinstance(byte_length, int) or isinstance(byte_length, bool) or byte_length < 1:
        raise ContractError(f"The {label} byte length is invalid.")
    if not valid_sha256(sha256):
        raise ContractError(f"The {label} SHA-256 is invalid.")
    info = path.lstat()
    if not stat.S_ISREG(info.st_mode) or stat.S_ISLNK(info.st_mode) or info.st_size != byte_length:
        raise ContractError(f"The {label} changed file kind or byte length.")
    if sha256_file(path) != sha256:
        raise ContractError(f"The {label} failed SHA-256 authentication.")
    return {"path": path, "byteLength": byte_length, "sha256": sha256}


def validate_source_manifest(root: Path, path: str, candidate_id: str, plan: str, spec: dict) -> dict:
    manifest = exact_record(read_json(root, path, "source manifest"), (
        "schemaVersion", "protocol", "candidateId", "planSha256",
        "sourceCodeArchive", "sourceArtifacts",
    ), "source manifest")
    if (manifest["schemaVersion"] != 1 or manifest["protocol"] != PROTOCOL
            or manifest["candidateId"] != candidate_id or manifest["planSha256"] != plan):
        raise ContractError("The source manifest changed its protocol or conversion identity.")
    artifacts = manifest["sourceArtifacts"]
    if not isinstance(artifacts, list) or len(artifacts) != len(spec["artifacts"]):
        raise ContractError("The source artifact inventory is not exact.")
    admitted = []
    for row, expected in zip(artifacts, spec["artifacts"], strict=True):
        item = exact_record(row, ("role", "path", "byteLength", "sha256"), "source artifact")
        role, _required, file_name, byte_length, upstream_algorithm, upstream_digest = expected
        if item["role"] != role or PurePosixPath(item["path"]).name != file_name:
            raise ContractError("A source artifact changed its exact role or file name.")
        if item["byteLength"] != byte_length:
            raise ContractError(f"The {role} source artifact changed its pinned byte length.")
        file = verify_file(relative_path(root, item["path"], f"{role} source artifact"),
                           item["byteLength"], item["sha256"], f"{role} source artifact")
        if digest_file(file["path"], upstream_algorithm) != upstream_digest:
            raise ContractError(f"The {role} source artifact failed its upstream {upstream_algorithm} pin.")
        admitted.append({"role": role, **file})
    archive_row = exact_record(manifest["sourceCodeArchive"],
                               ("path", "revision", "byteLength", "sha256"), "source archive")
    if (archive_row["revision"] != spec["revision"]
            or PurePosixPath(archive_row["path"]).name != spec["archive"]
            or not isinstance(archive_row["byteLength"], int)
            or archive_row["byteLength"] < 1 or archive_row["byteLength"] > MAX_ARCHIVE_BYTES):
        raise ContractError("The source-code archive changed its pinned revision or identity.")
    archive = verify_file(relative_path(root, archive_row["path"], "source archive"),
                          archive_row["byteLength"], archive_row["sha256"], "source archive")
    return {"archive": archive, "artifacts": admitted}


def extracted_source(root: Path, archive: Path):
    """Return a temporary, link-free extraction context for one authenticated archive."""
    return ExtractedSource(root, archive)


class ExtractedSource:
    def __init__(self, root: Path, archive: Path):
        self._temporary = tempfile.TemporaryDirectory(prefix="m7-source-", dir=root)
        self._destination = Path(self._temporary.name)
        self.archive = archive
        self.source_root = self._destination

    def __enter__(self) -> Path:
        try:
            with tarfile.open(self.archive, mode="r:gz") as source:
                members = source.getmembers()
                if not members or len(members) > MAX_ARCHIVE_MEMBERS:
                    raise ContractError("The source archive member inventory is outside its bound.")
                total = 0
                names = set()
                for member in members:
                    normalized_name = member.name[:-1] if member.isdir() and member.name.endswith("/") \
                        else member.name
                    pure = PurePosixPath(normalized_name)
                    if (pure.is_absolute() or any(part in ("", ".", "..") for part in pure.parts)
                            or normalized_name != pure.as_posix() or normalized_name in names
                            or not (member.isdir() or member.isfile())):
                        raise ContractError("The source archive contains an unsafe or duplicate member.")
                    names.add(normalized_name)
                    total += member.size
                    if total > MAX_EXTRACTED_BYTES:
                        raise ContractError("The source archive exceeds its extracted byte budget.")
                for member in members:
                    normalized_name = member.name[:-1] if member.isdir() and member.name.endswith("/") \
                        else member.name
                    destination = self._destination.joinpath(*PurePosixPath(normalized_name).parts)
                    if member.isdir():
                        destination.mkdir(mode=0o700, parents=True, exist_ok=True)
                        continue
                    destination.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
                    reader = source.extractfile(member)
                    if reader is None:
                        raise ContractError("The source archive regular file cannot be read.")
                    with destination.open("xb") as output:
                        copied = 0
                        while chunk := reader.read(4 * 1024 * 1024):
                            copied += len(chunk)
                            if copied > member.size:
                                raise ContractError("A source archive member exceeded its declared size.")
                            output.write(chunk)
                    if copied != member.size:
                        raise ContractError("A source archive member ended before its declared size.")
            entries = list(self._destination.iterdir())
            if len(entries) == 1 and entries[0].is_dir():
                self.source_root = entries[0]
            return self.source_root
        except Exception:
            self._temporary.cleanup()
            raise

    def __exit__(self, _kind, _value, _traceback) -> None:
        self._temporary.cleanup()


def write_json_exclusive(root: Path, value: str, document: dict, label: str) -> Path:
    path = relative_path(root, value, label, must_exist=False)
    body = (json.dumps(document, sort_keys=True, separators=(",", ":"), allow_nan=False)
            + "\n").encode("utf-8")
    flags = os.O_WRONLY | os.O_CREAT | os.O_EXCL
    if hasattr(os, "O_NOFOLLOW"):
        flags |= os.O_NOFOLLOW
    try:
        descriptor = os.open(path, flags, 0o600)
    except FileExistsError as error:
        raise ContractError(f"The {label} already exists; evidence is never overwritten.") from error
    try:
        with os.fdopen(descriptor, "wb", closefd=False) as output:
            output.write(body)
            output.flush()
            os.fsync(output.fileno())
    finally:
        os.close(descriptor)
    return path


def valid_sha256(value) -> bool:
    return isinstance(value, str) and len(value) == SHA256_LENGTH and all(
        character in "0123456789abcdef" for character in value)
