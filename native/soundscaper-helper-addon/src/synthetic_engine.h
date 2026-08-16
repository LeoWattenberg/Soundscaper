/* SPDX-License-Identifier: AGPL-3.0-only */

/*
 * The synthetic real-time engine milestone 5A-0c uses to prove the helper ->
 * AudioWorklet data plane without any operating-system device or third-party
 * SDK. It is deliberately deterministic: the same generation, start frame and
 * mode always produce the same samples, so a packaged loopback run can assert
 * bit-exact delivery rather than "sounds about right". The fault modes exist so
 * the supervision suites can exercise a real native crash and a real native
 * hang instead of simulating them at the JavaScript layer.
 */

#ifndef SOUNDSCAPER_SYNTHETIC_ENGINE_H
#define SOUNDSCAPER_SYNTHETIC_ENGINE_H

#include <stdint.h>
#include <stddef.h>

#define SOUNDSCAPER_SYNTHETIC_MAX_CHANNELS 32
#define SOUNDSCAPER_SYNTHETIC_MAX_FRAMES 65536

typedef enum {
	SOUNDSCAPER_SYNTHETIC_MODE_PASSTHROUGH = 0,
	SOUNDSCAPER_SYNTHETIC_MODE_GAIN = 1,
	SOUNDSCAPER_SYNTHETIC_MODE_TONE = 2,
	SOUNDSCAPER_SYNTHETIC_MODE_IMPULSE = 3
} soundscaper_synthetic_mode;

typedef enum {
	SOUNDSCAPER_SYNTHETIC_FAULT_NONE = 0,
	SOUNDSCAPER_SYNTHETIC_FAULT_ABORT_AT_FRAME = 1,
	SOUNDSCAPER_SYNTHETIC_FAULT_HANG_AT_FRAME = 2
} soundscaper_synthetic_fault;

typedef struct {
	uint32_t channel_count;
	uint32_t frame_count;
	uint32_t sample_rate;
	uint32_t generation;
	soundscaper_synthetic_mode mode;
	double gain;
	soundscaper_synthetic_fault fault;
	uint64_t fault_frame;
} soundscaper_synthetic_config;

typedef struct soundscaper_synthetic_engine soundscaper_synthetic_engine;

typedef enum {
	SOUNDSCAPER_SYNTHETIC_OK = 0,
	SOUNDSCAPER_SYNTHETIC_INVALID_CONFIG = 1,
	SOUNDSCAPER_SYNTHETIC_OUT_OF_MEMORY = 2,
	SOUNDSCAPER_SYNTHETIC_INVALID_BLOCK = 3,
	SOUNDSCAPER_SYNTHETIC_NON_CONTIGUOUS = 4
} soundscaper_synthetic_status;

soundscaper_synthetic_status soundscaper_synthetic_create(
	const soundscaper_synthetic_config *config,
	soundscaper_synthetic_engine **out_engine);

void soundscaper_synthetic_destroy(soundscaper_synthetic_engine *engine);

/*
 * Renders one contiguous block into `channels`, which must point at
 * `channel_count` planar float buffers of `frame_count` samples each. `input`
 * may be NULL for the generating modes. The engine refuses a block whose start
 * frame is not exactly the previous block's end: the real-time contract never
 * silently reorders or replays audio.
 */
soundscaper_synthetic_status soundscaper_synthetic_render(
	soundscaper_synthetic_engine *engine,
	uint64_t start_frame,
	uint32_t frame_count,
	const float *const *input,
	float *const *channels);

uint64_t soundscaper_synthetic_rendered_frames(const soundscaper_synthetic_engine *engine);

uint32_t soundscaper_synthetic_generation(const soundscaper_synthetic_engine *engine);

/*
 * The deterministic reference a consumer can recompute independently to prove
 * a delivered packet is exactly what the engine produced for that frame.
 */
float soundscaper_synthetic_expected_sample(
	const soundscaper_synthetic_config *config,
	uint32_t channel,
	uint64_t frame);

#endif /* SOUNDSCAPER_SYNTHETIC_ENGINE_H */
