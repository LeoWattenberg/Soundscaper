/* SPDX-License-Identifier: AGPL-3.0-only */

/*
 * The benign fixture plug-in ABI.
 *
 * Milestone 5A-3 says to add benign format fixtures before any real format, and
 * the licensing register keeps VST3, CLAP, Audio Units and LV2 fail-closed until
 * their source, licence and notice rows pass. The gate does not bend for
 * convenience, so the scanner and host machinery is proven against this format
 * instead: it is our own code under our own licence, it exercises every path a
 * real format will — descriptors, classification, topology, latency, opaque
 * state, crashes, hangs, oversize answers — and it is never offered to a user.
 *
 * A fixture is an ordinary shared library exporting `soundscaper_fixture_entry_v1`.
 * Nothing here is a stand-in for a real plug-in SDK; when a format's gate opens,
 * its adapter implements the same helper-side surface this one does.
 */

#ifndef SOUNDSCAPER_FIXTURE_PLUGIN_ABI_H
#define SOUNDSCAPER_FIXTURE_PLUGIN_ABI_H

#include <stdint.h>
#include <stddef.h>

#define SOUNDSCAPER_FIXTURE_ABI_VERSION 1u
#define SOUNDSCAPER_FIXTURE_ENTRY_SYMBOL "soundscaper_fixture_entry_v1"
#define SOUNDSCAPER_FIXTURE_MAX_TEXT 256u
#define SOUNDSCAPER_FIXTURE_MAX_STATE_BYTES (16u * 1024u * 1024u)

typedef enum {
	SOUNDSCAPER_FIXTURE_EFFECT = 0,
	SOUNDSCAPER_FIXTURE_INSTRUMENT = 1
} soundscaper_fixture_class;

typedef enum {
	/* Benign behaviours the goldens are written against. */
	SOUNDSCAPER_FIXTURE_PASSTHROUGH = 0,
	SOUNDSCAPER_FIXTURE_GAIN = 1,
	SOUNDSCAPER_FIXTURE_IMPULSE = 2,
	/* Hostile behaviours the fault suites need to be real rather than simulated. */
	SOUNDSCAPER_FIXTURE_CRASH_ON_SCAN = 3,
	SOUNDSCAPER_FIXTURE_HANG_ON_SCAN = 4,
	SOUNDSCAPER_FIXTURE_CRASH_ON_PROCESS = 5,
	SOUNDSCAPER_FIXTURE_OVERSIZE_STATE = 6,
	SOUNDSCAPER_FIXTURE_UNSTABLE_LATENCY = 7
} soundscaper_fixture_behaviour;

typedef struct soundscaper_fixture_instance soundscaper_fixture_instance;

typedef struct {
	uint32_t abi_version;
	const char *stable_id;
	const char *name;
	const char *vendor;
	const char *version;
	uint32_t classification;
	uint32_t input_channels;
	uint32_t output_channels;
	uint32_t realtime;
	uint32_t offline;
	/* Negative means the plug-in does not report a latency, which is different
	 * from reporting zero and must survive the whole pipeline as different. */
	int32_t reported_latency_frames;
	uint32_t behaviour;

	soundscaper_fixture_instance *(*create)(uint32_t sample_rate, uint32_t maximum_frames);
	void (*destroy)(soundscaper_fixture_instance *instance);
	/* Returns 0 on success. `input` may be NULL for a generator. */
	int32_t (*process)(soundscaper_fixture_instance *instance,
		uint32_t frame_count,
		const float *const *input,
		float *const *output);
	/* Returns the byte length written, or the required length when `capacity`
	 * is too small; the host treats a length over its cap as ineligible rather
	 * than truncating, so an oversize answer can never be silently accepted. */
	uint32_t (*save_state)(soundscaper_fixture_instance *instance, uint8_t *buffer, uint32_t capacity);
	int32_t (*load_state)(soundscaper_fixture_instance *instance, const uint8_t *buffer, uint32_t byte_length);
	int32_t (*latency_frames)(soundscaper_fixture_instance *instance);
} soundscaper_fixture_descriptor;

typedef const soundscaper_fixture_descriptor *(*soundscaper_fixture_entry_fn)(void);

#endif /* SOUNDSCAPER_FIXTURE_PLUGIN_ABI_H */
