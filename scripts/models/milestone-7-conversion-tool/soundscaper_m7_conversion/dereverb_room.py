# SPDX-License-Identifier: AGPL-3.0-only

"""Exporter and parity runner for the dereverb-room BS-RoFormer candidate.

The converted graph is the neural core only (band split, axial transformer,
mask estimator); STFT before and complex-mask multiply plus ISTFT after remain
owned runtime stages, because ONNX has no ISTFT operator. The core lives in the
pinned exporter repository's ``models_without_stft/bs_roformer_no_stft.py``.

That module hard-imports ``beartype``, a runtime type-checker outside the
locked toolchain; an inert shim (identity decorator, typing passthrough) is
installed for the import, mirroring the recorded export-run deviations for the
repository's unused ``tensorrt``/``pycuda``/``demucs`` top-level imports.
"""

from __future__ import annotations

import sys
import types
import typing
from contextlib import contextmanager
from pathlib import Path

from .contract import ContractError
from .exporters import (
    configure_framework_environment, export_torch_onnx, source_import_root, torch_runtime,
)
from .runner_io import load_audio_fixture, ort_run

N_FFT = 2_048
HOP_LENGTH = 512
CHUNK_FRAMES = 384_000
SPECTRUM_FRAMES = CHUNK_FRAMES // HOP_LENGTH + 1
FREQUENCY_BINS = N_FFT // 2 + 1

# Constructor arguments pinned by the digest-bound dereverb_room_anvuew.yaml
# model section; the strict state_dict load below enforces architectural
# equivalence with the checkpoint, so drift fails closed.
MODEL_KWARGS = {
    "dim": 128,
    "depth": 16,
    "stereo": False,
    "num_stems": 1,
    "time_transformer_depth": 1,
    "freq_transformer_depth": 1,
    "linear_transformer_depth": 0,
    "freqs_per_bands": (
        2, 2, 2, 2, 2, 2, 3, 3, 3, 3, 3, 4, 4, 4, 4, 4, 5, 5, 5, 5,
        6, 6, 6, 6, 7, 7, 7, 8, 8, 8, 9, 9, 10, 10, 11, 12, 13, 14, 15, 16,
        17, 18, 19, 20, 21, 22, 23, 24, 25, 27, 29, 31, 33, 35, 37, 39,
        41, 43, 45, 48, 52, 57, 64,
    ),
    "dim_head": 16,
    "heads": 8,
    "attn_dropout": 0.0,
    "ff_dropout": 0.0,
    "flash_attn": True,
    "dim_freqs_in": 1_025,
    "stft_n_fft": 2_048,
    "stft_hop_length": 512,
    "stft_win_length": 2_048,
    "stft_normalized": False,
    "mask_estimator_depth": 3,
    "mlp_expansion_factor": 4,
    "use_torch_checkpoint": False,
    "skip_connection": False,
}

_SHIM_NAMES = ("beartype", "beartype.typing", "tensorrt", "pycuda",
               "pycuda.driver", "demucs", "demucs.spec", "demucs.hdemucs")


def _shim_module(name: str, **attributes):
    import importlib.machinery
    module = types.ModuleType(name)
    module.__spec__ = importlib.machinery.ModuleSpec(name, loader=None)
    for key, value in attributes.items():
        setattr(module, key, value)
    return module


@contextmanager
def _import_shims():
    if any(name in sys.modules for name in _SHIM_NAMES):
        raise ContractError("The dereverb-room import shims would mask a real module.")
    beartype_typing = _shim_module("beartype.typing", **{
        key: getattr(typing, key) for key in
        ("Tuple", "Optional", "List", "Callable", "Dict", "Union", "Any")})
    installed = {
        "beartype": _shim_module("beartype", beartype=lambda target: target,
                                 typing=beartype_typing),
        "beartype.typing": beartype_typing,
        "tensorrt": _shim_module("tensorrt"),
        "pycuda": _shim_module("pycuda"),
        "pycuda.driver": _shim_module("pycuda.driver"),
        "demucs": _shim_module("demucs"),
        "demucs.spec": _shim_module("demucs.spec", spectro=None, ispectro=None),
        "demucs.hdemucs": _shim_module("demucs.hdemucs", pad1d=None),
    }
    sys.modules.update(installed)
    try:
        yield
    finally:
        for name in installed:
            if sys.modules.get(name) is installed[name]:
                del sys.modules[name]


