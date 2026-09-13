/* SPDX-License-Identifier: AGPL-3.0-only */

#ifndef SOUNDSCAPER_ADDON_NAPI_RUNTIME_H
#define SOUNDSCAPER_ADDON_NAPI_RUNTIME_H

/* Windows does not export a stable authenticated node.lib for renamed Electron
 * utility-process executables. Resolve the Node-API surface from the current
 * process image, just as the professional host does. */
#if defined(_WIN32)

#define SOUNDSCAPER_NAPI_DECLARE(name, arguments) \
	napi_status NAPI_CDECL soundscaper_##name arguments

SOUNDSCAPER_NAPI_DECLARE(napi_create_array_with_length,
	(napi_env env, size_t length, napi_value *result));
SOUNDSCAPER_NAPI_DECLARE(napi_create_arraybuffer,
	(napi_env env, size_t byte_length, void **data, napi_value *result));
SOUNDSCAPER_NAPI_DECLARE(napi_create_double,
	(napi_env env, double value, napi_value *result));
SOUNDSCAPER_NAPI_DECLARE(napi_create_external,
	(napi_env env, void *data, node_api_basic_finalize finalize_cb, void *finalize_hint, napi_value *result));
SOUNDSCAPER_NAPI_DECLARE(napi_create_int32,
	(napi_env env, int32_t value, napi_value *result));
SOUNDSCAPER_NAPI_DECLARE(napi_create_object, (napi_env env, napi_value *result));
SOUNDSCAPER_NAPI_DECLARE(napi_create_string_utf8,
	(napi_env env, const char *str, size_t length, napi_value *result));
SOUNDSCAPER_NAPI_DECLARE(napi_create_uint32,
	(napi_env env, uint32_t value, napi_value *result));
SOUNDSCAPER_NAPI_DECLARE(napi_define_properties,
	(napi_env env, napi_value object, size_t property_count, const napi_property_descriptor *properties));
SOUNDSCAPER_NAPI_DECLARE(napi_get_array_length,
	(napi_env env, napi_value value, uint32_t *result));
SOUNDSCAPER_NAPI_DECLARE(napi_get_boolean,
	(napi_env env, bool value, napi_value *result));
SOUNDSCAPER_NAPI_DECLARE(napi_get_cb_info,
	(napi_env env, napi_callback_info cbinfo, size_t *argc, napi_value *argv,
		napi_value *this_arg, void **data));
SOUNDSCAPER_NAPI_DECLARE(napi_get_element,
	(napi_env env, napi_value object, uint32_t index, napi_value *result));
SOUNDSCAPER_NAPI_DECLARE(napi_get_named_property,
	(napi_env env, napi_value object, const char *utf8name, napi_value *result));
SOUNDSCAPER_NAPI_DECLARE(napi_get_null, (napi_env env, napi_value *result));
SOUNDSCAPER_NAPI_DECLARE(napi_get_typedarray_info,
	(napi_env env, napi_value typedarray, napi_typedarray_type *type, size_t *length,
		void **data, napi_value *arraybuffer, size_t *byte_offset));
SOUNDSCAPER_NAPI_DECLARE(napi_get_value_double,
	(napi_env env, napi_value value, double *result));
SOUNDSCAPER_NAPI_DECLARE(napi_get_value_external,
	(napi_env env, napi_value value, void **result));
SOUNDSCAPER_NAPI_DECLARE(napi_get_value_string_utf8,
	(napi_env env, napi_value value, char *buffer, size_t buffer_size, size_t *result));
SOUNDSCAPER_NAPI_DECLARE(napi_is_array,
	(napi_env env, napi_value value, bool *result));
SOUNDSCAPER_NAPI_DECLARE(napi_set_element,
	(napi_env env, napi_value object, uint32_t index, napi_value value));
SOUNDSCAPER_NAPI_DECLARE(napi_set_named_property,
	(napi_env env, napi_value object, const char *utf8name, napi_value value));
SOUNDSCAPER_NAPI_DECLARE(napi_throw_error,
	(napi_env env, const char *code, const char *message));
SOUNDSCAPER_NAPI_DECLARE(napi_throw_range_error,
	(napi_env env, const char *code, const char *message));
SOUNDSCAPER_NAPI_DECLARE(napi_throw_type_error,
	(napi_env env, const char *code, const char *message));
SOUNDSCAPER_NAPI_DECLARE(napi_typeof,
	(napi_env env, napi_value value, napi_valuetype *result));

#undef SOUNDSCAPER_NAPI_DECLARE

#define napi_create_array_with_length soundscaper_napi_create_array_with_length
#define napi_create_arraybuffer soundscaper_napi_create_arraybuffer
#define napi_create_double soundscaper_napi_create_double
#define napi_create_external soundscaper_napi_create_external
#define napi_create_int32 soundscaper_napi_create_int32
#define napi_create_object soundscaper_napi_create_object
#define napi_create_string_utf8 soundscaper_napi_create_string_utf8
#define napi_create_uint32 soundscaper_napi_create_uint32
#define napi_define_properties soundscaper_napi_define_properties
#define napi_get_array_length soundscaper_napi_get_array_length
#define napi_get_boolean soundscaper_napi_get_boolean
#define napi_get_cb_info soundscaper_napi_get_cb_info
#define napi_get_element soundscaper_napi_get_element
#define napi_get_named_property soundscaper_napi_get_named_property
#define napi_get_null soundscaper_napi_get_null
#define napi_get_typedarray_info soundscaper_napi_get_typedarray_info
#define napi_get_value_double soundscaper_napi_get_value_double
#define napi_get_value_external soundscaper_napi_get_value_external
#define napi_get_value_string_utf8 soundscaper_napi_get_value_string_utf8
#define napi_is_array soundscaper_napi_is_array
#define napi_set_element soundscaper_napi_set_element
#define napi_set_named_property soundscaper_napi_set_named_property
#define napi_throw_error soundscaper_napi_throw_error
#define napi_throw_range_error soundscaper_napi_throw_range_error
#define napi_throw_type_error soundscaper_napi_throw_type_error
#define napi_typeof soundscaper_napi_typeof

#endif /* _WIN32 */
#endif /* SOUNDSCAPER_ADDON_NAPI_RUNTIME_H */
