# SPDX-License-Identifier: AGPL-3.0-only

"""Candidate-specific CPU ONNX exporters for the four pinned source frameworks."""

from __future__ import annotations

from contextlib import contextmanager
import inspect
import os
from pathlib import Path
import shutil
import sys
import tempfile

from .contract import ContractError, sha256_file
from .source_adapters import create_tiger_neural_core, panns_cnn10_class, tiger_dnr_class

_TORCH_CONFIGURED = False


def convert_models(candidate_id: str, source_root: Path, artifacts: list, output_root: Path,
                   spec: dict) -> list:
    artifact_paths = {row["role"]: row["path"] for row in artifacts}
    configure_framework_environment()
    with source_import_root(source_root):
        if candidate_id == "tiger-dnr-neural-core":
            generated = [export_tiger(source_root, artifact_paths["dnr-weights"], output_root,
                                      spec["outputs"][0][2])]
        elif candidate_id == "panns-cnn10":
            validate_audioset_class_map(artifact_paths["audioset-class-map"])
            generated = [export_panns(source_root, artifact_paths["cnn10-checkpoint"], output_root,
                                      spec["outputs"][0][2])]
        elif candidate_id == "beat-this":
            generated = [
                export_beat(source_root, artifact_paths["small0-checkpoint"], output_root,
                            spec["outputs"][0][2]),
                export_beat(source_root, artifact_paths["final0-checkpoint"], output_root,
                            spec["outputs"][1][2]),
            ]
        elif candidate_id == "transnetv2":
            generated = [export_transnet(source_root, artifact_paths, output_root,
                                         spec["outputs"][0][2])]
        elif candidate_id == "dereverb-room":
            from .dereverb_room import export_dereverb_room
            generated = [export_dereverb_room(source_root,
                                              artifact_paths["bs-roformer-checkpoint"],
                                              output_root, spec["outputs"][0][2])]
        else:
            raise ContractError("The conversion exporter candidate is unsupported.")
    results = []
    for generated_path, expected in zip(generated, spec["outputs"], strict=True):
        role, required, file_name = expected
        if generated_path.name != file_name:
            raise ContractError("An exporter returned a foreign converted file name.")
        results.append({"role": role, "required": required, "fileName": file_name,
                        "byteLength": generated_path.stat().st_size,
                        "sha256": sha256_file(generated_path)})
    return results


def configure_framework_environment() -> None:
    os.environ["HF_HUB_OFFLINE"] = "1"
    os.environ["TRANSFORMERS_OFFLINE"] = "1"
    os.environ["TORCH_HOME"] = os.devnull
    os.environ["TF_CPP_MIN_LOG_LEVEL"] = "2"


@contextmanager
def source_import_root(root: Path):
    value = str(root)
    sys.path.insert(0, value)
    try:
        yield
    finally:
        if sys.path[0] == value:
            sys.path.pop(0)


def torch_runtime():
    global _TORCH_CONFIGURED
    try:
        import torch
    except ImportError as error:
        raise ContractError("The locked conversion toolchain is missing PyTorch.") from error
    if not _TORCH_CONFIGURED:
        torch.manual_seed(0)
        torch.set_num_threads(1)
        torch.set_num_interop_threads(1)
        torch.use_deterministic_algorithms(True)
        _TORCH_CONFIGURED = True
    if torch.cuda.is_available():
        raise ContractError("The conversion tool refuses a visible GPU execution provider.")
    return torch


def export_tiger(_source_root: Path, checkpoint: Path, output_root: Path, file_name: str) -> Path:
    torch = torch_runtime()
    try:
        from safetensors.torch import load_file
    except ImportError as error:
        raise ContractError("The locked TIGER source/exporter dependencies are incomplete.") from error
    with tiger_dnr_class(_source_root) as TigerDNR:
        model = TigerDNR().cpu().eval()
        state = load_file(str(checkpoint), device="cpu")
        model.load_state_dict(state, strict=True)
        wrapper = create_tiger_neural_core(model, torch)
        example = torch.zeros((1, 2, 1_025, 64), dtype=torch.float32)
        return export_torch_onnx(wrapper, (example,), output_root, file_name,
                                 ["spectrum_ri"], ["complex_masks"],
                                 {"spectrum_ri": {0: "batch-channel", 3: "frames"},
                                  "complex_masks": {0: "batch-channel", 4: "frames"}})


