/* SPDX-License-Identifier: AGPL-3.0-only */

#pragma once

/** Resolve Electron's in-process Node-API exports without an unauthenticated node.lib. */

#include <node_api.h>

#if defined(_WIN32)

#define WIN32_LEAN_AND_MEAN
#define NOMINMAX
#include <windows.h>

namespace soundscaper::node_api_runtime {

struct NodeApi {
	decltype(&::napi_call_function) callFunction = nullptr;
	decltype(&::napi_create_array) createArray = nullptr;
	decltype(&::napi_create_array_with_length) createArrayWithLength = nullptr;
	decltype(&::napi_create_double) createDouble = nullptr;
	decltype(&::napi_create_external) createExternal = nullptr;
	decltype(&::napi_create_object) createObject = nullptr;
	decltype(&::napi_create_string_utf8) createString = nullptr;
	decltype(&::napi_define_properties) defineProperties = nullptr;
	decltype(&::napi_get_array_length) getArrayLength = nullptr;
	decltype(&::napi_get_boolean) getBoolean = nullptr;
	decltype(&::napi_get_cb_info) getCallbackInfo = nullptr;
	decltype(&::napi_get_element) getElement = nullptr;
	decltype(&::napi_get_global) getGlobal = nullptr;
	decltype(&::napi_get_named_property) getProperty = nullptr;
	decltype(&::napi_get_typedarray_info) getTypedArrayInfo = nullptr;
	decltype(&::napi_get_value_double) getDouble = nullptr;
	decltype(&::napi_get_value_external) getExternal = nullptr;
	decltype(&::napi_get_value_string_utf8) getString = nullptr;
	decltype(&::napi_get_value_uint32) getUnsigned = nullptr;
	decltype(&::napi_set_element) setElement = nullptr;
	decltype(&::napi_set_named_property) setProperty = nullptr;
	decltype(&::napi_throw_error) throwError = nullptr;
	decltype(&::napi_throw_type_error) throwTypeError = nullptr;
	bool complete = false;
};

template<typename Function>
Function symbol(HMODULE module, const char *name)
{
	return reinterpret_cast<Function>(GetProcAddress(module, name));
}

inline const NodeApi &api()
{
	static const NodeApi value = [] {
		NodeApi result{};
		const HMODULE module = GetModuleHandleW(nullptr);
		if (module == nullptr) return result;
#define SOUNDSCAPER_NODE_API_SYMBOL(field, name) \
		result.field = symbol<decltype(result.field)>(module, #name)
		SOUNDSCAPER_NODE_API_SYMBOL(callFunction, napi_call_function);
		SOUNDSCAPER_NODE_API_SYMBOL(createArray, napi_create_array);
		SOUNDSCAPER_NODE_API_SYMBOL(createArrayWithLength, napi_create_array_with_length);
		SOUNDSCAPER_NODE_API_SYMBOL(createDouble, napi_create_double);
		SOUNDSCAPER_NODE_API_SYMBOL(createExternal, napi_create_external);
		SOUNDSCAPER_NODE_API_SYMBOL(createObject, napi_create_object);
		SOUNDSCAPER_NODE_API_SYMBOL(createString, napi_create_string_utf8);
		SOUNDSCAPER_NODE_API_SYMBOL(defineProperties, napi_define_properties);
		SOUNDSCAPER_NODE_API_SYMBOL(getArrayLength, napi_get_array_length);
		SOUNDSCAPER_NODE_API_SYMBOL(getBoolean, napi_get_boolean);
		SOUNDSCAPER_NODE_API_SYMBOL(getCallbackInfo, napi_get_cb_info);
		SOUNDSCAPER_NODE_API_SYMBOL(getElement, napi_get_element);
		SOUNDSCAPER_NODE_API_SYMBOL(getGlobal, napi_get_global);
		SOUNDSCAPER_NODE_API_SYMBOL(getProperty, napi_get_named_property);
		SOUNDSCAPER_NODE_API_SYMBOL(getTypedArrayInfo, napi_get_typedarray_info);
		SOUNDSCAPER_NODE_API_SYMBOL(getDouble, napi_get_value_double);
		SOUNDSCAPER_NODE_API_SYMBOL(getExternal, napi_get_value_external);
		SOUNDSCAPER_NODE_API_SYMBOL(getString, napi_get_value_string_utf8);
		SOUNDSCAPER_NODE_API_SYMBOL(getUnsigned, napi_get_value_uint32);
		SOUNDSCAPER_NODE_API_SYMBOL(setElement, napi_set_element);
		SOUNDSCAPER_NODE_API_SYMBOL(setProperty, napi_set_named_property);
		SOUNDSCAPER_NODE_API_SYMBOL(throwError, napi_throw_error);
		SOUNDSCAPER_NODE_API_SYMBOL(throwTypeError, napi_throw_type_error);
#undef SOUNDSCAPER_NODE_API_SYMBOL
		result.complete = result.callFunction != nullptr && result.createArray != nullptr
			&& result.createArrayWithLength != nullptr && result.createDouble != nullptr
			&& result.createExternal != nullptr && result.createObject != nullptr
			&& result.createString != nullptr && result.defineProperties != nullptr
			&& result.getArrayLength != nullptr && result.getBoolean != nullptr
			&& result.getCallbackInfo != nullptr && result.getElement != nullptr
			&& result.getGlobal != nullptr && result.getProperty != nullptr
			&& result.getTypedArrayInfo != nullptr && result.getDouble != nullptr
			&& result.getExternal != nullptr && result.getString != nullptr
			&& result.getUnsigned != nullptr && result.setElement != nullptr
			&& result.setProperty != nullptr && result.throwError != nullptr
			&& result.throwTypeError != nullptr;
		return result;
	}();
	return value;
}

} // namespace soundscaper::node_api_runtime

inline bool soundscaperNodeApiAvailable()
{
	return soundscaper::node_api_runtime::api().complete;
}

#define napi_call_function (soundscaper::node_api_runtime::api().callFunction)
#define napi_create_array (soundscaper::node_api_runtime::api().createArray)
#define napi_create_array_with_length (soundscaper::node_api_runtime::api().createArrayWithLength)
#define napi_create_double (soundscaper::node_api_runtime::api().createDouble)
#define napi_create_external (soundscaper::node_api_runtime::api().createExternal)
#define napi_create_object (soundscaper::node_api_runtime::api().createObject)
#define napi_create_string_utf8 (soundscaper::node_api_runtime::api().createString)
#define napi_define_properties (soundscaper::node_api_runtime::api().defineProperties)
#define napi_get_array_length (soundscaper::node_api_runtime::api().getArrayLength)
#define napi_get_boolean (soundscaper::node_api_runtime::api().getBoolean)
#define napi_get_cb_info (soundscaper::node_api_runtime::api().getCallbackInfo)
#define napi_get_element (soundscaper::node_api_runtime::api().getElement)
#define napi_get_global (soundscaper::node_api_runtime::api().getGlobal)
#define napi_get_named_property (soundscaper::node_api_runtime::api().getProperty)
#define napi_get_typedarray_info (soundscaper::node_api_runtime::api().getTypedArrayInfo)
#define napi_get_value_double (soundscaper::node_api_runtime::api().getDouble)
#define napi_get_value_external (soundscaper::node_api_runtime::api().getExternal)
#define napi_get_value_string_utf8 (soundscaper::node_api_runtime::api().getString)
#define napi_get_value_uint32 (soundscaper::node_api_runtime::api().getUnsigned)
#define napi_set_element (soundscaper::node_api_runtime::api().setElement)
#define napi_set_named_property (soundscaper::node_api_runtime::api().setProperty)
#define napi_throw_error (soundscaper::node_api_runtime::api().throwError)
#define napi_throw_type_error (soundscaper::node_api_runtime::api().throwTypeError)

#else

inline bool soundscaperNodeApiAvailable() { return true; }

#endif
