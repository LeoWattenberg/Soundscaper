/* SPDX-License-Identifier: AGPL-3.0-only */

#include "audio_session.h"

#include <stdlib.h>
#include <string.h>

#if defined(__linux__)
#define SOUNDSCAPER_AUDIO_SESSION_ALSA 1
#include <dlfcn.h>
#else
#define SOUNDSCAPER_AUDIO_SESSION_ALSA 0
#endif

/*
 * ALSA ABI constants. They are part of the stable published interface rather
 * than something we compute, so they are named here instead of pulling the
 * header in — the addon must build on a machine with no libasound headers and
 * still refuse cleanly at runtime when the library is absent.
 */
#define ALSA_STREAM_PLAYBACK 0
#define ALSA_STREAM_CAPTURE 1
#define ALSA_ACCESS_RW_INTERLEAVED 3
#define ALSA_FORMAT_FLOAT_LE 14

#define SOUNDSCAPER_AUDIO_MAX_PERIOD_FRAMES 16384u

#if SOUNDSCAPER_AUDIO_SESSION_ALSA

typedef struct {
	void *library;
	int (*open)(void **, const char *, int, int);
	int (*close)(void *);
	int (*prepare)(void *);
	int (*recover)(void *, int, int);
	long (*writei)(void *, const void *, unsigned long);
	long (*readi)(void *, void *, unsigned long);
	int (*hw_params_malloc)(void **);
	void (*hw_params_free)(void *);
	int (*hw_params_any)(void *, void *);
	int (*hw_params_set_access)(void *, void *, int);
	int (*hw_params_set_format)(void *, void *, int);
	int (*hw_params_set_channels)(void *, void *, unsigned int);
	int (*hw_params_set_rate_near)(void *, void *, unsigned int *, int *);
	int (*hw_params_set_period_size_near)(void *, void *, unsigned long *, int *);
	int (*hw_params)(void *, void *);
	int (*hw_params_get_rate)(const void *, unsigned int *, int *);
	int (*hw_params_get_period_size)(const void *, unsigned long *, int *);
	const char *(*strerror)(int);
} alsa_api;

static int load_alsa(alsa_api *api)
{
	memset(api, 0, sizeof(*api));
	api->library = dlopen("libasound.so.2", RTLD_LAZY | RTLD_LOCAL);
	if (api->library == NULL) api->library = dlopen("libasound.so", RTLD_LAZY | RTLD_LOCAL);
	if (api->library == NULL) return 0;
	#define BIND(field, symbol) \
		do { \
			*(void **)(&api->field) = dlsym(api->library, symbol); \
			if (api->field == NULL) { dlclose(api->library); api->library = NULL; return 0; } \
		} while (0)
	BIND(open, "snd_pcm_open");
	BIND(close, "snd_pcm_close");
	BIND(prepare, "snd_pcm_prepare");
	BIND(recover, "snd_pcm_recover");
	BIND(writei, "snd_pcm_writei");
	BIND(readi, "snd_pcm_readi");
	BIND(hw_params_malloc, "snd_pcm_hw_params_malloc");
	BIND(hw_params_free, "snd_pcm_hw_params_free");
	BIND(hw_params_any, "snd_pcm_hw_params_any");
	BIND(hw_params_set_access, "snd_pcm_hw_params_set_access");
	BIND(hw_params_set_format, "snd_pcm_hw_params_set_format");
	BIND(hw_params_set_channels, "snd_pcm_hw_params_set_channels");
	BIND(hw_params_set_rate_near, "snd_pcm_hw_params_set_rate_near");
	BIND(hw_params_set_period_size_near, "snd_pcm_hw_params_set_period_size_near");
	BIND(hw_params, "snd_pcm_hw_params");
	BIND(hw_params_get_rate, "snd_pcm_hw_params_get_rate");
	BIND(hw_params_get_period_size, "snd_pcm_hw_params_get_period_size");
	BIND(strerror, "snd_strerror");
	#undef BIND
	return 1;
}