def export_panns(_source_root: Path, checkpoint: Path, output_root: Path, file_name: str) -> Path:
    torch = torch_runtime()
    with panns_cnn10_class(_source_root) as Cnn10:
        model = Cnn10(sample_rate=32_000, window_size=1_024, hop_size=320, mel_bins=64,
                      fmin=50, fmax=14_000, classes_num=527).cpu().eval()
        checkpoint_value = torch.load(checkpoint, map_location="cpu", weights_only=True)
        if not isinstance(checkpoint_value, dict) or "model" not in checkpoint_value:
            raise ContractError("The PANNs checkpoint container is invalid.")
        model.load_state_dict(checkpoint_value["model"], strict=True)

        class PannsOutputs(torch.nn.Module):
            def __init__(self, source):
                super().__init__()
                self.source = source

            def forward(self, waveform):
                outputs = self.source(waveform, None)
                return outputs["clipwise_output"], outputs["embedding"]

        example = torch.zeros((1, 64_000), dtype=torch.float32)
        return export_torch_onnx(PannsOutputs(model).eval(), (example,), output_root, file_name,
                                 ["waveform"], ["clipwise_probabilities", "embedding"],
                                 {"waveform": {0: "batch", 1: "samples"},
                                  "clipwise_probabilities": {0: "batch"},
                                  "embedding": {0: "batch"}})


def export_beat(_source_root: Path, checkpoint: Path, output_root: Path, file_name: str) -> Path:
    torch = torch_runtime()
    try:
        from beat_this.inference import load_model
    except ImportError as error:
        raise ContractError("The locked Beat This source/exporter dependencies are incomplete.") from error
    model = load_model(str(checkpoint), device="cpu").cpu().eval()

    class BeatOutputs(torch.nn.Module):
        def __init__(self, source):
            super().__init__()
            self.source = source

        def forward(self, log_mel_spectrogram):
            outputs = self.source(log_mel_spectrogram)
            return outputs["beat"], outputs["downbeat"]

    example = torch.zeros((1, 1_500, 128), dtype=torch.float32)
    return export_torch_onnx(BeatOutputs(model).eval(), (example,), output_root, file_name,
                             ["log_mel_spectrogram"], ["beat_logits", "downbeat_logits"],
                             {"log_mel_spectrogram": {0: "batch", 1: "frames"},
                              "beat_logits": {0: "batch", 1: "frames"},
                              "downbeat_logits": {0: "batch", 1: "frames"}})


def export_transnet(_source_root: Path, artifacts: dict, output_root: Path, file_name: str) -> Path:
    torch = torch_runtime()
    try:
        import tensorflow as tf
        import tf2onnx
        import onnx2torch
    except ImportError as error:
        raise ContractError("The locked TransNetV2 bridge dependencies are incomplete.") from error
    with tempfile.TemporaryDirectory(prefix="transnet-source-", dir=output_root) as temporary:
        model_root = Path(temporary) / "saved-model"
        variables = model_root / "variables"
        variables.mkdir(parents=True)
        shutil.copyfile(artifacts["tensorflow-saved-model"], model_root / "saved_model.pb")
        shutil.copyfile(artifacts["tensorflow-variables-data"],
                        variables / "variables.data-00000-of-00001")
        shutil.copyfile(artifacts["tensorflow-variables-index"], variables / "variables.index")
        source = tf.saved_model.load(str(model_root))
        signature = [tf.TensorSpec([None, 100, 27, 48, 3], tf.float32, name="frames_float")]

        @tf.function(input_signature=signature)
        def tensorflow_forward(frames_float):
            logits, outputs = source(frames_float)
            return logits, outputs["many_hot"]

        intermediate = Path(temporary) / "tensorflow.onnx"
        tensorflow_onnx, _ = tf2onnx.convert.from_function(
            tensorflow_forward, input_signature=signature, opset=17, output_path=str(intermediate))
        pytorch_model = onnx2torch.convert(tensorflow_onnx).cpu().eval()

        class TransNetOutputs(torch.nn.Module):
            def __init__(self, bridged):
                super().__init__()
                self.bridged = bridged

            def forward(self, frames):
                outputs = self.bridged(frames.float())
                return outputs[0], outputs[1]

        example = torch.zeros((1, 100, 27, 48, 3), dtype=torch.uint8)
        return export_torch_onnx(TransNetOutputs(pytorch_model).eval(), (example,), output_root,
                                 file_name, ["frames"],
                                 ["single_frame_logits", "all_frame_logits"],
                                 {"frames": {0: "batch"},
                                  "single_frame_logits": {0: "batch"},
                                  "all_frame_logits": {0: "batch"}})


