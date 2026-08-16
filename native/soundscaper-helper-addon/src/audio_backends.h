/* SPDX-License-Identifier: AGPL-3.0-only */

/*
 * Operating-system audio backend discovery for the native helper.
 *
 * Every backend is reached through dlopen rather than a link-time dependency.
 * That is deliberate: a helper that fails to load because libasound is absent
 * would take the whole native tier down on a machine that simply has no ALSA,
 * whereas a dlopen that fails is a truthful capability report the user can be
 * shown. Backend and mode are explicit status fields for the same reason — a
 * fallback is never allowed to masquerade as the mode that was requested.
 *
 * Discovery only. Opening, streaming and device-loss handling belong to the
 * backend session surfaces, which are gated separately.
 */

#ifndef SOUNDSCAPER_AUDIO_BACKENDS_H
#define SOUNDSCAPER_AUDIO_BACKENDS_H

#include <stdint.h>
#include <stddef.h>

#define SOUNDSCAPER_AUDIO_MAX_DEVICES 128
#define SOUNDSCAPER_AUDIO_MAX_TEXT 256

typedef enum {
	SOUNDSCAPER_BACKEND_ALSA = 0,
	SOUNDSCAPER_BACKEND_JACK = 1,
	SOUNDSCAPER_BACKEND_PIPEWIRE = 2,
	SOUNDSCAPER_BACKEND_COUNT = 3
} soundscaper_audio_backend;

typedef enum {
	SOUNDSCAPER_BACKEND_AVAILABLE = 0,
	SOUNDSCAPER_BACKEND_LIBRARY_ABSENT = 1,
	SOUNDSCAPER_BACKEND_SYMBOLS_ABSENT = 2,
	SOUNDSCAPER_BACKEND_UNSUPPORTED_PLATFORM = 3,
	SOUNDSCAPER_BACKEND_SERVER_ABSENT = 4
} soundscaper_backend_status;

typedef enum {
	SOUNDSCAPER_DEVICE_INPUT = 0,
	SOUNDSCAPER_DEVICE_OUTPUT = 1,
	SOUNDSCAPER_DEVICE_DUPLEX = 2
} soundscaper_device_direction;

typedef struct {
	/* The backend-native stable identifier, never a display string. */
	char handle[SOUNDSCAPER_AUDIO_MAX_TEXT];
	char label[SOUNDSCAPER_AUDIO_MAX_TEXT];
	soundscaper_device_direction direction;
} soundscaper_audio_device;

typedef struct {
	soundscaper_backend_status status;
	/* The exact diagnostic the platform gave, bounded; empty when available. */
	char detail[SOUNDSCAPER_AUDIO_MAX_TEXT];
	uint32_t device_count;
	soundscaper_audio_device devices[SOUNDSCAPER_AUDIO_MAX_DEVICES];
} soundscaper_backend_inventory;

const char *soundscaper_audio_backend_name(soundscaper_audio_backend backend);

const char *soundscaper_backend_status_name(soundscaper_backend_status status);

/*
 * Enumerates one backend. Never partially fills an inventory: on any failure
 * the device count is zero and the status names the reason.
 */
void soundscaper_audio_backend_enumerate(
	soundscaper_audio_backend backend,
	soundscaper_backend_inventory *inventory);

#endif /* SOUNDSCAPER_AUDIO_BACKENDS_H */