def _load_core(torch, source_root: Path, checkpoint: Path):
    with _import_shims(), source_import_root(source_root):
        from models_without_stft.bs_roformer_no_stft import BSRoformer
        core = BSRoformer(MODEL_KWARGS["dim"],
                          **{key: value for key, value in MODEL_KWARGS.items()
                             if key != "dim"}).cpu().eval()
    state = torch.load(str(checkpoint), map_location="cpu", weights_only=True)
    if isinstance(state, dict):
        for container_key in ("state_dict", "state", "model"):
            inner = state.get(container_key)
            if isinstance(inner, dict) and inner:
                state = inner
                break
    if not isinstance(state, dict) or not state:
        raise ContractError("The dereverb-room checkpoint container is invalid.")
    core.load_state_dict(state, strict=True)
    return core


def export_dereverb_room(source_root: Path, checkpoint: Path, output_root: Path,
                         file_name: str) -> Path:
    torch = torch_runtime()
    core = _load_core(torch, source_root, checkpoint)
    dummy = torch.zeros(1, SPECTRUM_FRAMES, FREQUENCY_BINS * 2, dtype=torch.float32)
    return export_torch_onnx(core, (dummy,), output_root, file_name,
                             ["input"], ["output"], {})


def run_dereverb_room(source_root: Path, artifacts: dict, converted: dict,
                      fixture: Path, spec: dict) -> dict:
    configure_framework_environment()
    torch = torch_runtime()
    _metadata, wave = load_audio_fixture(fixture, "dereverb-room", spec)
    core = _load_core(torch, source_root, artifacts["bs-roformer-checkpoint"])
    waveform = torch.from_numpy(wave[0]).reshape(1, -1).to(dtype=torch.float32)
    if waveform.shape[1] != CHUNK_FRAMES:
        raise ContractError("The dereverb-room parity fixture is not one exact chunk.")
    window = torch.hann_window(N_FFT, periodic=True, dtype=torch.float32)
    with torch.inference_mode():
        spectrum = torch.stft(waveform, n_fft=N_FFT, hop_length=HOP_LENGTH,
                              window=window, center=True, pad_mode="reflect",
                              return_complex=True)
        packed = torch.view_as_real(spectrum.permute(0, 2, 1)).reshape(
            1, SPECTRUM_FRAMES, FREQUENCY_BINS * 2).contiguous()
        source_mask = core(packed).detach().cpu()
        onnx_mask = torch.from_numpy(ort_run(
            converted["network"], ["input"], ["output"],
            {"input": packed.cpu().numpy()})["output"])
        source_wave = _masked_waveform(torch, spectrum, source_mask, window)
        onnx_wave = _masked_waveform(torch, spectrum, onnx_mask, window)
    return {
        "source-pytorch": {"noreverb-waveform": source_wave},
        "onnxruntime-cpu": {"noreverb-waveform": onnx_wave},
    }


def _masked_waveform(torch, spectrum, mask, window):
    expected = (1, 1, FREQUENCY_BINS, SPECTRUM_FRAMES, 2)
    if (tuple(mask.shape) != expected or mask.dtype != torch.float32
            or not torch.isfinite(mask).all()):
        raise ContractError("The dereverb-room mask tensor geometry or values are invalid.")
    complex_mask = torch.complex(mask[:, 0, :, :, 0], mask[:, 0, :, :, 1])
    waveform = torch.istft(spectrum * complex_mask, n_fft=N_FFT,
                           hop_length=HOP_LENGTH, window=window, center=True,
                           length=CHUNK_FRAMES)
    return waveform.detach().cpu().numpy()[0]
