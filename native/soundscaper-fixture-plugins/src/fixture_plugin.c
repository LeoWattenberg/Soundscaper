/* SPDX-License-Identifier: AGPL-3.0-only */

/*
 * One source, built once per fixture variant.
 *
 * The scanner and host fault suites need a plug-in that really aborts, really
 * hangs, and really answers with more state than the cap allows. Simulating
 * those at the JavaScript layer would exercise the simulation rather than the
 * supervision, so each hostile behaviour here is the genuine article, selected
 * at compile time by -DSOUNDSCAPER_FIXTURE_BEHAVIOUR.
 */

#include "../../soundscaper-helper-addon/src/fixture_plugin_abi.h"

#include <stdlib.h>
#include <string.h>
#include <time.h>

#if defined(_WIN32)
#define SOUNDSCAPER_FIXTURE_EXPORT __declspec(dllexport)
#else
#define SOUNDSCAPER_FIXTURE_EXPORT __attribute__((visibility("default")))
#endif

#ifndef SOUNDSCAPER_FIXTURE_BEHAVIOUR
#define SOUNDSCAPER_FIXTURE_BEHAVIOUR SOUNDSCAPER_FIXTURE_PASSTHROUGH
#endif
#ifndef SOUNDSCAPER_FIXTURE_STABLE_ID
#define SOUNDSCAPER_FIXTURE_STABLE_ID "soundscaper.fixture.passthrough"
#endif
#ifndef SOUNDSCAPER_FIXTURE_NAME
#define SOUNDSCAPER_FIXTURE_NAME "Fixture Passthrough"
#endif
#ifndef SOUNDSCAPER_FIXTURE_CLASS
#define SOUNDSCAPER_FIXTURE_CLASS SOUNDSCAPER_FIXTURE_EFFECT
#endif
#ifndef SOUNDSCAPER_FIXTURE_LATENCY
#define SOUNDSCAPER_FIXTURE_LATENCY 0
#endif
#ifndef SOUNDSCAPER_FIXTURE_CHANNELS
#define SOUNDSCAPER_FIXTURE_CHANNELS 2
#endif

#define FIXTURE_GAIN 0.5f
#define FIXTURE_STATE_MAGIC 0x53434150u /* "SCAP" */

struct soundscaper_fixture_instance {
	uint32_t sample_rate;
	uint32_t maximum_frames;
	uint32_t processed_blocks;
	uint32_t magic;
	int32_t latency_frames;
	uint8_t state[64];
};

static void sleep_forever(void)
{
#if defined(_WIN32)
	for (;;) { }
#else
	struct timespec request = { .tv_sec = 1, .tv_nsec = 0 };
	for (;;) nanosleep(&request, NULL);
#endif
}

static soundscaper_fixture_instance *fixture_create(uint32_t sample_rate, uint32_t maximum_frames)
{
	if (sample_rate < 8000u || maximum_frames == 0u || maximum_frames > 65536u) return NULL;
	soundscaper_fixture_instance *instance = calloc(1u, sizeof(*instance));
	if (instance == NULL) return NULL;
	instance->sample_rate = sample_rate;
	instance->maximum_frames = maximum_frames;
	instance->magic = FIXTURE_STATE_MAGIC;
	instance->latency_frames = SOUNDSCAPER_FIXTURE_LATENCY;
	memset(instance->state, 0, sizeof(instance->state));
	return instance;
}

static void fixture_destroy(soundscaper_fixture_instance *instance)
{
	free(instance);
}

