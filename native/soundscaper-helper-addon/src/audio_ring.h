/* SPDX-License-Identifier: AGPL-3.0-only */

/*
 * The exchange between an audio graph's realtime thread and the helper's job
 * loop, and the bounds every mapped graph buffer is read through.
 *
 * One producer, one consumer, no locks. `read` and `write` are only ever
 * touched by their own side; each side publishes its cursor with a release
 * store and observes the other's with an acquire load, which is the whole
 * synchronisation. Capacity is a power of two so the wrap is a mask.
 *
 * The ring stores interleaved samples but is measured in frames. A transfer
 * that moved part of a frame would rotate every following sample by a channel
 * for as long as the session lasts — channel 0 arriving on channel 1 — and
 * nothing downstream could detect it, so a partial frame is never committed
 * and never consumed.
 */

#ifndef SOUNDSCAPER_AUDIO_RING_H
#define SOUNDSCAPER_AUDIO_RING_H

#include <stdatomic.h>
#include <stdint.h>

typedef struct {
	float *samples;
	uint32_t capacity;
	uint32_t mask;
	/* Samples per frame: the granularity every transfer is rounded down to. */
	uint32_t frame_samples;
	atomic_uint_least32_t read;
	atomic_uint_least32_t write;
} soundscaper_sample_ring;

int soundscaper_ring_init(soundscaper_sample_ring *ring, uint32_t frames, uint32_t channels);

void soundscaper_ring_release(soundscaper_sample_ring *ring);

uint32_t soundscaper_ring_available(const soundscaper_sample_ring *ring);

uint32_t soundscaper_ring_space(const soundscaper_sample_ring *ring);

/* Both answer with the sample count actually moved, always a whole number of
 * frames, and never move anything when a whole frame does not fit. */
uint32_t soundscaper_ring_push(soundscaper_sample_ring *ring, const float *source, uint32_t count);

uint32_t soundscaper_ring_pop(soundscaper_sample_ring *ring, float *destination, uint32_t count);

/*
 * The readable region of one mapped graph buffer, in frames, with the byte
 * offset the samples actually start at. The server owns those three numbers
 * and this process maps the memory, so they are treated as claims: a size past
 * the mapping, or past the region the offset leaves, is a read into memory
 * that was never granted.
 */
uint32_t soundscaper_graph_buffer_frames(
	uint32_t maxsize,
	uint32_t offset,
	uint32_t size,
	uint32_t stride,
	uint32_t *out_byte_offset);

#endif /* SOUNDSCAPER_AUDIO_RING_H */
