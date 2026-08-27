# SPDX-License-Identifier: AGPL-3.0-only

"""Authenticated fixture runners for the three audio conversion candidates."""

from __future__ import annotations

from pathlib import Path

from .contract import ContractError
from .exporters import configure_framework_environment, source_import_root, torch_runtime
from .runner_io import load_audio_fixture
from .runner_postprocess import beat_points
from .source_adapters import create_tiger_neural_core, panns_cnn10_class, tiger_dnr_class


def run_tiger(source_root: Path, artifacts: dict, converted: dict,
              fixture: Path, spec: dict) -> dict:
    configure_framework_environment()
    torch = torch_runtime()
    _metadata, wave = load_audio_fixture(fixture, "tiger-dnr-neural-core", spec)
    try:
        from safetensors.torch import load_file
    except ImportError as error:
        raise ContractError("The locked TIGER parity dependencies are incomplete.") from error
    with tiger_dnr_class(source_root) as TigerDNR:
        model = TigerDNR().cpu().eval()
        model.load_state_dict(load_file(str(artifacts["dnr-weights"]), device="cpu"), strict=True)
        core = create_tiger_neural_core(model, torch)
        waveform = torch.from_numpy(wave).to(dtype=torch.float32)
        window = torch.hann_window(2_048, periodic=True, dtype=torch.float32)
        with torch.inference_mode():
            spectrum = torch.stft(waveform, n_fft=2_048, hop_length=512,
                                  window=window, center=True, pad_mode="reflect",
                                  return_complex=True)
            spectrum_ri = torch.stack((spectrum.real, spectrum.imag), 1)
            source_masks = core(spectrum_ri).detach().cpu()
            onnx_masks = ort_run(converted["network"], ["spectrum_ri"], ["complex_masks"],
                                 {"spectrum_ri": spectrum_ri.cpu().numpy()})["complex_masks"]
            source_outputs = tiger_waveforms(torch, spectrum, source_masks, window,
                                             wave.shape[1])
            onnx_outputs = tiger_waveforms(torch, spectrum, torch.from_numpy(onnx_masks),
                                           window, wave.shape[1])
    return {
        "source-pytorch": ordered_tiger_roles(source_outputs),
        "onnxruntime-cpu": ordered_tiger_roles(onnx_outputs),
    }


def tiger_waveforms(torch, spectrum, masks, window, frame_count: int):
    expected = (spectrum.shape[0], 3, 2, spectrum.shape[1], spectrum.shape[2])
    if tuple(masks.shape) != expected or masks.dtype != torch.float32 or not torch.isfinite(masks).all():
        raise ContractError("The TIGER parity mask tensor geometry or values are invalid.")
    outputs = []
    for stem in range(3):
        complex_mask = torch.complex(masks[:, stem, 0], masks[:, stem, 1])
        waveform = torch.istft(spectrum * complex_mask, n_fft=2_048, hop_length=512,
                               window=window, center=True, length=frame_count)
        outputs.append(waveform.detach().cpu().numpy())
    return outputs


def ordered_tiger_roles(outputs) -> dict:
    # Converted graph order is Dialogue, Music, Effects; evidence roles are lexical D/E/M.
    return {"dialogue-waveform": outputs[0], "effects-waveform": outputs[2],
            "music-waveform": outputs[1]}


