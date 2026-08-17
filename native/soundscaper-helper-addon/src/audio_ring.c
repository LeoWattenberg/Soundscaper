/* SPDX-License-Identifier: AGPL-3.0-only */

#include "audio_ring.h"

#include <stdlib.h>

#define SOUNDSCAPER_RING_BLOCKS 32u

int soundscaper_ring_init(soundscaper_sample_ring *ring, uint32_t frames, uint32_t channels)
{
	if (ring == NULL || frames == 0u || channels == 0u) return 0;
	uint32_t capacity = 1u;
	const uint32_t wanted = frames * channels * SOUNDSCAPER_RING_BLOCKS;
	while (capacity < wanted) capacity <<= 1u;
	ring->samples = calloc(capacity, sizeof(float));
	if (ring->samples == NULL) return 0;
	ring->capacity = capacity;
	ring->mask = capacity - 1u;
	ring->frame_samples = channels;
	atomic_init(&ring->read, 0u);
	atomic_init(&ring->write, 0u);
	return 1;
}

void soundscaper_ring_release(soundscaper_sample_ring *ring)
{
	if (ring == NULL) return;
	free(ring->samples);
	ring->samples = NULL;
}

uint32_t soundscaper_ring_available(const soundscaper_sample_ring *ring)
{
	const uint32_t write = atomic_load_explicit(&ring->write, memory_order_acquire);
	const uint32_t read = atomic_load_explicit(&ring->read, memory_order_relaxed);
	return write - read;
}

uint32_t soundscaper_ring_space(const soundscaper_sample_ring *ring)
{
	return ring->capacity - soundscaper_ring_available(ring);
}

uint32_t soundscaper_ring_push(soundscaper_sample_ring *ring, const float *source, uint32_t count)
{
	const uint32_t space = soundscaper_ring_space(ring);
	uint32_t moved = count < space ? count : space;
	moved -= moved % ring->frame_samples;
	uint32_t write = atomic_load_explicit(&ring->write, memory_order_relaxed);
	for (uint32_t index = 0u; index < moved; index += 1u) {
		ring->samples[(write + index) & ring->mask] = source[index];
	}
	atomic_store_explicit(&ring->write, write + moved, memory_order_release);
	return moved;
}

uint32_t soundscaper_ring_pop(soundscaper_sample_ring *ring, float *destination, uint32_t count)
{
	const uint32_t available = soundscaper_ring_available(ring);
	uint32_t moved = count < available ? count : available;
	moved -= moved % ring->frame_samples;
	uint32_t read = atomic_load_explicit(&ring->read, memory_order_relaxed);
	for (uint32_t index = 0u; index < moved; index += 1u) {
		destination[index] = ring->samples[(read + index) & ring->mask];
	}
	atomic_store_explicit(&ring->read, read + moved, memory_order_release);
	return moved;
}

uint32_t soundscaper_graph_buffer_frames(
	uint32_t maxsize,
	uint32_t offset,
	uint32_t size,
	uint32_t stride,
	uint32_t *out_byte_offset)
{
	if (out_byte_offset != NULL) *out_byte_offset = 0u;
	if (stride == 0u || offset >= maxsize) return 0u;
	const uint32_t remaining = maxsize - offset;
	const uint32_t readable = size < remaining ? size : remaining;
	if (out_byte_offset != NULL) *out_byte_offset = offset;
	return readable / stride;
}
