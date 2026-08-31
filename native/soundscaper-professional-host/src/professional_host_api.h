/* SPDX-License-Identifier: AGPL-3.0-only */

#ifndef SOUNDSCAPER_PROFESSIONAL_HOST_API_H
#define SOUNDSCAPER_PROFESSIONAL_HOST_API_H

#include <stddef.h>
#include <stdint.h>

#if defined(_WIN32)
#if defined(SOUNDSCAPER_PRO_STATIC)
#define SOUNDSCAPER_PRO_API
#elif defined(SOUNDSCAPER_PRO_BUILD)
#define SOUNDSCAPER_PRO_API __declspec(dllexport)
#else
#define SOUNDSCAPER_PRO_API __declspec(dllimport)
#endif
#elif defined(__GNUC__) || defined(__clang__)
#define SOUNDSCAPER_PRO_API __attribute__((visibility("default")))
#else
#define SOUNDSCAPER_PRO_API
#endif

#ifdef __cplusplus
extern "C" {
#endif

#define SOUNDSCAPER_PRO_MAX_TEXT 512u
#define SOUNDSCAPER_PRO_MAX_CHANNELS 4096u
#define SOUNDSCAPER_PRO_MAX_STATE_BYTES (16u * 1024u * 1024u)
#define SOUNDSCAPER_PRO_MAX_PLUGIN_DESCRIPTORS 256u

typedef enum soundscaper_pro_status {
	SOUNDSCAPER_PRO_OK = 0,
	SOUNDSCAPER_PRO_BACKEND_ABSENT = 1,
	SOUNDSCAPER_PRO_SERVER_ABSENT = 2,
	SOUNDSCAPER_PRO_DEVICE_UNAVAILABLE = 3,
	SOUNDSCAPER_PRO_FORMAT_REFUSED = 4,
	SOUNDSCAPER_PRO_MODE_REFUSED = 5,
	SOUNDSCAPER_PRO_PLUGIN_UNREADABLE = 6,
	SOUNDSCAPER_PRO_PLUGIN_MALFORMED = 7,
	SOUNDSCAPER_PRO_STATE_TOO_LARGE = 8,
	SOUNDSCAPER_PRO_STATE_REJECTED = 9,
	SOUNDSCAPER_PRO_UNSUPPORTED = 10
} soundscaper_pro_status;

typedef struct soundscaper_pro_audio_request {
	const char *backend;
	const char *device_handle;
	uint32_t direction;
	uint32_t exclusive;
	uint32_t sample_rate;
	uint32_t period_frames;
	uint32_t channel_count;
} soundscaper_pro_audio_request;

typedef struct soundscaper_pro_audio_result {
	soundscaper_pro_status status;
	char backend[SOUNDSCAPER_PRO_MAX_TEXT];
	char detail[SOUNDSCAPER_PRO_MAX_TEXT];
	uint32_t sample_rate;
	uint32_t period_frames;
	uint32_t channel_count;
	uint32_t exclusive;
} soundscaper_pro_audio_result;

typedef struct soundscaper_pro_plugin_description {
	soundscaper_pro_status status;
	char format[16];
	char stable_id[SOUNDSCAPER_PRO_MAX_TEXT];
	char name[SOUNDSCAPER_PRO_MAX_TEXT];
	char vendor[SOUNDSCAPER_PRO_MAX_TEXT];
	char version[SOUNDSCAPER_PRO_MAX_TEXT];
	uint32_t input_channels;
	uint32_t output_channels;
	uint32_t is_instrument;
	uint32_t latency_frames;
} soundscaper_pro_plugin_description;

typedef struct soundscaper_pro_audio_session soundscaper_pro_audio_session;
typedef struct soundscaper_pro_plugin_instance soundscaper_pro_plugin_instance;

SOUNDSCAPER_PRO_API soundscaper_pro_status soundscaper_pro_audio_enumerate(
	const char *backend, char *json, size_t capacity, size_t *written);
SOUNDSCAPER_PRO_API soundscaper_pro_audio_result soundscaper_pro_audio_open(
	const soundscaper_pro_audio_request *request, soundscaper_pro_audio_session **session);
SOUNDSCAPER_PRO_API soundscaper_pro_status soundscaper_pro_audio_read(
	soundscaper_pro_audio_session *session, float **planes, uint32_t channels, uint32_t frames);
SOUNDSCAPER_PRO_API soundscaper_pro_status soundscaper_pro_audio_write(
	soundscaper_pro_audio_session *session, const float *const *planes, uint32_t channels, uint32_t frames);
SOUNDSCAPER_PRO_API void soundscaper_pro_audio_close(soundscaper_pro_audio_session *session);

SOUNDSCAPER_PRO_API soundscaper_pro_status soundscaper_pro_plugin_scan(
	const char *format, const char *path, soundscaper_pro_plugin_description *descriptions,
	size_t capacity, size_t *written);
SOUNDSCAPER_PRO_API soundscaper_pro_status soundscaper_pro_plugin_open(
	const char *format, const char *path, const char *stable_id,
	double sample_rate, uint32_t maximum_frames,
	soundscaper_pro_plugin_instance **instance);
SOUNDSCAPER_PRO_API soundscaper_pro_status soundscaper_pro_plugin_process(
	soundscaper_pro_plugin_instance *instance, const float *const *inputs, uint32_t input_channels,
	float **outputs, uint32_t output_channels, uint32_t frames);
SOUNDSCAPER_PRO_API uint32_t soundscaper_pro_plugin_latency(soundscaper_pro_plugin_instance *instance);
SOUNDSCAPER_PRO_API soundscaper_pro_status soundscaper_pro_plugin_save_state(
	soundscaper_pro_plugin_instance *instance, uint8_t *bytes, size_t capacity, size_t *written);
SOUNDSCAPER_PRO_API soundscaper_pro_status soundscaper_pro_plugin_load_state(
	soundscaper_pro_plugin_instance *instance, const uint8_t *bytes, size_t length);
SOUNDSCAPER_PRO_API soundscaper_pro_status soundscaper_pro_plugin_open_vendor_window(
	soundscaper_pro_plugin_instance *instance, const char *opaque_window_id);
SOUNDSCAPER_PRO_API void soundscaper_pro_plugin_close_vendor_window(soundscaper_pro_plugin_instance *instance);
SOUNDSCAPER_PRO_API void soundscaper_pro_plugin_close(soundscaper_pro_plugin_instance *instance);

#ifdef __cplusplus
}
#endif

#endif
