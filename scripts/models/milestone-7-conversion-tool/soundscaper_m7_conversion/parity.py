# SPDX-License-Identifier: AGPL-3.0-only

"""Strict source-framework/ONNX parity comparison and evidence emission."""

from __future__ import annotations

import math
from pathlib import Path
import struct

from .contract import (
    ContractError, exact_record, read_json, relative_path, sha256_file,
    verify_file, write_json_exclusive,
)

MAX_RUN_BYTES = 2 * 1024**3


def create_parity_evidence(root: Path, args, spec: dict) -> dict:
    fixture_path = relative_path(root, args.fixture, "parity fixture")
    fixture_id, fixture_length, fixture_sha256 = spec["fixture"]
    verify_file(fixture_path, fixture_length, fixture_sha256, "parity fixture")
    validate_fixture_format(fixture_path, args.candidate)
    converted = converted_manifest(root, args.converted_manifest, args.candidate,
                                   args.plan_sha256, spec)
    runs_root = run_directory(root, args.source_runs)
    runs = []
    identities = {}
    for framework in spec["frameworks"]:
        outputs = []
        for role in spec["roles"]:
            kind = output_kind(role)
            path = run_output(runs_root, framework, role, kind)
            identity = inspect_run(path, kind, f"{framework} {role}", spec["counts"].get(role))
            identities[(framework, role)] = identity
            outputs.append({"role": role, "byteLength": identity["byteLength"],
                            "sha256": identity["sha256"]})
        runs.append({"framework": framework, "outputs": outputs})
    comparisons = []
    for baseline, candidate, role, metric, maximum in spec["comparisons"]:
        left = identities[(baseline, role)]
        right = identities[(candidate, role)]
        observed = compare(left["path"], right["path"], metric)
        if not math.isfinite(observed) or observed < 0 or observed > maximum:
            raise ContractError(
                f"Parity failed for {candidate} {role}: {observed!r} exceeds {maximum!r}.")
        comparisons.append({
            "baseline": baseline, "candidate": candidate, "outputRole": role,
            "metric": metric, "maximum": maximum, "observed": observed,
        })
    evidence = {
        "schemaVersion": 1,
        "candidateId": args.candidate,
        "fixtureId": fixture_id,
        "recipeVersion": 1,
        "convertedArtifacts": [
            {"role": row["role"], "byteLength": row["byteLength"], "sha256": row["sha256"]}
            for row in converted
        ],
        "runs": runs,
        "comparisons": comparisons,
    }
    write_json_exclusive(root, args.evidence, evidence, "parity evidence")
    return evidence


def converted_manifest(root: Path, value: str, candidate_id: str, plan: str, spec: dict) -> list:
    path = relative_path(root, value, "converted manifest")
    manifest = exact_record(read_json(root, value, "converted manifest"),
                            ("schemaVersion", "candidateId", "planSha256", "artifacts"),
                            "converted manifest")
    if (manifest["schemaVersion"] != 1 or manifest["candidateId"] != candidate_id
            or manifest["planSha256"] != plan):
        raise ContractError("The converted manifest changed its conversion identity.")
    rows = manifest["artifacts"]
    if not isinstance(rows, list) or len(rows) != len(spec["outputs"]):
        raise ContractError("The converted artifact inventory is not exact.")
    admitted = []
    for row, expected in zip(rows, spec["outputs"], strict=True):
        item = exact_record(row, ("role", "required", "fileName", "byteLength", "sha256"),
                            "converted artifact")
        role, required, file_name = expected
        if item["role"] != role or item["required"] is not required or item["fileName"] != file_name:
            raise ContractError("A converted artifact changed its exact role or file name.")
        artifact_path = path.parent / file_name
        if artifact_path.parent.resolve() != path.parent or artifact_path.resolve() != artifact_path:
            raise ContractError("A converted artifact escaped its authenticated manifest directory.")
        identity = verify_file(artifact_path, item["byteLength"], item["sha256"],
                               f"{role} converted artifact")
        admitted.append({"role": role, "required": required, "fileName": file_name, **identity})
    return admitted


