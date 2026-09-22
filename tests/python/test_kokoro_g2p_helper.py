# SPDX-License-Identifier: AGPL-3.0-only
"""Protocol checks for the frozen, one-request Kokoro phonemizer entrypoint."""

import importlib.util
import os
from pathlib import Path
import sys
import tempfile
import types
import unittest
from unittest.mock import patch


sys.dont_write_bytecode = True
SOURCE = Path(__file__).resolve().parents[2] / "desktop" / "assistance-kokoro-g2p-helper.py"
SPEC = importlib.util.spec_from_file_location("kokoro_g2p_helper", SOURCE)
assert SPEC is not None and SPEC.loader is not None
helper = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(helper)


class KokoroG2PHelperTests(unittest.TestCase):
    def test_request_rejects_foreign_voice_and_oversized_input(self):
        with self.assertRaises(ValueError):
            helper.review_request(b'{"language":"a","voice":"bf_emma","text":"Hello"}')
        with self.assertRaises(ValueError):
            helper.review_request(b" " * (helper.MAXIMUM_INPUT_BYTES + 1))

    def test_offline_pipeline_phonemizes_every_bounded_piece_without_loading_weights(self):
        calls = []

        class FakePipeline:
            def __init__(self, *, lang_code, repo_id, model):
                calls.append(("init", lang_code, repo_id, model))

            def __call__(self, text, *, voice):
                calls.append(("piece", text, voice))
                yield types.SimpleNamespace(phonemes="ola")

        fake_kokoro = types.SimpleNamespace(KPipeline=FakePipeline)
        text = "Hola mundo. " * 20
        with patch.dict(sys.modules, {"kokoro": fake_kokoro}), patch.dict(os.environ, {}, clear=True):
            chunks = helper.phonemize("e", "ef_dora", text)
            self.assertEqual(os.environ["HF_HUB_OFFLINE"], "1")
            self.assertEqual(os.environ["TRANSFORMERS_OFFLINE"], "1")

        self.assertEqual(calls[0], ("init", "e", "hexgrad/Kokoro-82M", False))
        pieces = [call[1] for call in calls[1:]]
        self.assertTrue(all(0 < len(piece) <= 80 for piece in pieces))
        self.assertEqual(" ".join(pieces), text.strip())
        self.assertEqual(chunks, ["ola"] * len(pieces))

    def test_japanese_uses_the_bundled_dictionary_before_pipeline_construction(self):
        with tempfile.TemporaryDirectory() as directory:
            dictionary = Path(directory)
            (dictionary / "mecabrc").write_text("# bundled dictionary\n", encoding="utf-8")
            unidic = types.SimpleNamespace(DICDIR="/missing/unidic")
            unidic_lite = types.SimpleNamespace(DICDIR=str(dictionary))

            class FakePipeline:
                def __init__(self, *, lang_code, repo_id, model):
                    self.assertion = (lang_code, repo_id, model)
                    if unidic.DICDIR != str(dictionary):
                        raise AssertionError("Japanese did not select its bundled dictionary")

                def __call__(self, text, *, voice):
                    yield types.SimpleNamespace(phonemes="koɲɲiʨiβa.")

            with patch.dict(sys.modules, {
                "kokoro": types.SimpleNamespace(KPipeline=FakePipeline),
                "unidic": unidic,
                "unidic_lite": unidic_lite,
            }):
                self.assertEqual(helper.phonemize("j", "jf_alpha", "こんにちは。"), ["koɲɲiʨiβa."])


if __name__ == "__main__":
    unittest.main()
