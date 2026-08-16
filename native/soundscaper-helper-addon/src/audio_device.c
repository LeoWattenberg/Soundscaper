/* SPDX-License-Identifier: AGPL-3.0-only */

#include "audio_device.h"

#include <stdlib.h>
#include <string.h>

#include "pipewire_session.h"

struct soundscaper_audio_stream {
	soundscaper_audio_backend backend;
	soundscaper_pipewire_session *pipewire;
	soundscaper_audio_session *alsa;
	int closed;
};

static void set_text(char *destination, const char *source)
{
	destination[0] = '\0';
	if (source == NULL) return;
	size_t length = strlen(source);
	if (length >= SOUNDSCAPER_AUDIO_MAX_TEXT) length = SOUNDSCAPER_AUDIO_MAX_TEXT - 1u;
	memcpy(destination, source, length);
	destination[length] = '\0';
}

/*
 * Whether a refusal is worth trying the next candidate for.
 *
 * An absent library, an absent server or an unimplemented backend describe a
 * machine that cannot provide this backend at all — the next candidate is the
 * point. A refused format or mode describes something the caller asked for and
 * this device would not give: retrying elsewhere would answer a question nobody
 * asked, and would be exactly the silent substitution the milestone stops on.
 */
static int refusal_is_an_outage(soundscaper_audio_open_status status)
{
	return status == SOUNDSCAPER_AUDIO_OPEN_BACKEND_UNAVAILABLE
		|| status == SOUNDSCAPER_AUDIO_OPEN_DEVICE_UNAVAILABLE
		|| status == SOUNDSCAPER_AUDIO_OPEN_NOT_IMPLEMENTED;
}

soundscaper_audio_open_status soundscaper_audio_stream_open(
	const soundscaper_audio_candidate *candidates,
	uint32_t candidate_count,
	soundscaper_device_direction direction,
	uint32_t exclusive_requested,
	uint32_t sample_rate,
	uint32_t period_frames,
	uint32_t channel_count,
	soundscaper_audio_stream **out_device,
	soundscaper_audio_open_report *report)
{
	if (out_device == NULL || report == NULL) return SOUNDSCAPER_AUDIO_OPEN_INVALID_REQUEST;
	*out_device = NULL;
	memset(report, 0, sizeof(*report));
	if (candidates == NULL || candidate_count == 0u || candidate_count > SOUNDSCAPER_AUDIO_MAX_CANDIDATES) {
		return SOUNDSCAPER_AUDIO_OPEN_INVALID_REQUEST;
	}

	soundscaper_audio_open_status last = SOUNDSCAPER_AUDIO_OPEN_INVALID_REQUEST;
	for (uint32_t index = 0u; index < candidate_count; index += 1u) {
		const soundscaper_audio_candidate *candidate = &candidates[index];
		soundscaper_audio_granted granted;
		memset(&granted, 0, sizeof(granted));
		soundscaper_pipewire_session *pipewire = NULL;
		soundscaper_audio_session *alsa = NULL;
		soundscaper_audio_open_status status;

		if (candidate->backend == SOUNDSCAPER_BACKEND_PIPEWIRE) {
			status = soundscaper_pipewire_open(candidate->device_handle, direction, exclusive_requested,
				sample_rate, period_frames, channel_count, &pipewire, &granted);
		} else if (candidate->backend == SOUNDSCAPER_BACKEND_ALSA) {
			status = soundscaper_audio_session_open(SOUNDSCAPER_BACKEND_ALSA, candidate->device_handle,
				direction, exclusive_requested, sample_rate, period_frames, channel_count, &alsa, &granted);
		} else {
			status = SOUNDSCAPER_AUDIO_OPEN_NOT_IMPLEMENTED;
			set_text(granted.detail, "This payload implements the PipeWire and ALSA backends only.");
		}

		soundscaper_audio_attempt *attempt = &report->attempts[report->attempt_count];
		attempt->backend = candidate->backend;
		attempt->status = status;
		set_text(attempt->device_handle, candidate->device_handle);
		set_text(attempt->detail, granted.detail);
		report->attempt_count += 1u;
		last = status;

		if (status == SOUNDSCAPER_AUDIO_OPEN_OK) {
			soundscaper_audio_stream *device = calloc(1u, sizeof(*device));
			if (device == NULL) {
				soundscaper_pipewire_close(pipewire);
				soundscaper_audio_session_close(alsa);
				return SOUNDSCAPER_AUDIO_OPEN_INVALID_REQUEST;
			}
			device->backend = candidate->backend;
			device->pipewire = pipewire;
			device->alsa = alsa;
			report->granted_backend = candidate->backend;
			report->granted = granted;
			*out_device = device;
			return SOUNDSCAPER_AUDIO_OPEN_OK;
		}
		if (!refusal_is_an_outage(status)) break;
	}
	return last;
}

void soundscaper_audio_stream_close(soundscaper_audio_stream *device)
{
	if (device == NULL || device->closed) return;
	device->closed = 1;
	soundscaper_pipewire_close(device->pipewire);
	soundscaper_audio_session_close(device->alsa);
	device->pipewire = NULL;
	device->alsa = NULL;
}

void soundscaper_audio_stream_destroy(soundscaper_audio_stream *device)
{
	soundscaper_audio_stream_close(device);
	free(device);
}

soundscaper_audio_io_status soundscaper_audio_stream_write(
	soundscaper_audio_stream *device,
	const float *const *channels,
	uint32_t frame_count,
	uint64_t *out_lost_frames)
{
	if (device == NULL || device->closed) return SOUNDSCAPER_AUDIO_IO_CLOSED;
	return device->backend == SOUNDSCAPER_BACKEND_PIPEWIRE
		? soundscaper_pipewire_write(device->pipewire, channels, frame_count, out_lost_frames)
		: soundscaper_audio_session_write(device->alsa, channels, frame_count, out_lost_frames);
}

soundscaper_audio_io_status soundscaper_audio_stream_read(
	soundscaper_audio_stream *device,
	float *const *channels,
	uint32_t frame_count,
	uint64_t *out_lost_frames)
{
	if (device == NULL || device->closed) return SOUNDSCAPER_AUDIO_IO_CLOSED;
	return device->backend == SOUNDSCAPER_BACKEND_PIPEWIRE
		? soundscaper_pipewire_read(device->pipewire, channels, frame_count, out_lost_frames)
		: soundscaper_audio_session_read(device->alsa, channels, frame_count, out_lost_frames);
}

soundscaper_audio_backend soundscaper_audio_stream_backend(const soundscaper_audio_stream *device)
{
	return device == NULL ? SOUNDSCAPER_BACKEND_COUNT : device->backend;
}

uint64_t soundscaper_audio_stream_frames(const soundscaper_audio_stream *device)
{
	if (device == NULL || device->closed) return 0u;
	return device->backend == SOUNDSCAPER_BACKEND_PIPEWIRE
		? soundscaper_pipewire_frames(device->pipewire)
		: soundscaper_audio_session_frames(device->alsa);
}

uint64_t soundscaper_audio_stream_lost_frames(const soundscaper_audio_stream *device)
{
	if (device == NULL || device->closed) return 0u;
	return device->backend == SOUNDSCAPER_BACKEND_PIPEWIRE
		? soundscaper_pipewire_lost_frames(device->pipewire)
		: soundscaper_audio_session_lost_frames(device->alsa);
}
