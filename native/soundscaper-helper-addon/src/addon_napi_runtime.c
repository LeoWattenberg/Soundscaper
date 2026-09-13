/* SPDX-License-Identifier: AGPL-3.0-only */

#include <node_api.h>

#if defined(_WIN32)

#include <windows.h>

static FARPROC soundscaper_napi_symbol(const char *name)
{
	HMODULE module = GetModuleHandleW(NULL);
	return module == NULL ? NULL : GetProcAddress(module, name);
}

#define SOUNDSCAPER_NAPI_FORWARD(name, arguments, invocation) \
	napi_status NAPI_CDECL soundscaper_##name arguments \
	{ \
		typedef napi_status (NAPI_CDECL *function_type) arguments; \
		function_type function = (function_type)soundscaper_napi_symbol(#name); \
		return function == NULL ? napi_generic_failure : function invocation; \
	}

SOUNDSCAPER_NAPI_FORWARD(napi_create_array_with_length,
	(napi_env env, size_t length, napi_value *result), (env, length, result))
SOUNDSCAPER_NAPI_FORWARD(napi_create_arraybuffer,
	(napi_env env, size_t byte_length, void **data, napi_value *result),
	(env, byte_length, data, result))
SOUNDSCAPER_NAPI_FORWARD(napi_create_double,
	(napi_env env, double value, napi_value *result), (env, value, result))
SOUNDSCAPER_NAPI_FORWARD(napi_create_external,
	(napi_env env, void *data, node_api_basic_finalize finalize_cb, void *finalize_hint, napi_value *result),
	(env, data, finalize_cb, finalize_hint, result))
SOUNDSCAPER_NAPI_FORWARD(napi_create_int32,
	(napi_env env, int32_t value, napi_value *result), (env, value, result))
SOUNDSCAPER_NAPI_FORWARD(napi_create_object,
	(napi_env env, napi_value *result), (env, result))
SOUNDSCAPER_NAPI_FORWARD(napi_create_string_utf8,
	(napi_env env, const char *str, size_t length, napi_value *result), (env, str, length, result))
SOUNDSCAPER_NAPI_FORWARD(napi_create_uint32,
	(napi_env env, uint32_t value, napi_value *result), (env, value, result))
SOUNDSCAPER_NAPI_FORWARD(napi_define_properties,
	(napi_env env, napi_value object, size_t count, const napi_property_descriptor *properties),
	(env, object, count, properties))
SOUNDSCAPER_NAPI_FORWARD(napi_get_array_length,
	(napi_env env, napi_value value, uint32_t *result), (env, value, result))
SOUNDSCAPER_NAPI_FORWARD(napi_get_boolean,
	(napi_env env, bool value, napi_value *result), (env, value, result))
SOUNDSCAPER_NAPI_FORWARD(napi_get_cb_info,
	(napi_env env, napi_callback_info info, size_t *argc, napi_value *argv, napi_value *this_arg, void **data),
	(env, info, argc, argv, this_arg, data))
SOUNDSCAPER_NAPI_FORWARD(napi_get_element,
	(napi_env env, napi_value object, uint32_t index, napi_value *result),
	(env, object, index, result))
SOUNDSCAPER_NAPI_FORWARD(napi_get_named_property,
	(napi_env env, napi_value object, const char *name, napi_value *result),
	(env, object, name, result))
SOUNDSCAPER_NAPI_FORWARD(napi_get_null,
	(napi_env env, napi_value *result), (env, result))
SOUNDSCAPER_NAPI_FORWARD(napi_get_typedarray_info,
	(napi_env env, napi_value value, napi_typedarray_type *type, size_t *length,
		void **data, napi_value *arraybuffer, size_t *byte_offset),
	(env, value, type, length, data, arraybuffer, byte_offset))
SOUNDSCAPER_NAPI_FORWARD(napi_get_value_double,
	(napi_env env, napi_value value, double *result), (env, value, result))
SOUNDSCAPER_NAPI_FORWARD(napi_get_value_external,
	(napi_env env, napi_value value, void **result), (env, value, result))
SOUNDSCAPER_NAPI_FORWARD(napi_get_value_string_utf8,
	(napi_env env, napi_value value, char *buffer, size_t size, size_t *result),
	(env, value, buffer, size, result))
SOUNDSCAPER_NAPI_FORWARD(napi_is_array,
	(napi_env env, napi_value value, bool *result), (env, value, result))
SOUNDSCAPER_NAPI_FORWARD(napi_set_element,
	(napi_env env, napi_value object, uint32_t index, napi_value value),
	(env, object, index, value))
SOUNDSCAPER_NAPI_FORWARD(napi_set_named_property,
	(napi_env env, napi_value object, const char *name, napi_value value),
	(env, object, name, value))
SOUNDSCAPER_NAPI_FORWARD(napi_throw_error,
	(napi_env env, const char *code, const char *message), (env, code, message))
SOUNDSCAPER_NAPI_FORWARD(napi_throw_range_error,
	(napi_env env, const char *code, const char *message), (env, code, message))
SOUNDSCAPER_NAPI_FORWARD(napi_throw_type_error,
	(napi_env env, const char *code, const char *message), (env, code, message))
SOUNDSCAPER_NAPI_FORWARD(napi_typeof,
	(napi_env env, napi_value value, napi_valuetype *result), (env, value, result))

#undef SOUNDSCAPER_NAPI_FORWARD

#endif /* _WIN32 */
