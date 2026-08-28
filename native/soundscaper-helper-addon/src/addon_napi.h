/* SPDX-License-Identifier: AGPL-3.0-only */

#ifndef SOUNDSCAPER_ADDON_NAPI_H
#define SOUNDSCAPER_ADDON_NAPI_H

#ifndef NAPI_VERSION
#define NAPI_VERSION 8
#endif

#include <node_api.h>

#include <stddef.h>
#include <stdint.h>

#define SOUNDSCAPER_CHECK(env, expression) \
	do { \
		if ((expression) != napi_ok) { \
			napi_throw_error((env), "SOUNDSCAPER_ADDON_FAILED", "The native helper addon call failed."); \
			return NULL; \
		} \
	} while (0)

napi_value throw_type_error(napi_env env, const char *message);
napi_value throw_range_error(napi_env env, const char *message);
int read_uint32(napi_env env, napi_value object, const char *key, uint32_t *out);
int read_double(napi_env env, napi_value object, const char *key, double *out);
int read_frame_index(napi_env env, napi_value value, uint64_t *out);
int read_channel_pointers(
	napi_env env,
	napi_value array,
	uint32_t channel_count,
	uint32_t frame_count,
	float **pointers);
int read_utf8(napi_env env, napi_value value, char *buffer, size_t capacity);
napi_value set_string(napi_env env, napi_value target, const char *key, const char *value);

#endif
