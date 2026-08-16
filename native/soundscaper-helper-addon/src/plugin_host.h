/* SPDX-License-Identifier: AGPL-3.0-only */

/*
 * Hosting one plug-in instance inside the helper process.
 *
 * This is the only place a plug-in binary stays resident, and it is reached
 * only from a supervised utility process. The host deliberately does not try to
 * survive a hostile plug-in: an abort or a hang inside `process` takes this
 * process down, which is the containment the architecture is built on. What the
 * host does guarantee is that nothing it hands back can be trusted blindly —
 * every answer is bounded here and re-validated in main.
 */

#ifndef SOUNDSCAPER_PLUGIN_HOST_H
#define SOUNDSCAPER_PLUGIN_HOST_H

#include <stdint.h>

#include "fixture_plugin_abi.h"

typedef struct soundscaper_plugin_host soundscaper_plugin_host;

typedef enum {
	SOUNDSCAPER_PLUGIN_HOST_OK = 0,
	SOUNDSCAPER_PLUGIN_HOST_UNREADABLE = 1,
	SOUNDSCAPER_PLUGIN_HOST_NO_ENTRY = 2,
	SOUNDSCAPER_PLUGIN_HOST_ABI_MISMATCH = 3,
	SOUNDSCAPER_PLUGIN_HOST_REFUSED = 4,
	SOUNDSCAPER_PLUGIN_HOST_INVALID_BLOCK = 5,
	SOUNDSCAPER_PLUGIN_HOST_STATE_TOO_LARGE = 6,
	SOUNDSCAPER_PLUGIN_HOST_STATE_REJECTED = 7
} soundscaper_plugin_host_status;

soundscaper_plugin_host_status soundscaper_plugin_host_open(
	const char *path,
	uint32_t sample_rate,
	uint32_t maximum_frames,
	soundscaper_plugin_host **out_host);

void soundscaper_plugin_host_close(soundscaper_plugin_host *host);

soundscaper_plugin_host_status soundscaper_plugin_host_process(
	soundscaper_plugin_host *host,
	uint32_t frame_count,
	const float *const *input,
	float *const *output);

/*
 * Writes at most `capacity` bytes. A plug-in that wants more than the 16 MiB
 * per-instance cap is refused with STATE_TOO_LARGE rather than truncated: a
 * truncated state that loads without complaint is worse than no state at all.
 */
soundscaper_plugin_host_status soundscaper_plugin_host_save_state(
	soundscaper_plugin_host *host,
	uint8_t *buffer,
	uint32_t capacity,
	uint32_t *out_byte_length);

soundscaper_plugin_host_status soundscaper_plugin_host_load_state(
	soundscaper_plugin_host *host,
	const uint8_t *buffer,
	uint32_t byte_length);

int32_t soundscaper_plugin_host_latency_frames(soundscaper_plugin_host *host);

uint32_t soundscaper_plugin_host_channel_count(const soundscaper_plugin_host *host);

#endif /* SOUNDSCAPER_PLUGIN_HOST_H */
