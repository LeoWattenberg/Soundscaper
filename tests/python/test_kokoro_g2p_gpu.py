# SPDX-License-Identifier: AGPL-3.0-only
"""Dependency-free checks for GPU routing through the exact existing Thinc model."""

import importlib.util
import math
from pathlib import Path
import sys
import types
import unittest
from unittest.mock import patch

sys.dont_write_bytecode = True
SOURCE = Path(__file__).resolve().parents[2] / "desktop" / "assistance_kokoro_g2p_gpu.py"
SPEC = importlib.util.spec_from_file_location("kokoro_g2p_gpu", SOURCE)
assert SPEC is not None and SPEC.loader is not None
gpu = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(gpu)


class Array:
    def __init__(self, values, dtype="float32"):
        self.values = [list(row) for row in values]
        self.shape = (len(values), len(values[0]) if values else 0)
        self.ndim = 2
        self.dtype = dtype

    @property
    def T(self):
        return Array(list(zip(*self.values)))


def product(x, y):
    return Array([[sum(a * b for a, b in zip(row, column)) for column in zip(*y.values)] for row in x.values])


class Numpy:
    float32 = "float32"

    @staticmethod
    def empty(shape, dtype):
        return Array([[0] * shape[1] for _ in range(shape[0])], dtype)

    @staticmethod
    def isfinite(value):
        return types.SimpleNamespace(all=lambda: all(math.isfinite(x) for row in value.values for x in row))

    @staticmethod
    def ascontiguousarray(value):
        return value

    @staticmethod
    def copyto(target, source):
        target.values = source.values


class Ops:
    calls = 0

    def gemm(self, x, y, *, out=None, trans1=False, trans2=False):
        Ops.calls += 1
        result = product(x.T if trans1 else x, y.T if trans2 else y)
        if out is not None:
            Numpy.copyto(out, result)
            return out
        return result


class Native:
    def __init__(self, status=0, cleanup_fails=False):
        self.active = True
        self.status = status
        self.events = []
        self.cleanup_fails = cleanup_fails

    def run(self, x, y, output):
        self.events.append("gpu")
        output.values = product(x, y).values
        return self.status

    def close(self):
        self.events.append("close")
        self.active = False
        if self.cleanup_fails:
            raise RuntimeError("cleanup failed")


class G2PGpuTests(unittest.TestCase):
    def setUp(self):
        Ops.calls = 0

    def test_original_weights_and_all_transpose_shapes_use_gpu(self):
        for first, second in [(False, False), (True, False), (False, True), (True, True)]:
            native = Native()
            ops = gpu.create_gpu_ops(Numpy, Ops, native)
            x, y = Array([[1, 2, 3], [4, 5, 6]]), Array([[1, 2], [3, 4], [5, 6]])
            out = Array([[0, 0], [0, 0]])
            result = ops.gemm(x.T if first else x, y.T if second else y, out=out, trans1=first, trans2=second)
            self.assertIs(result, out)
            self.assertEqual(result.values, [[22, 28], [49, 64]])
            self.assertEqual(native.events, ["gpu"])
        self.assertEqual(Ops.calls, 0)

    def test_execution_failure_closes_gpu_before_single_cpu_fallback(self):
        native = Native(status=2)
        ops = gpu.create_gpu_ops(Numpy, Ops, native)
        x = Array([[2]])
        self.assertEqual(ops.gemm(x, x).values, [[4]])
        self.assertEqual(native.events, ["gpu", "close"])
        self.assertEqual(ops.gemm(x, x).values, [[4]])
        self.assertEqual(native.events, ["gpu", "close"])
        self.assertEqual(Ops.calls, 2)

    def test_validation_and_malformed_native_output_do_not_retry_cpu(self):
        native = Native(status=1)
        ops = gpu.create_gpu_ops(Numpy, Ops, native)
        for x, y in [(Array([[1, 2]]), Array([[1, 2]])),
                     (Array([[float("nan")]]), Array([[1]])),
                     (Array([[1]], "float64"), Array([[1]]))]:
            with self.assertRaises(ValueError):
                ops.gemm(x, y)
        self.assertEqual(native.events, [])
        with self.assertRaises(ValueError):
            ops.gemm(Array([[1]]), Array([[1]]))
        self.assertEqual(Ops.calls, 0)

    def test_failed_gpu_cleanup_is_terminal(self):
        ops = gpu.create_gpu_ops(Numpy, Ops, Native(status=2, cleanup_fails=True))
        with self.assertRaisesRegex(RuntimeError, "cleanup failed"):
            ops.gemm(Array([[1]]), Array([[1]]))
        self.assertEqual(Ops.calls, 0)

    def test_installation_precedes_model_load_and_closes_on_set_ops_failure(self):
        native = Native()
        selected = []
        modules = {"numpy": Numpy, "thinc.backends": types.SimpleNamespace(NumpyOps=Ops, set_current_ops=selected.append)}
        with patch.dict(sys.modules, modules), patch.object(gpu, "NativeGemm", return_value=native), patch.object(gpu.atexit, "register") as register:
            self.assertIs(gpu.install_gpu_ops("/verified"), native)
            self.assertEqual(len(selected), 1)
            register.assert_called_once_with(native.close)
        modules["thinc.backends"].set_current_ops = lambda _: (_ for _ in ()).throw(RuntimeError("model load boundary"))
        with patch.dict(sys.modules, modules), patch.object(gpu, "NativeGemm", return_value=native):
            with self.assertRaisesRegex(RuntimeError, "model load boundary"):
                gpu.install_gpu_ops("/verified")
        self.assertEqual(native.events, ["close"])

    def test_no_device_or_host_loader_keeps_existing_cpu_backend(self):
        native = Native()
        native.active = False
        selected = []
        modules = {"numpy": Numpy, "thinc.backends": types.SimpleNamespace(NumpyOps=Ops, set_current_ops=selected.append)}
        with patch.dict(sys.modules, modules), patch.object(gpu, "NativeGemm", return_value=native):
            self.assertIsNone(gpu.install_gpu_ops("/verified"))
        with patch.dict(sys.modules, modules), patch.object(gpu, "NativeGemm", side_effect=OSError("loader missing")):
            self.assertIsNone(gpu.install_gpu_ops("/verified"))
        self.assertEqual(selected, [])
        self.assertEqual(native.events, ["close"])


if __name__ == "__main__":
    unittest.main()