#endif /* SOUNDSCAPER_AUDIO_SESSION_ALSA */

struct soundscaper_audio_session {
#if SOUNDSCAPER_AUDIO_SESSION_ALSA
	alsa_api alsa;
	void *pcm;
#endif
	soundscaper_device_direction direction;
	uint32_t channel_count;
	uint32_t period_frames;
	uint64_t frames;
	uint64_t lost_frames;
	float *interleaved;
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
 * `hw:` reaches the card; everything else goes through the plug/dmix layer. The
 * granted mode is read back from the name that actually opened rather than from
 * the request, so a caller cannot be told it has the device to itself when the
 * software mixer is in the path.
 */
static int name_is_exclusive(const char *name)
{
	return name != NULL && strncmp(name, "hw:", 3u) == 0;
}

soundscaper_audio_open_status soundscaper_audio_session_open(
	soundscaper_audio_backend backend,
	const char *device_handle,
	soundscaper_device_direction direction,
	uint32_t exclusive_requested,
	uint32_t sample_rate,
	uint32_t period_frames,
	uint32_t channel_count,
	soundscaper_audio_session **out_session,
	soundscaper_audio_granted *granted)
{
	if (out_session == NULL || granted == NULL) return SOUNDSCAPER_AUDIO_OPEN_INVALID_REQUEST;
	*out_session = NULL;
	memset(granted, 0, sizeof(*granted));
	if (device_handle == NULL || device_handle[0] == '\0'
		|| channel_count == 0u || channel_count > SOUNDSCAPER_AUDIO_MAX_DEVICES
		|| period_frames == 0u || period_frames > SOUNDSCAPER_AUDIO_MAX_PERIOD_FRAMES
		|| sample_rate < 8000u || sample_rate > 768000u
		|| direction == SOUNDSCAPER_DEVICE_DUPLEX) {
		/* Duplex is refused rather than faked from two half-duplex handles: the
		 * two would drift and nothing here could report by how much. */
		set_text(granted->detail, "The open request is outside the admitted bounds, or asks for duplex.");
		return SOUNDSCAPER_AUDIO_OPEN_INVALID_REQUEST;
	}
#if SOUNDSCAPER_AUDIO_SESSION_ALSA
	if (backend != SOUNDSCAPER_BACKEND_ALSA) {
		set_text(granted->detail, "This payload opens ALSA devices only; JACK streaming is not implemented.");
		return SOUNDSCAPER_AUDIO_OPEN_NOT_IMPLEMENTED;
	}
	soundscaper_audio_session *session = calloc(1u, sizeof(*session));
	if (session == NULL) return SOUNDSCAPER_AUDIO_OPEN_INVALID_REQUEST;
	if (!load_alsa(&session->alsa)) {
		free(session);
		set_text(granted->detail, "libasound could not be loaded on this system.");
		return SOUNDSCAPER_AUDIO_OPEN_BACKEND_UNAVAILABLE;
	}
	const int stream = direction == SOUNDSCAPER_DEVICE_INPUT ? ALSA_STREAM_CAPTURE : ALSA_STREAM_PLAYBACK;
	int opened = session->alsa.open(&session->pcm, device_handle, stream, 0);
	if (opened < 0) {
		set_text(granted->detail, session->alsa.strerror(opened));
		dlclose(session->alsa.library);
		free(session);
		return SOUNDSCAPER_AUDIO_OPEN_DEVICE_UNAVAILABLE;
	}
	/* An exclusive request that resolved to a shared name is refused outright.
	 * Falling back here would be the silent substitution the milestone stops
	 * on; the caller decides whether shared is acceptable. */
	if (exclusive_requested && !name_is_exclusive(device_handle)) {
		session->alsa.close(session->pcm);
		dlclose(session->alsa.library);
		free(session);
		set_text(granted->detail, "Exclusive access was requested but that device name reaches the software mixer.");
		return SOUNDSCAPER_AUDIO_OPEN_MODE_REFUSED;
	}

	void *params = NULL;
	if (session->alsa.hw_params_malloc(&params) < 0) {
		session->alsa.close(session->pcm);
		dlclose(session->alsa.library);
		free(session);
		return SOUNDSCAPER_AUDIO_OPEN_FORMAT_REFUSED;
	}
	unsigned int rate = sample_rate;
	unsigned long period = period_frames;
	int direction_hint = 0;
	int failed = session->alsa.hw_params_any(session->pcm, params) < 0
		|| session->alsa.hw_params_set_access(session->pcm, params, ALSA_ACCESS_RW_INTERLEAVED) < 0
		|| session->alsa.hw_params_set_format(session->pcm, params, ALSA_FORMAT_FLOAT_LE) < 0
		|| session->alsa.hw_params_set_channels(session->pcm, params, channel_count) < 0
		|| session->alsa.hw_params_set_rate_near(session->pcm, params, &rate, &direction_hint) < 0
		|| session->alsa.hw_params_set_period_size_near(session->pcm, params, &period, &direction_hint) < 0
		|| session->alsa.hw_params(session->pcm, params) < 0;
	if (!failed) {
		/* Read the values back rather than trusting the ones we passed in:
		 * `_near` means the device may have chosen something else entirely. */
		session->alsa.hw_params_get_rate(params, &rate, &direction_hint);
		session->alsa.hw_params_get_period_size(params, &period, &direction_hint);
	}
	session->alsa.hw_params_free(params);
	if (failed || period == 0u || period > SOUNDSCAPER_AUDIO_MAX_PERIOD_FRAMES) {
		session->alsa.close(session->pcm);
		dlclose(session->alsa.library);
		free(session);
		set_text(granted->detail, "The device refused float32 interleaved at the requested topology.");
		return SOUNDSCAPER_AUDIO_OPEN_FORMAT_REFUSED;
	}
	session->interleaved = calloc((size_t)period * channel_count, sizeof(float));
	if (session->interleaved == NULL) {
		session->alsa.close(session->pcm);
		dlclose(session->alsa.library);
		free(session);
		return SOUNDSCAPER_AUDIO_OPEN_FORMAT_REFUSED;
	}
	session->alsa.prepare(session->pcm);
	session->direction = direction;
	session->channel_count = channel_count;
	session->period_frames = (uint32_t)period;
	granted->sample_rate = rate;
	granted->period_frames = (uint32_t)period;
	granted->channel_count = channel_count;
	granted->exclusive = name_is_exclusive(device_handle) ? 1u : 0u;
	set_text(granted->device_name, device_handle);
	*out_session = session;
	return SOUNDSCAPER_AUDIO_OPEN_OK;
#else
	(void)backend;
	(void)exclusive_requested;
	set_text(granted->detail, "This target does not implement operating-system audio sessions.");
	return SOUNDSCAPER_AUDIO_OPEN_NOT_IMPLEMENTED;
#endif
}

void soundscaper_audio_session_close(soundscaper_audio_session *session)
{
	if (session == NULL) return;
#if SOUNDSCAPER_AUDIO_SESSION_ALSA
	/* Exactly once: a second close must not reach ALSA with a freed handle. */
	if (!session->closed && session->pcm != NULL) session->alsa.close(session->pcm);
	if (session->alsa.library != NULL) dlclose(session->alsa.library);
#endif
	session->closed = 1;
	free(session->interleaved);
	free(session);
}

#if SOUNDSCAPER_AUDIO_SESSION_ALSA

static soundscaper_audio_io_status settle(
	soundscaper_audio_session *session,
	long result,
	uint32_t frame_count,
	uint64_t *out_lost_frames)
{
	if (result >= 0) {
		session->frames += (uint64_t)result;
		if ((uint32_t)result < frame_count) {
			// A short transfer is lost time, not a retry: reporting it is what
			// lets the caller decide whether the take is still usable.
			const uint64_t lost = frame_count - (uint64_t)result;
			session->lost_frames += lost;
			if (out_lost_frames != NULL) *out_lost_frames = lost;
			return SOUNDSCAPER_AUDIO_IO_RECOVERED;
		}
		return SOUNDSCAPER_AUDIO_IO_OK;
	}
	/* -ENODEV / -ENOTTY / -EPIPE all arrive as negative errno. Recovery is
	 * attempted once for the transient ones; a device that is gone stays gone. */
	if (session->alsa.recover(session->pcm, (int)result, 1) < 0) {
		return SOUNDSCAPER_AUDIO_IO_DEVICE_LOST;
	}
	session->lost_frames += frame_count;
	if (out_lost_frames != NULL) *out_lost_frames = frame_count;
	return SOUNDSCAPER_AUDIO_IO_RECOVERED;
}

#endif

soundscaper_audio_io_status soundscaper_audio_session_write(
	soundscaper_audio_session *session,
	const float *const *channels,
	uint32_t frame_count,
	uint64_t *out_lost_frames)
{
	if (out_lost_frames != NULL) *out_lost_frames = 0u;
	if (session == NULL || session->closed) return SOUNDSCAPER_AUDIO_IO_CLOSED;
	if (session->direction != SOUNDSCAPER_DEVICE_OUTPUT) return SOUNDSCAPER_AUDIO_IO_WRONG_DIRECTION;
	if (channels == NULL || frame_count == 0u || frame_count > session->period_frames) {
		return SOUNDSCAPER_AUDIO_IO_INVALID_BLOCK;
	}
#if SOUNDSCAPER_AUDIO_SESSION_ALSA
	for (uint32_t channel = 0u; channel < session->channel_count; channel += 1u) {
		if (channels[channel] == NULL) return SOUNDSCAPER_AUDIO_IO_INVALID_BLOCK;
		for (uint32_t frame = 0u; frame < frame_count; frame += 1u) {
			session->interleaved[(size_t)frame * session->channel_count + channel] = channels[channel][frame];
		}
	}
	return settle(session, session->alsa.writei(session->pcm, session->interleaved, frame_count),
		frame_count, out_lost_frames);
#else
	return SOUNDSCAPER_AUDIO_IO_CLOSED;
#endif
}

soundscaper_audio_io_status soundscaper_audio_session_read(
	soundscaper_audio_session *session,
	float *const *channels,
	uint32_t frame_count,
	uint64_t *out_lost_frames)
{
	if (out_lost_frames != NULL) *out_lost_frames = 0u;
	if (session == NULL || session->closed) return SOUNDSCAPER_AUDIO_IO_CLOSED;
	if (session->direction != SOUNDSCAPER_DEVICE_INPUT) return SOUNDSCAPER_AUDIO_IO_WRONG_DIRECTION;
	if (channels == NULL || frame_count == 0u || frame_count > session->period_frames) {
		return SOUNDSCAPER_AUDIO_IO_INVALID_BLOCK;
	}
#if SOUNDSCAPER_AUDIO_SESSION_ALSA
	const long result = session->alsa.readi(session->pcm, session->interleaved, frame_count);
	const uint32_t captured = result > 0 ? (uint32_t)result : 0u;
	for (uint32_t channel = 0u; channel < session->channel_count; channel += 1u) {
		if (channels[channel] == NULL) return SOUNDSCAPER_AUDIO_IO_INVALID_BLOCK;
		for (uint32_t frame = 0u; frame < captured; frame += 1u) {
			channels[channel][frame] = session->interleaved[(size_t)frame * session->channel_count + channel];
		}
		/* Frames the device did not deliver are left untouched rather than
		 * zero-filled: silence written into a take is indistinguishable from
		 * silence that was recorded, and the caller is told the count instead. */
	}
	return settle(session, result, frame_count, out_lost_frames);
#else
	return SOUNDSCAPER_AUDIO_IO_CLOSED;
#endif
}

uint64_t soundscaper_audio_session_frames(const soundscaper_audio_session *session)
{
	return session == NULL ? 0u : session->frames;
}

uint64_t soundscaper_audio_session_lost_frames(const soundscaper_audio_session *session)
{
	return session == NULL ? 0u : session->lost_frames;
}
