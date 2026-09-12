# SPDX-License-Identifier: AGPL-3.0-only

"""Standard ONNX lowering for TIGER's dynamically sized adaptive average pool."""

from contextlib import contextmanager


@contextmanager
def adaptive_average_pool_onnx(torch):
    """Preserve PyTorch's exact overlapping-bin definition for dynamic lengths.

    The legacy exporter only supports constant divisible pooling geometry.
    TIGER pools both frequency and time axes into downsampled feature lengths;
    these are not generally divisible, and time stays dynamic in its graph.
    This lowering uses standard opset-17 operators without changing the source
    model's forward method or its reference-framework parity execution.
    """
    def pool(value, output_size):
        count = output_size[0] if isinstance(output_size, (tuple, list)) else output_size
        length = torch._shape_as_tensor(value)[-1]
        rows = torch.arange(count, device=value.device, dtype=torch.int64)
        columns = torch.arange(length, device=value.device, dtype=torch.int64)
        starts = torch.div(rows * length, count, rounding_mode='floor')
        ends = torch.div((rows + 1) * length + count - 1, count, rounding_mode='floor')
        included = (columns.unsqueeze(0) >= starts.unsqueeze(1)) \
            & (columns.unsqueeze(0) < ends.unsqueeze(1))
        weights = included.to(value.dtype) / (ends - starts).to(value.dtype).unsqueeze(1)
        return torch.matmul(value, weights.transpose(0, 1))

    original = torch.nn.functional.adaptive_avg_pool1d
    torch.nn.functional.adaptive_avg_pool1d = pool
    try:
        yield
    finally:
        torch.nn.functional.adaptive_avg_pool1d = original
