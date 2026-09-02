# SPDX-License-Identifier: AGPL-3.0-only

"""Bounded deterministic fixture parsing and parity-run publication."""

from __future__ import annotations

import hashlib
import json
import math
import os
from pathlib import Path, PurePosixPath
import shutil
import stat
import struct
import tempfile

from .contract import ContractError, sha256_file
from .parity import output_kind

VIDEO_MAGIC = b"soundscaper-m7-parity-rgb24-v1\n"
VIDEO_WIDTH = 48
VIDEO_HEIGHT = 27
VIDEO_CHANNELS = 3
MAXIMUM_TIMESCALE = 0x7fff_ffff
MAXIMUM_TICK = 0x7fff_ffff_ffff_ffff
MAXIMUM_RUN_BYTES = 2 * 1024**3

_AUDIO_GEOMETRY = {
    "tiger-dnr-neural-core": (44_100, 2, 88_200),
    "panns-cnn10": (32_000, 1, 64_000),
    "beat-this": (22_050, 1, 176_400),
    "dereverb-room": (44_100, 1, 384_000),
}


def inspect_fixture(path: Path, candidate_id: str, spec: dict) -> dict:
    """Inspect the complete already-digest-authenticated fixture without frameworks."""
    if path.stat().st_size != spec["fixture"][1]:
        raise ContractError("The parity fixture changed its exact byte geometry.")
    if candidate_id == "transnetv2":
        return inspect_video_fixture(path, candidate_id)
    expected = _AUDIO_GEOMETRY.get(candidate_id)
    if expected is None:
        raise ContractError("The parity fixture candidate is unsupported.")
    sample_rate, channels, frames = expected
    with path.open("rb") as source:
        header = source.read(44)
        if (len(header) != 44 or header[:4] != b"RIFF" or header[8:12] != b"WAVE"
                or header[12:16] != b"fmt " or header[36:40] != b"data"
                or struct.unpack_from("<I", header, 4)[0] != path.stat().st_size - 8
                or struct.unpack_from("<IHHIIHH", header, 16) != (
                    16, 3, channels, sample_rate, sample_rate * channels * 4,
                    channels * 4, 32)
                or struct.unpack_from("<I", header, 40)[0] != frames * channels * 4):
            raise ContractError("The parity fixture Float32 RIFF/WAV geometry is invalid.")
        remaining = frames * channels
        while remaining:
            count = min(remaining, 262_144)
            body = source.read(count * 4)
            if len(body) != count * 4:
                raise ContractError("The parity fixture ended before its Float32 samples.")
            if any(not math.isfinite(value) for (value,) in struct.iter_unpack("<f", body)):
                raise ContractError("The parity fixture must contain finite Float32 samples.")
            remaining -= count
        if source.read(1):
            raise ContractError("The parity fixture has trailing audio bytes.")
    return {"candidateId": candidate_id, "kind": "float32-wave",
            "sampleRate": sample_rate, "channelCount": channels, "frameCount": frames}


def inspect_video_fixture(path: Path, candidate_id: str) -> dict:
    body = path.read_bytes()
    if not body.startswith(VIDEO_MAGIC):
        raise ContractError("The TransNetV2 parity fixture header is invalid.")
    header_end = body.find(b"\n", len(VIDEO_MAGIC))
    if header_end < 0 or header_end - len(VIDEO_MAGIC) > 256 * 1024:
        raise ContractError("The TransNetV2 parity fixture metadata is outside its bound.")
    try:
        metadata = json.loads(body[len(VIDEO_MAGIC):header_end].decode("utf-8", errors="strict"))
    except (UnicodeError, json.JSONDecodeError) as error:
        raise ContractError("The TransNetV2 parity fixture metadata is malformed.") from error
    if not isinstance(metadata, dict) or set(metadata) != {
            "width", "height", "frameCount", "timescale", "presentationTicks"}:
        raise ContractError("The TransNetV2 parity fixture metadata fields are invalid.")
    frames = metadata["frameCount"]
    ticks = metadata["presentationTicks"]
    if (metadata["width"] != VIDEO_WIDTH or metadata["height"] != VIDEO_HEIGHT
            or frames != 120 or not isinstance(metadata["timescale"], int)
            or isinstance(metadata["timescale"], bool)
            or not 1 <= metadata["timescale"] <= MAXIMUM_TIMESCALE
            or not isinstance(ticks, list) or len(ticks) != frames):
        raise ContractError("The TransNetV2 parity fixture geometry or timing is invalid.")
    prior = -1
    for value in ticks:
        if not isinstance(value, str) or not value.isascii() or not value.isdecimal():
            raise ContractError("A TransNetV2 parity presentation tick is invalid.")
        tick = int(value)
        if str(tick) != value or tick <= prior or tick > MAXIMUM_TICK:
            raise ContractError("TransNetV2 parity presentation ticks must be canonical and ordered.")
        prior = tick
    pixels = len(body) - header_end - 1
    if pixels != frames * VIDEO_WIDTH * VIDEO_HEIGHT * VIDEO_CHANNELS:
        raise ContractError("The TransNetV2 parity RGB24 byte geometry is invalid.")
    return {"candidateId": candidate_id, "kind": "rgb24-vfr", "width": VIDEO_WIDTH,
            "height": VIDEO_HEIGHT, "timescale": metadata["timescale"],
            "presentationTicks": ticks, "frameCount": frames, "pixelOffset": header_end + 1}


