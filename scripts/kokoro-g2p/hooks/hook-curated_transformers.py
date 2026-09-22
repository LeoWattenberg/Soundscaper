# SPDX-License-Identifier: AGPL-3.0-only

"""TorchScript inspects curated-transformers class source at runtime."""

from PyInstaller.utils.hooks import collect_data_files

datas = collect_data_files("curated_transformers", include_py_files=True)
