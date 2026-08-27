# SPDX-License-Identifier: AGPL-3.0-only

"""Digest-bound dependency lock admission for offline conversion/parity runs."""

from __future__ import annotations

from importlib.metadata import PackageNotFoundError, version
from pathlib import Path
import platform
import tomllib

from .contract import ContractError, relative_path, sha256_file

TOOLCHAIN_LOCK_SHA256 = "388a9bdc8ccac14f5e16b0ea6cb2fb399c0af59b1dadd0385af7738d7ec139ef"
MAXIMUM_LOCK_BYTES = 4 * 1024 * 1024

_COMMON = (
    {"name": "numpy", "version": "1.26.4"},
    {"name": "onnxruntime", "version": "1.20.1"},
    {"name": "torch", "version": "2.5.1"},
)

REQUIRED_DISTRIBUTIONS = {
    "tiger-dnr-neural-core": [
        *_COMMON,
        {"name": "huggingface-hub", "version": "0.26.2"},
        {"name": "safetensors", "version": "0.4.5"},
    ],
    "panns-cnn10": [
        *_COMMON,
        {"name": "torchlibrosa", "version": "0.1.0"},
    ],
    "beat-this": [
        *_COMMON,
        {"name": "einops", "version": "0.8.0"},
        {"name": "rotary-embedding-torch", "version": "0.8.5"},
        {"name": "torchaudio", "version": "2.5.1"},
    ],
    "transnetv2": [
        *_COMMON,
        {"name": "onnx", "version": "1.17.0"},
        {"name": "onnx2torch", "version": "1.5.15"},
        {"name": "tensorflow-cpu", "version": "2.16.1"},
        {"name": "tf2onnx", "version": "1.16.1"},
        {"name": "torchvision", "version": "0.20.1"},
    ],
}


def authenticate_toolchain_lock(root: Path, value: str, supplied_sha256: str) -> Path:
    """Authenticate the complete uv resolution before inspecting installed packages."""
    if supplied_sha256 != TOOLCHAIN_LOCK_SHA256:
        raise ContractError("The conversion toolchain lock identity is unsupported.")
    path = relative_path(root, value, "toolchain lock")
    size = path.stat().st_size
    if size < 1 or size > MAXIMUM_LOCK_BYTES or sha256_file(path) != supplied_sha256:
        raise ContractError("The conversion toolchain lock failed SHA-256 authentication.")
    try:
        lock = tomllib.loads(path.read_text(encoding="utf-8", errors="strict"))
    except (UnicodeError, tomllib.TOMLDecodeError) as error:
        raise ContractError("The conversion toolchain lock is malformed UTF-8 TOML.") from error
    if (lock.get("version") != 1 or lock.get("revision") != 3
            or lock.get("requires-python") != "==3.12.*"
            or not isinstance(lock.get("package"), list)):
        raise ContractError("The conversion toolchain lock protocol is invalid.")
    root_packages = [row for row in lock["package"] if isinstance(row, dict)
                     and row.get("name") == "soundscaper-m7-conversion"]
    if len(root_packages) != 1 or root_packages[0].get("version") != "1.0.0":
        raise ContractError("The conversion toolchain root package identity is invalid.")
    return path


def validate_installed_toolchain(candidate_id: str) -> None:
    """Refuse a non-CPython or version-drifted installed resolution."""
    dependencies = REQUIRED_DISTRIBUTIONS.get(candidate_id)
    if dependencies is None:
        raise ContractError("The conversion toolchain candidate is unsupported.")
    if platform.python_implementation() != "CPython" or platform.python_version_tuple()[:2] != ("3", "12"):
        raise ContractError("The conversion toolchain requires exact CPython 3.12.")
    for dependency in dependencies:
        try:
            installed = version(dependency["name"])
        except PackageNotFoundError as error:
            raise ContractError(
                f"The locked conversion dependency {dependency['name']} is missing.") from error
        expected = installed_distribution_version(dependency["name"], dependency["version"])
        if installed != expected:
            raise ContractError(
                f"The locked conversion dependency {dependency['name']} changed version.")


def installed_distribution_version(name: str, logical_version: str) -> str:
    if name not in ("torch", "torchaudio", "torchvision"):
        return logical_version
    system = platform.system()
    machine = platform.machine().lower()
    if system == "Linux" and machine in ("x86_64", "amd64"):
        return f"{logical_version}+cpu"
    if system == "Windows" and machine in ("amd64", "x86_64"):
        return f"{logical_version}+cpu"
    if (system == "Darwin" and machine == "arm64"
            or system == "Linux" and machine in ("aarch64", "arm64")):
        return logical_version
    raise ContractError("The locked CPU PyTorch conversion platform is unsupported.")
