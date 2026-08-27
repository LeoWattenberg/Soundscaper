# SPDX-License-Identifier: AGPL-3.0-only

"""Small deterministic postprocessors shared by source and ONNX parity runs."""

from __future__ import annotations

import math

BEAT_SAMPLE_RATE = 22_050
BEAT_FRAMES_PER_SECOND = 50
MAX_POOL_RADIUS = 3


def beat_points(beat_logits, downbeat_logits) -> dict:
    """Return production-compatible sample indexes from Beat This logits."""
    beats = collapse_adjacent(local_maxima(beat_logits))
    raw_downbeats = collapse_adjacent(local_maxima(downbeat_logits))
    downbeats = [nearest(frame, beats) if beats else frame for frame in raw_downbeats]
    return {
        "beats": unique_sorted(frame_to_sample(frame) for frame in beats),
        "downbeats": unique_sorted(frame_to_sample(frame) for frame in downbeats),
    }


def local_maxima(values) -> list[int]:
    result = []
    for index, value in enumerate(values):
        candidate = float(value)
        if not math.isfinite(candidate):
            raise ValueError("Beat This parity logits must be finite.")
        if candidate <= 0:
            continue
        start = max(0, index - MAX_POOL_RADIUS)
        end = min(len(values), index + MAX_POOL_RADIUS + 1)
        if candidate == max(float(values[neighbor]) for neighbor in range(start, end)):
            result.append(index)
    return result


def collapse_adjacent(values: list[int]) -> list[float]:
    if not values:
        return []
    result = []
    total = values[0]
    count = 1
    for prior, value in zip(values, values[1:], strict=False):
        if value - prior <= 1:
            total += value
            count += 1
        else:
            result.append(total / count)
            total = value
            count = 1
    result.append(total / count)
    return result


def nearest(target: float, values: list[float]) -> float:
    return min(values, key=lambda candidate: (abs(candidate - target), candidate))


def frame_to_sample(frame: float) -> int:
    # JavaScript Math.round for non-negative values, matching the owned runtime.
    return math.floor(frame * BEAT_SAMPLE_RATE / BEAT_FRAMES_PER_SECOND + 0.5)


def unique_sorted(values) -> list[int]:
    return sorted(set(values))


def transnet_boundaries(single_logits, all_frame_logits) -> list[int]:
    """Fuse logits and collapse contiguous TransNetV2 transition runs."""
    if len(single_logits) != len(all_frame_logits) or not single_logits:
        raise ValueError("TransNetV2 parity logit geometry is invalid.")
    selected = []
    active = None
    for index, (single, all_frame) in enumerate(zip(single_logits, all_frame_logits, strict=True)):
        score = max(sigmoid(single), sigmoid(all_frame))
        if score >= 0.5:
            if active is None or score > active[1]:
                active = (index, score)
            continue
        if active is not None and active[0] != 0:
            selected.append(active[0])
        active = None
    if active is not None and active[0] != 0:
        selected.append(active[0])
    return selected


def sigmoid(value) -> float:
    candidate = float(value)
    if not math.isfinite(candidate):
        raise ValueError("TransNetV2 parity logits must be finite.")
    if candidate >= 0:
        inverse = math.exp(-candidate)
        return 1 / (1 + inverse)
    exponential = math.exp(candidate)
    return exponential / (1 + exponential)
