# SPDX-License-Identifier: AGPL-3.0-only

"""Authenticated three-framework TransNetV2 fixture runner."""

from __future__ import annotations

from pathlib import Path
import tempfile

from .contract import ContractError
from .exporters import configure_framework_environment, torch_runtime
from .runner_audio import ort_run
from .runner_io import load_video_fixture
from .runner_postprocess import transnet_boundaries
from .transnet_onnx import transnet_source_models

WINDOW_FRAMES = 100
STEP_FRAMES = 50
CONTEXT_FRAMES = 25


def run_transnet(source_root: Path, artifacts: dict, converted: dict,
                 fixture: Path, spec: dict) -> dict:
    configure_framework_environment()
    torch = torch_runtime()
    metadata, frames = load_video_fixture(fixture, spec)
    try:
        import numpy
        import tensorflow as tf
    except ImportError as error:
        raise ContractError("The locked TransNetV2 parity dependencies are incomplete.") from error
    with tempfile.TemporaryDirectory(prefix="m7-transnet-parity-") as temporary, \
            transnet_source_models(source_root, artifacts, Path(temporary)) as (bridged, source_model):
        tf_single = numpy.empty(metadata["frameCount"], dtype=numpy.float32)
        tf_all = numpy.empty(metadata["frameCount"], dtype=numpy.float32)
        torch_single = numpy.empty(metadata["frameCount"], dtype=numpy.float32)
        torch_all = numpy.empty(metadata["frameCount"], dtype=numpy.float32)
        ort_single = numpy.empty(metadata["frameCount"], dtype=numpy.float32)
        ort_all = numpy.empty(metadata["frameCount"], dtype=numpy.float32)
        with torch.inference_mode():
            for start in range(0, metadata["frameCount"], STEP_FRAMES):
                batch = transnet_batch(frames, start)
                authoritative = min(STEP_FRAMES, metadata["frameCount"] - start)
                tensorflow_outputs = source_model(tf.cast(batch, tf.float32))
                bridged_outputs = bridged(torch.from_numpy(batch))
                onnx_outputs = ort_run(converted["network"], ["frames"],
                                       ["single_frame_logits", "all_frame_logits"],
                                       {"frames": batch})
                assign_authority(tf_single, tf_all, start, authoritative,
                                 tensorflow_outputs[0].numpy(),
                                 tensorflow_outputs[1]["many_hot"].numpy())
                if not isinstance(bridged_outputs, (tuple, list)) or len(bridged_outputs) != 2:
                    raise ContractError("The TransNetV2 PyTorch bridge result inventory is invalid.")
                assign_authority(torch_single, torch_all, start, authoritative,
                                 bridged_outputs[0].detach().cpu().numpy(),
                                 bridged_outputs[1]["many_hot"].detach().cpu().numpy())
                assign_authority(ort_single, ort_all, start, authoritative,
                                 onnx_outputs["single_frame_logits"],
                                 onnx_outputs["all_frame_logits"])
    return {
        "source-tensorflow": transnet_roles(tf_single, tf_all),
        "source-pytorch": transnet_roles(torch_single, torch_all),
        "onnxruntime-cpu": transnet_roles(ort_single, ort_all),
    }


def transnet_batch(frames, start: int):
    try:
        import numpy
    except ImportError as error:
        raise ContractError("The locked TransNetV2 parity runner is missing NumPy.") from error
    indexes = numpy.arange(start - CONTEXT_FRAMES, start - CONTEXT_FRAMES + WINDOW_FRAMES)
    indexes = numpy.clip(indexes, 0, frames.shape[0] - 1)
    return numpy.ascontiguousarray(frames[indexes][None, ...], dtype=numpy.uint8)


def assign_authority(target_single, target_all, start: int, count: int,
                     single, all_frame) -> None:
    if tuple(single.shape) != (1, WINDOW_FRAMES, 1) or tuple(all_frame.shape) != (
            1, WINDOW_FRAMES, 1):
        raise ContractError("A TransNetV2 parity output changed its exact tensor geometry.")
    target_single[start:start + count] = single[0, CONTEXT_FRAMES:CONTEXT_FRAMES + count, 0]
    target_all[start:start + count] = all_frame[0, CONTEXT_FRAMES:CONTEXT_FRAMES + count, 0]


def transnet_roles(single, all_frame) -> dict:
    return {"single-frame-logits": single, "all-frame-logits": all_frame,
            "boundaries": transnet_boundaries(single, all_frame)}
