# SPDX-License-Identifier: AGPL-3.0-only

"""Small tensor regressions for the TIGER dynamic adaptive-pooling export."""

import tempfile
from pathlib import Path
import unittest

import numpy as np
import onnxruntime
import torch

from soundscaper_m7_conversion.tiger_onnx import adaptive_average_pool_onnx


class DynamicAdaptivePoolingTests(unittest.TestCase):
    def test_runtime_lengths_match_pytorch_including_uneven_bins(self):
        class Pool(torch.nn.Module):
            def forward(self, value, destination):
                return torch.nn.functional.adaptive_avg_pool1d(value, destination.shape[-1])

        model = Pool().eval()
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / 'pool.onnx'
            with adaptive_average_pool_onnx(torch):
                torch.onnx.export(model, (torch.zeros(1, 2, 57), torch.zeros(8)), str(path),
                                  opset_version=17, dynamo=False,
                                  input_names=['value', 'destination'], output_names=['pooled'],
                                  dynamic_axes={'value': {0: 'batch', 2: 'length'},
                                                'destination': {0: 'pooled_length'},
                                                'pooled': {0: 'batch', 2: 'pooled_length'}})
            options = onnxruntime.SessionOptions()
            options.intra_op_num_threads = 1
            session = onnxruntime.InferenceSession(str(path), sess_options=options,
                                                   providers=['CPUExecutionProvider'])
            for length, output_length in [(57, 8), (173, 22), (64, 8), (7, 3), (7, 1), (7, 7)]:
                with self.subTest(length=length, output_length=output_length):
                    value = torch.linspace(-1, 1, 4 * length).reshape(2, 2, length)
                    destination = torch.zeros(output_length)
                    actual = session.run(None, {'value': value.numpy(),
                                                'destination': destination.numpy()})[0]
                    np.testing.assert_allclose(actual, model(value, destination).numpy(),
                                               atol=2e-7, rtol=2e-6)


if __name__ == '__main__':
    unittest.main()