def load_audio_fixture(path: Path, candidate_id: str, spec: dict):
    metadata = inspect_fixture(path, candidate_id, spec)
    try:
        import numpy
    except ImportError as error:
        raise ContractError("The locked parity runner is missing NumPy.") from error
    body = path.read_bytes()
    if (len(body) != spec["fixture"][1]
            or hashlib.sha256(body).hexdigest() != spec["fixture"][2]):
        raise ContractError("The audio parity fixture changed during its reviewed read.")
    values = numpy.frombuffer(body, dtype="<f4", offset=44)
    return metadata, values.reshape(metadata["frameCount"], metadata["channelCount"]).T.copy()


def load_video_fixture(path: Path, spec: dict):
    metadata = inspect_fixture(path, "transnetv2", spec)
    try:
        import numpy
    except ImportError as error:
        raise ContractError("The locked parity runner is missing NumPy.") from error
    body = path.read_bytes()
    if (len(body) != spec["fixture"][1]
            or hashlib.sha256(body).hexdigest() != spec["fixture"][2]):
        raise ContractError("The video parity fixture changed during its reviewed read.")
    frames = numpy.frombuffer(body, dtype="u1", offset=metadata["pixelOffset"])
    return metadata, frames.reshape(metadata["frameCount"], VIDEO_HEIGHT, VIDEO_WIDTH, 3).copy()


def publish_framework_runs(root: Path, value: str, runs: dict, spec: dict) -> Path:
    destination = directory_destination(root, value)
    if destination.exists() or destination.is_symlink():
        raise ContractError("The source-framework run directory already exists and is never overwritten.")
    expected_frameworks = spec["frameworks"]
    if list(runs) != expected_frameworks:
        raise ContractError("The parity runner returned a foreign framework inventory.")
    with tempfile.TemporaryDirectory(prefix="m7-parity-runs-", dir=root) as temporary:
        staging = Path(temporary) / "runs"
        staging.mkdir(mode=0o700)
        for framework in expected_frameworks:
            outputs = runs[framework]
            if not isinstance(outputs, dict) or list(outputs) != spec["roles"]:
                raise ContractError("A parity runner returned a foreign output-role inventory.")
            framework_root = staging / framework
            framework_root.mkdir(mode=0o700)
            for role in spec["roles"]:
                write_output(framework_root, role, outputs[role], spec["counts"].get(role))
        try:
            os.rename(staging, destination)
        except FileExistsError as error:
            raise ContractError("The parity run directory was not overwritten.") from error
    return destination


def write_output(root: Path, role: str, values, expected_count: int | None) -> None:
    try:
        import numpy
    except ImportError as error:
        raise ContractError("The locked parity runner is missing NumPy.") from error
    kind = output_kind(role)
    array = numpy.asarray(values)
    if array.ndim == 0:
        array = array.reshape(1)
    array = array.reshape(-1)
    if expected_count is not None and array.size != expected_count:
        raise ContractError(f"The {role} parity output changed fixture-bound tensor geometry.")
    if array.size < 1:
        raise ContractError(f"The {role} parity output is empty.")
    if kind == "float32":
        array = array.astype("<f4", copy=False)
        if not numpy.isfinite(array).all():
            raise ContractError(f"The {role} parity output must be finite Float32.")
        suffix = "f32le"
    else:
        if not numpy.issubdtype(array.dtype, numpy.integer):
            raise ContractError(f"The {role} parity indexes must be integers.")
        array = array.astype("<i8", copy=False)
        if array.size > 1 and not numpy.all(array[1:] > array[:-1]):
            raise ContractError(f"The {role} parity indexes must be strictly ordered and unique.")
        suffix = "i64le"
    body = array.tobytes(order="C")
    if len(body) < 1 or len(body) > MAXIMUM_RUN_BYTES:
        raise ContractError(f"The {role} parity output exceeds its byte bound.")
    path = root / f"{role}.{suffix}"
    with path.open("xb") as output:
        output.write(body)
        output.flush()
        os.fsync(output.fileno())
    if (path.stat().st_size != len(body)
            or sha256_file(path) != hashlib.sha256(body).hexdigest()):
        raise ContractError(f"The {role} parity output failed its digest readback.")


def directory_destination(root: Path, value: str) -> Path:
    if not isinstance(value, str) or not value or len(value) > 512 or "\\" in value or "\0" in value:
        raise ContractError("The source-framework run directory path is invalid.")
    pure = PurePosixPath(value)
    if pure.is_absolute() or value != pure.as_posix() or any(part in ("", ".", "..") for part in pure.parts):
        raise ContractError("The source-framework run directory must be normalized and relative.")
    path = root.joinpath(*pure.parts)
    parent = path.parent
    if not parent.is_dir() or stat.S_ISLNK(parent.lstat().st_mode) or parent.resolve() != parent:
        raise ContractError("The source-framework run parent directory is non-canonical.")
    if root not in (parent, *parent.parents):
        raise ContractError("The source-framework run directory escaped its workspace.")
    return path


def copy_saved_model(artifacts: dict, destination: Path) -> Path:
    model_root = destination / "saved-model"
    variables = model_root / "variables"
    variables.mkdir(parents=True)
    shutil.copyfile(artifacts["tensorflow-saved-model"], model_root / "saved_model.pb")
    shutil.copyfile(artifacts["tensorflow-variables-data"],
                    variables / "variables.data-00000-of-00001")
    shutil.copyfile(artifacts["tensorflow-variables-index"], variables / "variables.index")
    return model_root
