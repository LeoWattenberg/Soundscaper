/* SPDX-License-Identifier: AGPL-3.0-only */

#include "synthetic_engine.h"

#include <stdlib.h>
#include <string.h>
#include <math.h>

#if defined(_WIN32)
#include <windows.h>
#define SOUNDSCAPER_SLEEP_MS(ms) Sleep((DWORD)(ms))
#else
#include <time.h>
static void soundscaper_sleep_ms(unsigned int milliseconds)
{
	struct timespec request;
	request.tv_sec = (time_t)(milliseconds / 1000u);
	request.tv_nsec = (long)((milliseconds % 1000u) * 1000000u);
	nanosleep(&request, NULL);
}
#define SOUNDSCAPER_SLEEP_MS(ms) soundscaper_sleep_ms((unsigned int)(ms))
#endif

struct soundscaper_synthetic_engine {
	soundscaper_synthetic_config config;
	uint64_t rendered_frames;
	uint64_t next_frame;
	int started;
};

/*
 * A 32-bit integer hash keyed by (generation, channel, frame). Using an integer
 * mixer rather than a floating-point oscillator keeps the reference bit-exact
 * on every target: the JavaScript verifier recomputes the same value with the
 * same integer operations, so a mismatch means a real delivery defect and never
 * a platform floating-point difference.
 */
static uint32_t mix32(uint32_t value)
{
	value ^= value >> 16;
	value *= 0x7feb352du;
	value ^= value >> 15;
	value *= 0x846ca68bu;
	value ^= value >> 16;
	return value;
}

static float deterministic_sample(uint32_t generation, uint32_t channel, uint64_t frame)
{
	uint32_t low = (uint32_t)(frame & 0xffffffffu);
	uint32_t high = (uint32_t)((frame >> 32) & 0xffffffffu);
	uint32_t hashed = mix32(low ^ mix32(high ^ mix32(generation * 2654435761u + channel)));
	/* Map to [-1, 1) exactly, using only powers of two so the value is exact. */
	return (float)((double)(int32_t)hashed / 2147483648.0);
}

float soundscaper_synthetic_expected_sample(
	const soundscaper_synthetic_config *config,
	uint32_t channel,
	uint64_t frame)
{
	if (config == NULL) return 0.0f;
	switch (config->mode) {
	case SOUNDSCAPER_SYNTHETIC_MODE_TONE:
		return deterministic_sample(config->generation, channel, frame);
	case SOUNDSCAPER_SYNTHETIC_MODE_IMPULSE:
		return frame == 0 ? 1.0f : 0.0f;
	case SOUNDSCAPER_SYNTHETIC_MODE_GAIN:
	case SOUNDSCAPER_SYNTHETIC_MODE_PASSTHROUGH:
	default:
		return 0.0f;
	}
}

static int valid_config(const soundscaper_synthetic_config *config)
{
	if (config == NULL) return 0;
	if (config->channel_count == 0u || config->channel_count > SOUNDSCAPER_SYNTHETIC_MAX_CHANNELS) return 0;
	if (config->frame_count == 0u || config->frame_count > SOUNDSCAPER_SYNTHETIC_MAX_FRAMES) return 0;
	if (config->sample_rate < 8000u || config->sample_rate > 768000u) return 0;
	if (!(config->gain >= -16.0 && config->gain <= 16.0)) return 0;
	switch (config->mode) {
	case SOUNDSCAPER_SYNTHETIC_MODE_PASSTHROUGH:
	case SOUNDSCAPER_SYNTHETIC_MODE_GAIN:
	case SOUNDSCAPER_SYNTHETIC_MODE_TONE:
	case SOUNDSCAPER_SYNTHETIC_MODE_IMPULSE:
		break;
	default:
		return 0;
	}
	switch (config->fault) {
	case SOUNDSCAPER_SYNTHETIC_FAULT_NONE:
	case SOUNDSCAPER_SYNTHETIC_FAULT_ABORT_AT_FRAME:
	case SOUNDSCAPER_SYNTHETIC_FAULT_HANG_AT_FRAME:
		break;
	default:
		return 0;
	}
	return 1;
}

