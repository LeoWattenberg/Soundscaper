/* SPDX-License-Identifier: AGPL-3.0-only */

/*
 * Opening and streaming one operating-system audio device.
 *
 * Enumeration only had to read a directory of names; this actually takes a
 * device, negotiates a format with it, and moves samples. Two things about that
 * negotiation matter more than the plumbing:
 *
 * The device decides. A requested sample rate, period size or mode is a request,
 * and ALSA is free to grant something else. Every granted value is reported back
 * separately from what was asked for, because a host that quietly records the
 * request as though it were the outcome is how a project ends up believing it
 * ran at 48 kHz when the card gave it 44.1.
 *
 * Exclusive is a real distinction, not a flag. `hw:` reaches the card directly;
 * `plughw:`/`default` go through the software mixer. Asking for exclusive and
 * silently getting the mixer is exactly the substitution the milestone forbids,
 * so the granted mode is derived from the device name that actually opened.
 */

#ifndef SOUNDSCAPER_AUDIO_SESSION_H
#define SOUNDSCAPER_AUDIO_SESSION_H

#include <stdint.h>

#include "audio_backends.h"

typedef struct soundscaper_audio_session soundscaper_audio_session;

typedef enum {
	SOUNDSCAPER_AUDIO_OPEN_OK = 0,
	SOUNDSCAPER_AUDIO_OPEN_BACKEND_UNAVAILABLE = 1,
	SOUNDSCAPER_AUDIO_OPEN_DEVICE_UNAVAILABLE = 2,
	SOUNDSCAPER_AUDIO_OPEN_FORMAT_REFUSED = 3,
	SOUNDSCAPER_AUDIO_OPEN_MODE_REFUSED = 4,
	SOUNDSCAPER_AUDIO_OPEN_INVALID_REQUEST = 5,
	SOUNDSCAPER_AUDIO_OPEN_NOT_IMPLEMENTED = 6
} soundscaper_audio_open_status;

typedef enum {
	SOUNDSCAPER_AUDIO_IO_OK = 0,
	SOUNDSCAPER_AUDIO_IO_CLOSED = 1,
	SOUNDSCAPER_AUDIO_IO_INVALID_BLOCK = 2,
	SOUNDSCAPER_AUDIO_IO_WRONG_DIRECTION = 3,
	/* The stream underran or overran and was recovered; frames were lost and
	 * the count is reported so nothing can pretend the timeline is intact. */
	SOUNDSCAPER_AUDIO_IO_RECOVERED = 4,
	/* The device went away mid-stream. Never retried here: device loss is a
	 * product decision about recorded audio, not something to paper over. */
	SOUNDSCAPER_AUDIO_IO_DEVICE_LOST = 5
} soundscaper_audio_io_status;

typedef struct {
	uint32_t sample_rate;
	uint32_t period_frames;
	uint32_t channel_count;
	/* 1 when the device was reached directly rather than through the software
	 * mixer, whatever was requested. */
	uint32_t exclusive;
	char device_name[SOUNDSCAPER_AUDIO_MAX_TEXT];
	char detail[SOUNDSCAPER_AUDIO_MAX_TEXT];
} soundscaper_audio_granted;

soundscaper_audio_open_status soundscaper_audio_session_open(
	soundscaper_audio_backend backend,
	const char *device_handle,
	soundscaper_device_direction direction,
	uint32_t exclusive_requested,
	uint32_t sample_rate,
	uint32_t period_frames,
	uint32_t channel_count,
	soundscaper_audio_session **out_session,
	soundscaper_audio_granted *granted);

void soundscaper_audio_session_close(soundscaper_audio_session *session);

soundscaper_audio_io_status soundscaper_audio_session_write(
	soundscaper_audio_session *session,
	const float *const *channels,
	uint32_t frame_count,
	uint64_t *out_lost_frames);

soundscaper_audio_io_status soundscaper_audio_session_read(
	soundscaper_audio_session *session,
	float *const *channels,
	uint32_t frame_count,
	uint64_t *out_lost_frames);

uint32_t soundscaper_audio_session_channel_count(const soundscaper_audio_session *session);

uint64_t soundscaper_audio_session_frames(const soundscaper_audio_session *session);

uint64_t soundscaper_audio_session_lost_frames(const soundscaper_audio_session *session);

#endif /* SOUNDSCAPER_AUDIO_SESSION_H */
