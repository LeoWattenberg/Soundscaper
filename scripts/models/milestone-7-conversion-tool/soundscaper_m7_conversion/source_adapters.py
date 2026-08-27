# SPDX-License-Identifier: AGPL-3.0-only

"""Narrow import adapters for exact authenticated upstream source trees."""

from __future__ import annotations

from contextlib import contextmanager
import importlib.util
from pathlib import Path
import sys
from types import ModuleType

from .contract import ContractError


@contextmanager
def tiger_dnr_class(source_root: Path):
    """Load only TIGER-DnR and its two required layer modules."""
    package = "_soundscaper_m7_tiger"
    created = []
    try:
        root_package = package_module(package, source_root / "look2hear")
        models_package = package_module(f"{package}.models", source_root / "look2hear" / "models")
        layers_package = package_module(f"{package}.layers", source_root / "look2hear" / "layers")
        created.extend((root_package.__name__, models_package.__name__, layers_package.__name__))
        for name in ("activations", "normalizations"):
            loaded = file_module(f"{package}.layers.{name}",
                                 source_root / "look2hear" / "layers" / f"{name}.py")
            setattr(layers_package, name, loaded)
            created.append(loaded.__name__)
        base = file_module(f"{package}.models.base_model",
                           source_root / "look2hear" / "models" / "base_model.py")
        created.append(base.__name__)
        tiger = file_module(f"{package}.models.tiger_dnr",
                            source_root / "look2hear" / "models" / "tiger_dnr.py")
        created.append(tiger.__name__)
        candidate = getattr(tiger, "TIGERDNR", None)
        if not isinstance(candidate, type):
            raise ContractError("The authenticated TIGER source has no TIGERDNR class.")
        yield candidate
    finally:
        for name in reversed(created):
            sys.modules.pop(name, None)


@contextmanager
def panns_cnn10_class(source_root: Path):
    """Load the PANNs model while closing its unqualified helper import."""
    helper_name = "pytorch_utils"
    model_name = "_soundscaper_m7_panns_models"
    prior_helper = sys.modules.get(helper_name)
    created = []
    try:
        file_module(helper_name, source_root / "pytorch" / "pytorch_utils.py")
        created.append(helper_name)
        models = file_module(model_name, source_root / "pytorch" / "models.py")
        created.append(model_name)
        candidate = getattr(models, "Cnn10", None)
        if not isinstance(candidate, type):
            raise ContractError("The authenticated PANNs source has no Cnn10 class.")
        yield candidate
    finally:
        for name in reversed(created):
            sys.modules.pop(name, None)
        if prior_helper is not None:
            sys.modules[helper_name] = prior_helper


def package_module(name: str, path: Path) -> ModuleType:
    if name in sys.modules or not path.is_dir():
        raise ContractError("An authenticated source package path or namespace is invalid.")
    module = ModuleType(name)
    module.__package__ = name
    module.__path__ = [str(path)]
    sys.modules[name] = module
    return module


def file_module(name: str, path: Path) -> ModuleType:
    if name in sys.modules or not path.is_file() or path.is_symlink():
        raise ContractError("An authenticated source module path or namespace is invalid.")
    specification = importlib.util.spec_from_file_location(name, path)
    if specification is None or specification.loader is None:
        raise ContractError("An authenticated source module cannot be loaded.")
    module = importlib.util.module_from_spec(specification)
    sys.modules[name] = module
    try:
        specification.loader.exec_module(module)
    except Exception:
        sys.modules.pop(name, None)
        raise
    return module


def create_tiger_neural_core(model, torch):
    """Create the same D/M/E neural-mask core used by the exporter."""
    class TigerDnrNeuralCore(torch.nn.Module):
        def __init__(self, source):
            super().__init__()
            self.dialogue = source.dialog
            self.music = source.music
            self.effects = source.effect

        @staticmethod
        def target_mask(network, spectrum_ri, target_index):
            batch_channels = spectrum_ri.shape[0]
            subband_features = []
            band_start = 0
            for width, normalizer in zip(network.band_width, network.BN, strict=True):
                band = spectrum_ri[:, :, band_start:band_start + width].contiguous()
                subband_features.append(normalizer(band.view(batch_channels, width * 2, -1)))
                band_start += width
            features = torch.stack(subband_features, 1)
            separated = network.separator(features).view(
                batch_channels, network.nband, network.feature_dim, -1)
            real_bands = []
            imaginary_bands = []
            for index, width in enumerate(network.band_width):
                raw = network.mask[index](separated[:, index]).view(
                    batch_channels, 2, 2, network.num_output, width, -1)
                masks = raw[:, 0] * torch.sigmoid(raw[:, 1])
                real = masks[:, 0]
                imaginary = masks[:, 1]
                real = real - (real.sum(1, keepdim=True) - 1) / network.num_output
                imaginary = imaginary - imaginary.sum(1, keepdim=True) / network.num_output
                real_bands.append(real[:, target_index])
                imaginary_bands.append(imaginary[:, target_index])
            return torch.stack((torch.cat(real_bands, 1), torch.cat(imaginary_bands, 1)), 1)

        def forward(self, spectrum_ri):
            dialogue = self.target_mask(self.dialogue, spectrum_ri, 2)
            music = self.target_mask(self.music, spectrum_ri, 0)
            effects = self.target_mask(self.effects, spectrum_ri, 1)
            return torch.stack((dialogue, music, effects), 1)

    return TigerDnrNeuralCore(model).cpu().eval()