def export_torch_onnx(model, inputs: tuple, output_root: Path, file_name: str,
                      input_names: list, output_names: list, dynamic_axes: dict) -> Path:
    torch = torch_runtime()
    destination = output_root / file_name
    if destination.exists() or destination.is_symlink():
        raise ContractError(f"The converted artifact {file_name} already exists.")
    descriptor, temporary_name = tempfile.mkstemp(prefix=f".{file_name}.", suffix=".tmp",
                                                  dir=output_root)
    os.close(descriptor)
    temporary = Path(temporary_name)
    try:
        kwargs = {
            "export_params": True, "opset_version": 17, "do_constant_folding": True,
            "input_names": input_names, "output_names": output_names,
            "dynamic_axes": dynamic_axes,
        }
        signature = inspect.signature(torch.onnx.export).parameters
        if "dynamo" in signature:
            kwargs["dynamo"] = False
        if "external_data" in signature:
            kwargs["external_data"] = False
        elif "use_external_data_format" in signature:
            kwargs["use_external_data_format"] = False
        with torch.inference_mode():
            torch.onnx.export(model, inputs, str(temporary), **kwargs)
        canonicalize_and_validate_onnx(temporary, input_names, output_names)
        try:
            os.link(temporary, destination)
        except FileExistsError as error:
            raise ContractError(f"The converted artifact {file_name} was not overwritten.") from error
        os.chmod(destination, 0o600)
        return destination
    finally:
        temporary.unlink(missing_ok=True)


def canonicalize_and_validate_onnx(path: Path, input_names: list, output_names: list) -> None:
    try:
        import onnx
        import onnxruntime
    except ImportError as error:
        raise ContractError("The locked ONNX validation dependencies are incomplete.") from error
    model = onnx.load(str(path), load_external_data=False)
    onnx.checker.check_model(model, full_check=True)
    if [row.name for row in model.graph.input] != input_names:
        raise ContractError("The converted ONNX input signature is not exact.")
    if [row.name for row in model.graph.output] != output_names:
        raise ContractError("The converted ONNX output signature is not exact.")
    if any(initializer.data_location != onnx.TensorProto.DEFAULT for initializer in model.graph.initializer):
        raise ContractError("The converted ONNX graph unexpectedly uses external tensor data.")
    if any(opset.domain not in ("", "ai.onnx") or opset.version > 17 for opset in model.opset_import):
        raise ContractError("The converted ONNX graph uses a custom domain or unsupported opset.")
    model.doc_string = ""
    model.graph.doc_string = ""
    body = model.SerializeToString(deterministic=True)
    with path.open("wb") as output:
        output.write(body)
        output.flush()
        os.fsync(output.fileno())
    options = onnxruntime.SessionOptions()
    options.inter_op_num_threads = 1
    options.intra_op_num_threads = 1
    session = onnxruntime.InferenceSession(str(path), sess_options=options,
                                           providers=["CPUExecutionProvider"])
    if [row.name for row in session.get_inputs()] != input_names:
        raise ContractError("ONNX Runtime changed the converted input signature.")
    if [row.name for row in session.get_outputs()] != output_names:
        raise ContractError("ONNX Runtime changed the converted output signature.")


def validate_audioset_class_map(path: Path) -> None:
    import csv
    try:
        with path.open("r", encoding="utf-8", errors="strict", newline="") as source:
            rows = list(csv.DictReader(source))
    except UnicodeError as error:
        raise ContractError("The AudioSet class map is not valid UTF-8 CSV.") from error
    if (len(rows) != 527 or rows[0].keys() != {"index", "mid", "display_name"}
            or any(row["index"] != str(index) or not row["mid"] or not row["display_name"]
                   for index, row in enumerate(rows))):
        raise ContractError("The AudioSet class map changed its exact 527-class structure.")
