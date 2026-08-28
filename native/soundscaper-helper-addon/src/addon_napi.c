/* SPDX-License-Identifier: AGPL-3.0-only */

#include "addon_napi.h"

napi_value throw_type_error(napi_env env, const char *message)
{
	napi_throw_type_error(env, "SOUNDSCAPER_ADDON_INVALID_ARGUMENT", message);
	return NULL;
}

napi_value throw_range_error(napi_env env, const char *message)
{
	napi_throw_range_error(env, "SOUNDSCAPER_ADDON_INVALID_ARGUMENT", message);
	return NULL;
}

int read_uint32(napi_env env, napi_value object, const char *key, uint32_t *out)
{
	napi_value value;
	if (napi_get_named_property(env, object, key, &value) != napi_ok) return 0;
	napi_valuetype type;
	if (napi_typeof(env, value, &type) != napi_ok || type != napi_number) return 0;
	double number;
	if (napi_get_value_double(env, value, &number) != napi_ok) return 0;
	if (!(number >= 0.0 && number <= 4294967295.0) || number != (double)(uint32_t)number) return 0;
	*out = (uint32_t)number;
	return 1;
}

int read_double(napi_env env, napi_value object, const char *key, double *out)
{
	napi_value value;
	if (napi_get_named_property(env, object, key, &value) != napi_ok) return 0;
	napi_valuetype type;
	if (napi_typeof(env, value, &type) != napi_ok || type != napi_number) return 0;
	return napi_get_value_double(env, value, out) == napi_ok;
}

int read_frame_index(napi_env env, napi_value value, uint64_t *out)
{
	napi_valuetype type;
	if (napi_typeof(env, value, &type) != napi_ok || type != napi_number) return 0;
	double number;
	if (napi_get_value_double(env, value, &number) != napi_ok) return 0;
	/* Frame indices stay inside the exact double integer range so both sides
	 * agree without BigInt in the per-block path. */
	if (!(number >= 0.0 && number <= 9007199254740991.0)) return 0;
	if (number != (double)(uint64_t)number) return 0;
	*out = (uint64_t)number;
	return 1;
}

int read_channel_pointers(
	napi_env env,
	napi_value array,
	uint32_t channel_count,
	uint32_t frame_count,
	float **pointers)
{
	bool is_array = false;
	if (napi_is_array(env, array, &is_array) != napi_ok || !is_array) return 0;
	uint32_t length = 0;
	if (napi_get_array_length(env, array, &length) != napi_ok || length != channel_count) return 0;
	for (uint32_t index = 0; index < channel_count; index += 1u) {
		napi_value element;
		if (napi_get_element(env, array, index, &element) != napi_ok) return 0;
		napi_typedarray_type element_type;
		size_t element_length = 0;
		void *data = NULL;
		if (napi_get_typedarray_info(env, element, &element_type, &element_length, &data, NULL, NULL) != napi_ok) {
			return 0;
		}
		if (element_type != napi_float32_array || data == NULL || element_length < (size_t)frame_count) return 0;
		pointers[index] = (float *)data;
	}
	return 1;
}

int read_utf8(napi_env env, napi_value value, char *buffer, size_t capacity)
{
	size_t written = 0;
	size_t length = 0;
	napi_valuetype type;
	if (napi_typeof(env, value, &type) != napi_ok || type != napi_string) return 0;
	/* The length is asked for first because the copy truncates silently and
	 * reports the truncated length as a success: a cut-down path names a
	 * different file, and a cut-down handle a different device. */
	if (napi_get_value_string_utf8(env, value, NULL, 0, &length) != napi_ok) return 0;
	if (length == 0 || length + 1u > capacity) return 0;
	if (napi_get_value_string_utf8(env, value, buffer, capacity, &written) != napi_ok) return 0;
	return written == length;
}

napi_value set_string(napi_env env, napi_value target, const char *key, const char *value)
{
	napi_value text;
	SOUNDSCAPER_CHECK(env, napi_create_string_utf8(env, value, NAPI_AUTO_LENGTH, &text));
	SOUNDSCAPER_CHECK(env, napi_set_named_property(env, target, key, text));
	return target;
}