soundscaper_synthetic_status soundscaper_synthetic_create(
	const soundscaper_synthetic_config *config,
	soundscaper_synthetic_engine **out_engine)
{
	if (out_engine == NULL) return SOUNDSCAPER_SYNTHETIC_INVALID_CONFIG;
	*out_engine = NULL;
	if (!valid_config(config)) return SOUNDSCAPER_SYNTHETIC_INVALID_CONFIG;
	soundscaper_synthetic_engine *engine = calloc(1u, sizeof(*engine));
	if (engine == NULL) return SOUNDSCAPER_SYNTHETIC_OUT_OF_MEMORY;
	engine->config = *config;
	engine->rendered_frames = 0u;
	engine->next_frame = 0u;
	engine->started = 0;
	*out_engine = engine;
	return SOUNDSCAPER_SYNTHETIC_OK;
}

void soundscaper_synthetic_destroy(soundscaper_synthetic_engine *engine)
{
	free(engine);
}

soundscaper_synthetic_status soundscaper_synthetic_render(
	soundscaper_synthetic_engine *engine,
	uint64_t start_frame,
	uint32_t frame_count,
	const float *const *input,
	float *const *channels)
{
	if (engine == NULL || channels == NULL) return SOUNDSCAPER_SYNTHETIC_INVALID_BLOCK;
	if (frame_count == 0u || frame_count > engine->config.frame_count) {
		return SOUNDSCAPER_SYNTHETIC_INVALID_BLOCK;
	}
	if (engine->started && start_frame != engine->next_frame) {
		return SOUNDSCAPER_SYNTHETIC_NON_CONTIGUOUS;
	}
	if (!engine->started) {
		engine->started = 1;
		engine->next_frame = start_frame;
	}
	int needs_input = engine->config.mode == SOUNDSCAPER_SYNTHETIC_MODE_PASSTHROUGH
		|| engine->config.mode == SOUNDSCAPER_SYNTHETIC_MODE_GAIN;
	if (needs_input && input == NULL) return SOUNDSCAPER_SYNTHETIC_INVALID_BLOCK;

	uint64_t fault_frame = engine->config.fault_frame;
	if (engine->config.fault != SOUNDSCAPER_SYNTHETIC_FAULT_NONE
		&& start_frame + frame_count > fault_frame
		&& start_frame <= fault_frame) {
		if (engine->config.fault == SOUNDSCAPER_SYNTHETIC_FAULT_ABORT_AT_FRAME) {
			/* A deliberate native abort: the supervision suite requires a real
			 * process death, not a JavaScript exception dressed up as one. */
			abort();
		}
		/* A deliberate unbounded native stall so the cancellation and
		 * missed-deadline paths observe a genuinely unresponsive helper. */
		for (;;) SOUNDSCAPER_SLEEP_MS(1000u);
	}

	for (uint32_t channel = 0u; channel < engine->config.channel_count; channel += 1u) {
		float *destination = channels[channel];
		if (destination == NULL) return SOUNDSCAPER_SYNTHETIC_INVALID_BLOCK;
		const float *source = needs_input ? input[channel] : NULL;
		if (needs_input && source == NULL) return SOUNDSCAPER_SYNTHETIC_INVALID_BLOCK;
		for (uint32_t index = 0u; index < frame_count; index += 1u) {
			uint64_t frame = start_frame + index;
			switch (engine->config.mode) {
			case SOUNDSCAPER_SYNTHETIC_MODE_PASSTHROUGH:
				destination[index] = source[index];
				break;
			case SOUNDSCAPER_SYNTHETIC_MODE_GAIN:
				destination[index] = (float)((double)source[index] * engine->config.gain);
				break;
			case SOUNDSCAPER_SYNTHETIC_MODE_IMPULSE:
				destination[index] = frame == 0u ? 1.0f : 0.0f;
				break;
			case SOUNDSCAPER_SYNTHETIC_MODE_TONE:
			default:
				destination[index] = deterministic_sample(engine->config.generation, channel, frame);
				break;
			}
		}
	}

	engine->next_frame = start_frame + frame_count;
	engine->rendered_frames += frame_count;
	return SOUNDSCAPER_SYNTHETIC_OK;
}

uint64_t soundscaper_synthetic_rendered_frames(const soundscaper_synthetic_engine *engine)
{
	return engine == NULL ? 0u : engine->rendered_frames;
}

uint32_t soundscaper_synthetic_generation(const soundscaper_synthetic_engine *engine)
{
	return engine == NULL ? 0u : engine->config.generation;
}