def run_panns(source_root: Path, artifacts: dict, converted: dict,
              fixture: Path, spec: dict) -> dict:
    configure_framework_environment()
    torch = torch_runtime()
    _metadata, wave = load_audio_fixture(fixture, "panns-cnn10", spec)
    with panns_cnn10_class(source_root) as Cnn10:
        model = Cnn10(sample_rate=32_000, window_size=1_024, hop_size=320, mel_bins=64,
                      fmin=50, fmax=14_000, classes_num=527).cpu().eval()
        checkpoint = torch.load(artifacts["cnn10-checkpoint"], map_location="cpu",
                                weights_only=True)
        if not isinstance(checkpoint, dict) or set(checkpoint).isdisjoint({"model"}):
            raise ContractError("The PANNs parity checkpoint container is invalid.")
        model.load_state_dict(checkpoint["model"], strict=True)
        waveform = torch.from_numpy(wave[0]).reshape(1, -1).to(dtype=torch.float32)
        with torch.inference_mode():
            source = model(waveform, None)
        if not isinstance(source, dict) or set(source) != {"clipwise_output", "embedding"}:
            raise ContractError("The PANNs source result tensor inventory is invalid.")
        onnx = ort_run(converted["network"], ["waveform"],
                       ["clipwise_probabilities", "embedding"],
                       {"waveform": waveform.numpy()})
    return {
        "source-pytorch": {
            "clipwise-probabilities": tensor_numpy(source["clipwise_output"]),
            "embedding": tensor_numpy(source["embedding"]),
        },
        "onnxruntime-cpu": {
            "clipwise-probabilities": onnx["clipwise_probabilities"],
            "embedding": onnx["embedding"],
        },
    }


def run_beat(source_root: Path, artifacts: dict, converted: dict,
             fixture: Path, spec: dict) -> dict:
    configure_framework_environment()
    torch = torch_runtime()
    _metadata, wave = load_audio_fixture(fixture, "beat-this", spec)
    with source_import_root(source_root):
        try:
            from beat_this.inference import load_model
            from beat_this.preprocessing import LogMelSpect
        except ImportError as error:
            raise ContractError("The locked Beat This parity dependencies are incomplete.") from error
        model = load_model(str(artifacts["small0-checkpoint"]), device="cpu").cpu().eval()
        preprocessing = LogMelSpect(device="cpu")
        with torch.inference_mode():
            spectrogram = preprocessing(torch.from_numpy(wave[0]).to(dtype=torch.float32))
            source = model(spectrogram.unsqueeze(0))
        if not isinstance(source, dict) or set(source) != {"beat", "downbeat"}:
            raise ContractError("The Beat This source result tensor inventory is invalid.")
        onnx = ort_run(converted["small0-network"], ["log_mel_spectrogram"],
                       ["beat_logits", "downbeat_logits"],
                       {"log_mel_spectrogram": spectrogram.unsqueeze(0).cpu().numpy()})
    source_beats = tensor_numpy(source["beat"]).reshape(-1)
    source_downbeats = tensor_numpy(source["downbeat"]).reshape(-1)
    onnx_beats = onnx["beat_logits"].reshape(-1)
    onnx_downbeats = onnx["downbeat_logits"].reshape(-1)
    return {
        "source-pytorch": beat_roles(source_beats, source_downbeats),
        "onnxruntime-cpu": beat_roles(onnx_beats, onnx_downbeats),
    }


def beat_roles(beats, downbeats) -> dict:
    points = beat_points(beats, downbeats)
    return {"beat-logits": beats, "downbeat-logits": downbeats,
            "beat-points": points["beats"], "downbeat-points": points["downbeats"]}


def tensor_numpy(value):
    if not hasattr(value, "detach"):
        raise ContractError("A source parity output is not a tensor.")
    return value.detach().cpu().numpy()


def ort_run(path: Path, input_names: list, output_names: list, feeds: dict) -> dict:
    try:
        import onnxruntime
    except ImportError as error:
        raise ContractError("The locked parity runner is missing ONNX Runtime.") from error
    options = onnxruntime.SessionOptions()
    options.inter_op_num_threads = 1
    options.intra_op_num_threads = 1
    session = onnxruntime.InferenceSession(str(path), sess_options=options,
                                           providers=["CPUExecutionProvider"])
    if ([row.name for row in session.get_inputs()] != input_names
            or [row.name for row in session.get_outputs()] != output_names
            or session.get_providers() != ["CPUExecutionProvider"]):
        raise ContractError("The parity ONNX graph signature or provider is invalid.")
    values = session.run(output_names, feeds)
    if len(values) != len(output_names):
        raise ContractError("The parity ONNX result inventory is invalid.")
    return dict(zip(output_names, values, strict=True))