def run_directory(root: Path, value: str) -> Path:
    if not isinstance(value, str) or not value or "\\" in value or "\0" in value:
        raise ContractError("The source-framework run directory is invalid.")
    path = root.joinpath(*Path(value).parts)
    if path.resolve() != path or root not in (path, *path.parents) or not path.is_dir():
        raise ContractError("The source-framework run directory is unavailable or non-canonical.")
    return path


def run_output(root: Path, framework: str, role: str, kind: str) -> Path:
    suffix = "f32le" if kind == "float32" else "i64le"
    path = root / framework / f"{role}.{suffix}"
    try:
        info = path.lstat()
    except FileNotFoundError as error:
        raise ContractError(f"The {framework} {role} parity output is missing.") from error
    if path.resolve() != path or not path.is_file() or info.st_size < 1 or info.st_size > MAX_RUN_BYTES:
        raise ContractError(f"The {framework} {role} parity output file is invalid.")
    return path


def inspect_run(path: Path, kind: str, label: str, expected_count: int | None) -> dict:
    width = 4 if kind == "float32" else 8
    byte_length = path.stat().st_size
    if byte_length % width != 0:
        raise ContractError(f"The {label} parity output has incomplete {kind} values.")
    if expected_count is not None and byte_length != expected_count * width:
        raise ContractError(f"The {label} parity output changed its fixture-bound tensor geometry.")
    format_code = "<f" if kind == "float32" else "<q"
    previous = None
    with path.open("rb") as source:
        while chunk := source.read(4 * 1024 * 1024):
            for (value,) in struct.iter_unpack(format_code, chunk):
                if kind == "float32" and not math.isfinite(value):
                    raise ContractError(f"The {label} parity output must contain finite Float32 values.")
                if kind == "int64" and previous is not None and value <= previous:
                    raise ContractError(f"The {label} parity indexes must be strictly ordered and unique.")
                previous = value
    return {"path": path, "byteLength": byte_length, "sha256": sha256_file(path)}


def compare(left: Path, right: Path, metric: str) -> float:
    if left.stat().st_size != right.stat().st_size:
        if metric == "symmetric-index-difference":
            return float(len(read_indexes(left) ^ read_indexes(right)))
        raise ContractError("Float parity outputs changed their exact tensor byte geometry.")
    if metric == "maximum-absolute-error":
        maximum = 0.0
        with left.open("rb") as left_file, right.open("rb") as right_file:
            while left_chunk := left_file.read(4 * 1024 * 1024):
                right_chunk = right_file.read(len(left_chunk))
                if len(right_chunk) != len(left_chunk):
                    raise ContractError("Float parity outputs ended at different positions.")
                for (left_value,), (right_value,) in zip(
                        struct.iter_unpack("<f", left_chunk),
                        struct.iter_unpack("<f", right_chunk), strict=True):
                    maximum = max(maximum, abs(left_value - right_value))
        return maximum
    if metric == "symmetric-index-difference":
        return float(len(read_indexes(left) ^ read_indexes(right)))
    raise ContractError("The parity comparison metric is unsupported.")


def read_indexes(path: Path) -> set[int]:
    values = set()
    with path.open("rb") as source:
        while chunk := source.read(4 * 1024 * 1024):
            values.update(value for (value,) in struct.iter_unpack("<q", chunk))
    return values


def output_kind(role: str) -> str:
    return "int64" if role in ("beat-points", "downbeat-points", "boundaries") else "float32"


def validate_fixture_format(path: Path, candidate_id: str) -> None:
    with path.open("rb") as source:
        prefix = source.read(64)
    if candidate_id == "transnetv2":
        if not prefix.startswith(b"soundscaper-m7-parity-rgb24-v1\n"):
            raise ContractError("The TransNetV2 parity fixture header is invalid.")
        return
    if (prefix[:4] != b"RIFF" or prefix[8:12] != b"WAVE" or prefix[12:16] != b"fmt "
            or struct.unpack_from("<H", prefix, 20)[0] != 3
            or struct.unpack_from("<H", prefix, 34)[0] != 32 or prefix[36:40] != b"data"):
        raise ContractError("The audio parity fixture is not canonical Float32 RIFF/WAV.")