static int32_t fixture_process(
	soundscaper_fixture_instance *instance,
	uint32_t frame_count,
	const float *const *input,
	float *const *output)
{
	if (instance == NULL || output == NULL) return -1;
	if (frame_count == 0u || frame_count > instance->maximum_frames) return -1;
	if (SOUNDSCAPER_FIXTURE_BEHAVIOUR == SOUNDSCAPER_FIXTURE_CRASH_ON_PROCESS && instance->processed_blocks >= 2u) {
		abort();
	}
	for (uint32_t channel = 0u; channel < (uint32_t)SOUNDSCAPER_FIXTURE_CHANNELS; channel += 1u) {
		float *destination = output[channel];
		if (destination == NULL) return -1;
		const float *source = input == NULL ? NULL : input[channel];
		for (uint32_t index = 0u; index < frame_count; index += 1u) {
			switch (SOUNDSCAPER_FIXTURE_BEHAVIOUR) {
			case SOUNDSCAPER_FIXTURE_GAIN:
				destination[index] = source == NULL ? 0.0f : source[index] * FIXTURE_GAIN;
				break;
			case SOUNDSCAPER_FIXTURE_IMPULSE:
				destination[index] = (instance->processed_blocks == 0u && index == 0u) ? 1.0f : 0.0f;
				break;
			default:
				destination[index] = source == NULL ? 0.0f : source[index];
				break;
			}
		}
	}
	instance->processed_blocks += 1u;
	if (SOUNDSCAPER_FIXTURE_BEHAVIOUR == SOUNDSCAPER_FIXTURE_UNSTABLE_LATENCY) {
		/* Latency that never settles: the host must fault and bypass rather
		 * than recompile a new graph revision on every block. */
		instance->latency_frames = (int32_t)((instance->processed_blocks * 37u) % 4096u);
	}
	return 0;
}

static uint32_t fixture_save_state(soundscaper_fixture_instance *instance, uint8_t *buffer, uint32_t capacity)
{
	if (instance == NULL) return 0u;
	if (SOUNDSCAPER_FIXTURE_BEHAVIOUR == SOUNDSCAPER_FIXTURE_OVERSIZE_STATE) {
		/* Deliberately claims more than the 16 MiB per-instance cap. The host
		 * must make the instance ineligible without discarding whatever state
		 * it had already persisted. */
		return SOUNDSCAPER_FIXTURE_MAX_STATE_BYTES + 1u;
	}
	const uint32_t required = (uint32_t)sizeof(instance->state);
	if (buffer == NULL || capacity < required) return required;
	memcpy(buffer, instance->state, required);
	return required;
}

static int32_t fixture_load_state(soundscaper_fixture_instance *instance, const uint8_t *buffer, uint32_t byte_length)
{
	if (instance == NULL || buffer == NULL) return -1;
	if (byte_length != (uint32_t)sizeof(instance->state)) return -1;
	memcpy(instance->state, buffer, byte_length);
	return 0;
}

static int32_t fixture_latency_frames(soundscaper_fixture_instance *instance)
{
	return instance == NULL ? SOUNDSCAPER_FIXTURE_LATENCY : instance->latency_frames;
}

static const soundscaper_fixture_descriptor DESCRIPTOR = {
	.abi_version = SOUNDSCAPER_FIXTURE_ABI_VERSION,
	.stable_id = SOUNDSCAPER_FIXTURE_STABLE_ID,
	.name = SOUNDSCAPER_FIXTURE_NAME,
	.vendor = "Soundscaper fixtures",
	.version = "1.0.0",
	.classification = SOUNDSCAPER_FIXTURE_CLASS,
	.input_channels = SOUNDSCAPER_FIXTURE_CHANNELS,
	.output_channels = SOUNDSCAPER_FIXTURE_CHANNELS,
	.realtime = 1u,
	.offline = 1u,
	.reported_latency_frames = SOUNDSCAPER_FIXTURE_LATENCY,
	.behaviour = SOUNDSCAPER_FIXTURE_BEHAVIOUR,
	.create = fixture_create,
	.destroy = fixture_destroy,
	.process = fixture_process,
	.save_state = fixture_save_state,
	.load_state = fixture_load_state,
	.latency_frames = fixture_latency_frames,
};

SOUNDSCAPER_FIXTURE_EXPORT const soundscaper_fixture_descriptor *soundscaper_fixture_entry_v1(void)
{
	if (SOUNDSCAPER_FIXTURE_BEHAVIOUR == SOUNDSCAPER_FIXTURE_CRASH_ON_SCAN) abort();
	if (SOUNDSCAPER_FIXTURE_BEHAVIOUR == SOUNDSCAPER_FIXTURE_HANG_ON_SCAN) sleep_forever();
	return &DESCRIPTOR;
}
