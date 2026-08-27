# SPDX-License-Identifier: AGPL-3.0-only

"""Offline authenticated source-framework and ONNX parity execution."""

from __future__ import annotations

from pathlib import Path

from .contract import (
    ContractError, extracted_source, relative_path, validate_source_manifest, verify_file,
)
from .parity import converted_manifest, create_parity_evidence
from .runner_io import directory_destination, inspect_fixture, publish_framework_runs
from .toolchain import authenticate_toolchain_lock, validate_installed_toolchain

RUNNER_INVENTORY = {
    "tiger-dnr-neural-core": {
        "runner": "tiger-dnr-neural-core-v1", "fixtureKind": "float32-wave",
        "sourceFrameworks": ["source-pytorch"], "onnxFramework": "onnxruntime-cpu",
    },
    "panns-cnn10": {
        "runner": "panns-cnn10-v1", "fixtureKind": "float32-wave",
        "sourceFrameworks": ["source-pytorch"], "onnxFramework": "onnxruntime-cpu",
    },
    "beat-this": {
        "runner": "beat-this-small0-v1", "fixtureKind": "float32-wave",
        "sourceFrameworks": ["source-pytorch"], "onnxFramework": "onnxruntime-cpu",
    },
    "transnetv2": {
        "runner": "transnetv2-v1", "fixtureKind": "rgb24-vfr",
        "sourceFrameworks": ["source-tensorflow", "source-pytorch"],
        "onnxFramework": "onnxruntime-cpu",
    },
}


def run_authenticated_parity(root: Path, arguments, spec: dict) -> dict:
    """Authenticate the complete input closure, execute, publish, and compare it."""
    if arguments.candidate not in RUNNER_INVENTORY:
        raise ContractError("The parity runner candidate is unsupported.")
    fixture_path = relative_path(root, arguments.fixture, "parity fixture")
    fixture_id, fixture_length, fixture_sha256 = spec["fixture"]
    del fixture_id
    verify_file(fixture_path, fixture_length, fixture_sha256, "parity fixture")
    inspected = inspect_fixture(fixture_path, arguments.candidate, spec)
    if inspected["kind"] != RUNNER_INVENTORY[arguments.candidate]["fixtureKind"]:
        raise ContractError("The parity fixture kind changed runner authority.")
    converted_rows = converted_manifest(root, arguments.converted_manifest,
                                        arguments.candidate, arguments.plan_sha256, spec)
    admitted = validate_source_manifest(root, arguments.source_manifest,
                                        arguments.candidate, arguments.plan_sha256, spec)
    authenticate_toolchain_lock(root, arguments.toolchain_lock,
                                arguments.toolchain_sha256)
    destination = directory_destination(root, arguments.source_runs)
    if destination.exists() or destination.is_symlink():
        raise ContractError("The source-framework run directory already exists.")
    evidence = relative_path(root, arguments.evidence, "parity evidence", must_exist=False)
    if evidence.exists() or evidence.is_symlink():
        raise ContractError("The parity evidence already exists and is never overwritten.")
    converted = {row["role"]: row["path"] for row in converted_rows}
    artifacts = {row["role"]: row["path"] for row in admitted["artifacts"]}
    with extracted_source(root, admitted["archive"]["path"]) as source_root:
        validate_installed_toolchain(arguments.candidate)
        for row in admitted["artifacts"]:
            verify_file(row["path"], row["byteLength"], row["sha256"],
                        f"{row['role']} source artifact recheck")
        for row in converted_rows:
            verify_file(row["path"], row["byteLength"], row["sha256"],
                        f"{row['role']} converted artifact recheck")
        runs = execute_candidate(arguments.candidate, source_root, artifacts,
                                 converted, fixture_path, spec)
    publish_framework_runs(root, arguments.source_runs, runs, spec)
    return create_parity_evidence(root, arguments, spec)


def execute_candidate(candidate_id: str, source_root: Path, artifacts: dict,
                      converted: dict, fixture: Path, spec: dict) -> dict:
    """Import only the admitted candidate adapter after custody and lock checks."""
    if candidate_id == "transnetv2":
        from .runner_video import run_transnet
        return run_transnet(source_root, artifacts, converted, fixture, spec)
    from .runner_audio import run_beat, run_panns, run_tiger
    if candidate_id == "tiger-dnr-neural-core":
        return run_tiger(source_root, artifacts, converted, fixture, spec)
    if candidate_id == "panns-cnn10":
        return run_panns(source_root, artifacts, converted, fixture, spec)
    if candidate_id == "beat-this":
        return run_beat(source_root, artifacts, converted, fixture, spec)
    raise ContractError("The parity runner candidate is unsupported.")
