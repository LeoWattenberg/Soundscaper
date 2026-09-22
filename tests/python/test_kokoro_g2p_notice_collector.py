# SPDX-License-Identifier: AGPL-3.0-only
"""Keep nested dist-info license texts distinct in the frozen bundle."""

import importlib.util
from pathlib import Path
import sys
import tempfile
import unittest


sys.dont_write_bytecode = True
SOURCE = Path(__file__).resolve().parents[2] / "scripts" / "kokoro-g2p" / "collect_notices.py"
SPEC = importlib.util.spec_from_file_location("kokoro_g2p_notices", SOURCE)
assert SPEC is not None and SPEC.loader is not None
collector = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(collector)


class NoticeCollectorTests(unittest.TestCase):
    def test_nested_dist_info_licenses_keep_distinct_paths(self):
        with tempfile.TemporaryDirectory() as directory:
            bundle = Path(directory)
            primary = collector.notice_destination(
                bundle, "setuptools", "setuptools-84.0.0.dist-info/licenses/LICENSE")
            nested = collector.notice_destination(
                bundle, "setuptools",
                "setuptools/_vendor/jaraco.text-4.0.0.dist-info/licenses/LICENSE")
            self.assertNotEqual(primary, nested)
            self.assertTrue(primary.is_relative_to(bundle))
            self.assertTrue(nested.is_relative_to(bundle))
            with self.assertRaises(ValueError):
                collector.notice_destination(bundle, "setuptools", "../LICENSE")


if __name__ == "__main__":
    unittest.main()
