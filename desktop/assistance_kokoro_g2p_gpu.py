# SPDX-License-Identifier: AGPL-3.0-only
"""Keep Misaki's exact learned English models and offload their matrix products."""

import atexit
import ctypes
from pathlib import Path
import sys

MAXIMUM_ELEMENTS = 16 * 1024 * 1024
MAXIMUM_DIMENSION = 65_536


class NativeGemm:
    """The library and all adjacent ORT/plugin files are authenticated by main."""

    def __init__(self, root: Path, profile=None, loader=ctypes.CDLL):
        name = ("scape-g2p-gpu.dll" if sys.platform == "win32" else
                "libscape-g2p-gpu.dylib" if sys.platform == "darwin" else "libscape-g2p-gpu.so")
        self.library = loader(str(root / name))
        self.handle = ctypes.c_void_p()
        self.library.scape_g2p_gpu_open.argtypes = [ctypes.POINTER(ctypes.c_void_p), ctypes.c_char_p]
        self.library.scape_g2p_gpu_open.restype = ctypes.c_int
        self.library.scape_g2p_gpu_gemm.argtypes = [ctypes.c_void_p] + [ctypes.POINTER(ctypes.c_float)] * 3 + [ctypes.c_int64] * 3
        self.library.scape_g2p_gpu_gemm.restype = ctypes.c_int
        self.library.scape_g2p_gpu_close.argtypes = [ctypes.c_void_p]
        self.library.scape_g2p_gpu_close.restype = ctypes.c_int
        status = self.library.scape_g2p_gpu_open(ctypes.byref(self.handle),
                                                   None if profile is None else str(profile).encode("utf-8"))
        if status != 0 and self.handle.value:
            self.close()
            raise RuntimeError("The G2P GPU initialization returned an unowned native handle.")
        if status not in (0, 2) or status == 0 and not self.handle.value:
            raise RuntimeError("The authenticated G2P GPU initialization contract is invalid.")
        self.active = status == 0

    def run(self, x, y, output):
        pointer = ctypes.POINTER(ctypes.c_float)
        return self.library.scape_g2p_gpu_gemm(self.handle, x.ctypes.data_as(pointer),
                                              y.ctypes.data_as(pointer), output.ctypes.data_as(pointer),
                                              x.shape[0], x.shape[1], y.shape[1])

    def close(self):
        if not self.handle.value:
            self.active = False
            return
        owned = self.handle
        self.handle = ctypes.c_void_p()
        self.active = False
        if self.library.scape_g2p_gpu_close(owned) != 0:
            raise RuntimeError("The G2P GPU session could not be released.")


def create_gpu_ops(numpy, base_ops, native):
    """All trained weights and remaining Thinc operations retain their original representation."""
    class GpuGemmOps(base_ops):
        name = "scape-ort-webgpu"

        def gemm(self, x, y, *, out=None, trans1=False, trans2=False):
            if x.ndim != 2 or y.ndim != 2 or x.dtype != numpy.float32 or y.dtype != numpy.float32:
                raise ValueError("G2P GPU matrix inputs must be two-dimensional float32 arrays.")
            a = x.T if trans1 else x
            b = y.T if trans2 else y
            m, k = a.shape
            other, n = b.shape
            if k != other or max(m, k, n) > MAXIMUM_DIMENSION or min(m, k, n) < 0:
                raise ValueError("The G2P matrix dimensions are invalid.")
            if max(m * k, k * n, m * n) > MAXIMUM_ELEMENTS:
                raise ValueError("The G2P matrix exceeds its element bound.")
            if out is not None and (out.shape != (m, n) or out.dtype != numpy.float32):
                raise ValueError("The G2P matrix output shape or type is invalid.")
            if not numpy.isfinite(a).all() or not numpy.isfinite(b).all():
                raise ValueError("The G2P matrix inputs contain non-finite values.")
            if native.active and min(m, k, n) > 0:
                result = numpy.empty((m, n), dtype=numpy.float32)
                status = native.run(numpy.ascontiguousarray(a), numpy.ascontiguousarray(b), result)
                if status == 0:
                    if not numpy.isfinite(result).all():
                        raise ValueError("The G2P GPU returned non-finite matrix output.")
                    if out is not None:
                        numpy.copyto(out, result)
                        return out
                    return result
                if status != 2:
                    raise ValueError("The authenticated G2P GPU returned an invalid matrix result.")
                # A synchronous native run has ended. Retire it before CPU inference.
                native.close()
            return super().gemm(x, y, out=out, trans1=trans1, trans2=trans2)

    return GpuGemmOps()


def install_gpu_ops(root=None, profile=None):
    """Called before spaCy loads the learned Tok2Vec and tagger models."""
    import numpy
    from thinc.backends import NumpyOps, set_current_ops

    if root is None:
        root = Path(getattr(sys, "_MEIPASS", Path(__file__).resolve().parent)) / "scape-gpu"
    try:
        native = NativeGemm(Path(root), profile)
    except OSError:
        # Missing host loader support is an ordinary CPU fallback after payload authentication.
        return None
    if not native.active:
        native.close()
        return None
    try:
        ops = create_gpu_ops(numpy, NumpyOps, native)
        set_current_ops(ops)
    except BaseException:
        native.close()
        raise
    atexit.register(native.close)
    return native
