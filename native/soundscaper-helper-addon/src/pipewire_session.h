/* SPDX-License-Identifier: AGPL-3.0-only */

/*
 * The native PipeWire backend.
 *
 * PipeWire is the session manager on every mainstream Linux desktop now, so
 * this talks to it directly rather than reaching it through its ALSA or JACK
 * compatibility layers. The difference is not cosmetic: as a real graph node we
 * appear in the user's patchbay under a name they recognise, the session
 * manager can route us, and the quantum is negotiated rather than inherited
 * from whatever the shim happened to pick.
 *
 * Two structural facts shape everything here.
 *
 * PipeWire calls `process` on its own realtime thread. That callback may not
 * allocate, may not lock, and may not block, so it exchanges samples with the
 * helper's job loop through a single-producer/single-consumer ring and nothing
 * else. Every field the callback touches is atomic.
 *
 * The library is resolved with `dlopen` and never linked. A machine with no
 * PipeWire reports an unavailable backend instead of failing to load the whole
 * addon — the same rule the ALSA and JACK discovery paths already follow. Only
 * PipeWire's headers are vendored, under their MIT licence, because the SPA
 * format builders are static inlines that `dlopen` cannot reach.
 */

#ifndef SOUNDSCAPER_PIPEWIRE_SESSION_H
#define SOUNDSCAPER_PIPEWIRE_SESSION_H

#include <stdint.h>

#include "audio_backends.h"
#include "audio_session.h"

typedef struct soundscaper_pipewire_session soundscaper_pipewire_session;

/*
 * Enumerates PipeWire's own sinks and sources. Unlike the ALSA path this needs
 * a running session, so an absent server is reported as `server-absent` rather
 * than as an empty device list.
 */
void soundscaper_pipewire_enumerate(soundscaper_backend_inventory *inventory);

soundscaper_audio_open_status soundscaper_pipewire_open(
	const char *device_handle,
	soundscaper_device_direction direction,
	uint32_t exclusive_requested,
	uint32_t sample_rate,
	uint32_t period_frames,
	uint32_t channel_count,
	soundscaper_pipewire_session **out_session,
	soundscaper_audio_granted *granted);

void soundscaper_pipewire_close(soundscaper_pipewire_session *session);

/*
 * Moves one block between the caller and the realtime ring. A short transfer is
 * reported as lost frames rather than retried: the graph has already moved on,
 * and pretending otherwise is how a take acquires silence nobody recorded.
 */
soundscaper_audio_io_status soundscaper_pipewire_write(
	soundscaper_pipewire_session *session,
	const float *const *channels,
	uint32_t frame_count,
	uint64_t *out_lost_frames);

soundscaper_audio_io_status soundscaper_pipewire_read(
	soundscaper_pipewire_session *session,
	float *const *channels,
	uint32_t frame_count,
	uint64_t *out_lost_frames);

uint64_t soundscaper_pipewire_frames(const soundscaper_pipewire_session *session);

uint64_t soundscaper_pipewire_lost_frames(const soundscaper_pipewire_session *session);

#endif /* SOUNDSCAPER_PIPEWIRE_SESSION_H */
