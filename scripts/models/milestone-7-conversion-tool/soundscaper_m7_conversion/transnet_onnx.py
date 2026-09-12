# SPDX-License-Identifier: AGPL-3.0-only

"""TransNetV2's authenticated upstream TensorFlow-to-PyTorch weight bridge."""

from __future__ import annotations

from contextlib import contextmanager
from pathlib import Path
import sys
import tempfile

from .contract import ContractError
from .runner_io import copy_saved_model
from .source_adapters import file_module


@contextmanager
def transnet_source_models(source_root: Path, artifacts: dict, temporary_root: Path):
    """Run the pinned author's converter, retaining independent source networks."""
    from .exporters import torch_runtime
    torch_runtime()
    try:
        import tensorflow as tf
    except ImportError as error:
        raise ContractError("The locked TransNetV2 source bridge requires TensorFlow.") from error
    try:
        tf.config.set_visible_devices([], "GPU")
    except RuntimeError as error:
        raise ContractError("TransNetV2 initialized TensorFlow before GPU quarantine.") from error
    if tf.config.get_visible_devices("GPU"):
        raise ContractError("The TransNetV2 source bridge refuses a visible GPU.")
    model_root = copy_saved_model(artifacts, temporary_root)
    names = ("transnetv2_pytorch", "_soundscaper_m7_transnet_weights")
    created = []
    try:
        for name, file_name in zip(names, ("transnetv2_pytorch.py", "convert_weights.py"), strict=True):
            module = file_module(name, source_root / "inference-pytorch" / file_name)
            created.append(name)
        pytorch_model, tensorflow_model = module.convert_weights(str(model_root))
        yield pytorch_model.cpu().eval(), tensorflow_model
    finally:
        for name in reversed(created):
            sys.modules.pop(name, None)


def export_transnet_source(source_root: Path, artifacts: dict,
                           output_root: Path, file_name: str) -> Path:
    from .exporters import export_torch_onnx, torch_runtime
    torch = torch_runtime()
    with tempfile.TemporaryDirectory(prefix="transnet-source-", dir=output_root) as temporary:
        with transnet_source_models(source_root, artifacts, Path(temporary)) as (source, _tensorflow):
            class TransNetOutputs(torch.nn.Module):
                def __init__(self, model):
                    super().__init__()
                    self.source = model

                def forward(self, frames):
                    single, outputs = self.source(frames)
                    return single, outputs["many_hot"]

            example = torch.zeros((1, 100, 27, 48, 3), dtype=torch.uint8)
            return export_torch_onnx(TransNetOutputs(source).eval(), (example,), output_root,
                                     file_name, ["frames"],
                                     ["single_frame_logits", "all_frame_logits"],
                                     {})
