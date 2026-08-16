/* SPDX-License-Identifier: AGPL-3.0-only */

/*
 * One device handle over several backends.
 *
 * PipeWire is the primary Linux backend and ALSA is the backup, but "backup"
 * must not mean "quietly substituted". A device handle is backend-specific —
 * `@DEFAULT_SINK@` means nothing to ALSA and `hw:0,0` means nothing to PipeWire
 * — so there is no honest way to retry a refused open against a different
 * backend using the same name.
 *
 * The caller therefore supplies an ordered list of candidates, each naming its
 * own backend and its own device, and gets back a report of every attempt: what
 * was tried, in what order, why each earlier one was refused, and which one
 * actually opened. Nothing is inferred and nothing is hidden. A caller that
 * wants no fallback supplies one candidate.
 *
 * Refusals are not all equal, and the chain reflects that. A backend that is
 * absent or has no server is a reason to try the next candidate. A format or
 * mode the caller asked for and the device refused is a decision, not an
 * outage: the chain stops there rather than satisfying an exclusive request
 * with a shared stream on some other backend.
 */

#ifndef SOUNDSCAPER_AUDIO_DEVICE_H
#define SOUNDSCAPER_AUDIO_DEVICE_H

#include <stdint.h>

#include "audio_backends.h"
#include "audio_session.h"

#define SOUNDSCAPER_AUDIO_MAX_CANDIDATES 4

typedef struct soundscaper_audio_stream soundscaper_audio_stream;

typedef struct {
	soundscaper_audio_backend backend;
	char device_handle[SOUNDSCAPER_AUDIO_MAX_TEXT];
} soundscaper_audio_candidate;

typedef struct {
	soundscaper_audio_backend backend;
	soundscaper_audio_open_status status;
	char device_handle[SOUNDSCAPER_AUDIO_MAX_TEXT];
	char detail[SOUNDSCAPER_AUDIO_MAX_TEXT];
} soundscaper_audio_attempt;

typedef struct {
	uint32_t attempt_count;
	soundscaper_audio_attempt attempts[SOUNDSCAPER_AUDIO_MAX_CANDIDATES];
	/* Only meaningful when the open succeeded. */
	soundscaper_audio_backend granted_backend;
	soundscaper_audio_granted granted;
} soundscaper_audio_open_report;

soundscaper_audio_open_status soundscaper_audio_stream_open(
	const soundscaper_audio_candidate *candidates,
	uint32_t candidate_count,
	soundscaper_device_direction direction,
	uint32_t exclusive_requested,
	uint32_t sample_rate,
	uint32_t period_frames,
	uint32_t channel_count,
	soundscaper_audio_stream **out_device,
	soundscaper_audio_open_report *report);

/*
 * Releases the backend resources and marks the stream closed, but does NOT free
 * the handle: JavaScript still holds an external reference to it, and the
 * garbage collector's finalizer is what frees it. Closing twice, or
 * transferring after a close, must be an ordinary refusal rather than a
 * use-after-free.
 */
void soundscaper_audio_stream_close(soundscaper_audio_stream *device);

/** Frees the handle. Only the Node-API finalizer may call this. */
void soundscaper_audio_stream_destroy(soundscaper_audio_stream *device);

soundscaper_audio_io_status soundscaper_audio_stream_write(
	soundscaper_audio_stream *device,
	const float *const *channels,
	uint32_t frame_count,
	uint64_t *out_lost_frames);

soundscaper_audio_io_status soundscaper_audio_stream_read(
	soundscaper_audio_stream *device,
	float *const *channels,
	uint32_t frame_count,
	uint64_t *out_lost_frames);

soundscaper_audio_backend soundscaper_audio_stream_backend(const soundscaper_audio_stream *device);

uint64_t soundscaper_audio_stream_frames(const soundscaper_audio_stream *device);

uint64_t soundscaper_audio_stream_lost_frames(const soundscaper_audio_stream *device);

#endif /* SOUNDSCAPER_AUDIO_DEVICE_H */
