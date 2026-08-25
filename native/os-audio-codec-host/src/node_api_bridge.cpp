/* SPDX-License-Identifier: AGPL-3.0-only */

/** Node-API 8 bridge for the four reviewed operating-system codec calls. */

#include "os_audio_codec.h"

#include <node_api.h>

#include <cstdint>
#include <string>
#include <vector>

#if defined(_WIN32)
#define WIN32_LEAN_AND_MEAN
#include <windows.h>
#endif

namespace {

#if defined(_WIN32)
struct NodeApi {
	decltype(&napi_create_double) createDouble = nullptr;
	decltype(&napi_create_object) createObject = nullptr;
	decltype(&napi_create_string_utf8) createString = nullptr;
	decltype(&napi_define_properties) defineProperties = nullptr;
	decltype(&napi_get_boolean) getBoolean = nullptr;
	decltype(&napi_get_cb_info) getCallbackInfo = nullptr;
	decltype(&napi_get_named_property) getProperty = nullptr;
	decltype(&napi_get_value_string_utf8) getString = nullptr;
	decltype(&napi_get_value_uint32) getUnsigned = nullptr;
	decltype(&napi_set_named_property) setProperty = nullptr;
	decltype(&napi_throw_error) throwError = nullptr;
	decltype(&napi_throw_type_error) throwTypeError = nullptr;
	bool complete = false;
};

template<typename Function>
Function nodeSymbol(HMODULE module, const char *name)
{
	return reinterpret_cast<Function>(GetProcAddress(module, name));
}

const NodeApi &nodeApi()
{
	static const NodeApi value = [] {
		NodeApi result{};
		const HMODULE module = GetModuleHandleW(nullptr);
		if (module == nullptr) return result;
		result.createDouble = nodeSymbol<decltype(result.createDouble)>(module, "napi_create_double");
		result.createObject = nodeSymbol<decltype(result.createObject)>(module, "napi_create_object");
		result.createString = nodeSymbol<decltype(result.createString)>(module, "napi_create_string_utf8");
		result.defineProperties = nodeSymbol<decltype(result.defineProperties)>(module, "napi_define_properties");
		result.getBoolean = nodeSymbol<decltype(result.getBoolean)>(module, "napi_get_boolean");
		result.getCallbackInfo = nodeSymbol<decltype(result.getCallbackInfo)>(module, "napi_get_cb_info");
		result.getProperty = nodeSymbol<decltype(result.getProperty)>(module, "napi_get_named_property");
		result.getString = nodeSymbol<decltype(result.getString)>(module, "napi_get_value_string_utf8");
		result.getUnsigned = nodeSymbol<decltype(result.getUnsigned)>(module, "napi_get_value_uint32");
		result.setProperty = nodeSymbol<decltype(result.setProperty)>(module, "napi_set_named_property");
		result.throwError = nodeSymbol<decltype(result.throwError)>(module, "napi_throw_error");
		result.throwTypeError = nodeSymbol<decltype(result.throwTypeError)>(module, "napi_throw_type_error");
		result.complete = result.createDouble != nullptr && result.createObject != nullptr
			&& result.createString != nullptr && result.defineProperties != nullptr
			&& result.getBoolean != nullptr && result.getCallbackInfo != nullptr
			&& result.getProperty != nullptr && result.getString != nullptr
			&& result.getUnsigned != nullptr && result.setProperty != nullptr
			&& result.throwError != nullptr && result.throwTypeError != nullptr;
		return result;
	}();
	return value;
}

#define SC_NAPI(name) (nodeApi().name)
#else
#define createDouble napi_create_double
#define createObject napi_create_object
#define createString napi_create_string_utf8
#define defineProperties napi_define_properties
#define getBoolean napi_get_boolean
#define getCallbackInfo napi_get_cb_info
#define getProperty napi_get_named_property
#define getString napi_get_value_string_utf8
#define getUnsigned napi_get_value_uint32
#define setProperty napi_set_named_property
#define throwError napi_throw_error
#define throwTypeError napi_throw_type_error
#define SC_NAPI(name) (::name)
#endif

#define CHECK(call) do { if ((call) != napi_ok) return nullptr; } while (false)

napi_value typeError(napi_env env, const char *message)
{
	SC_NAPI(throwTypeError)(env, "SOUNDSCAPER_OS_CODEC_INVALID", message);
	return nullptr;
}

napi_value text(napi_env env, const char *value)
{
	napi_value result;
	if (SC_NAPI(createString)(env, value, NAPI_AUTO_LENGTH, &result) != napi_ok) return nullptr;
	return result;
}

bool property(napi_env env, napi_value object, const char *name, napi_value &value)
{
	return SC_NAPI(getProperty)(env, object, name, &value) == napi_ok;
}

bool utf8(napi_env env, napi_value value, std::string &output)
{
	size_t length = 0u;
	if (SC_NAPI(getString)(env, value, nullptr, 0u, &length) != napi_ok
		|| length == 0u || length > 4096u) return false;
	std::vector<char> bytes(length + 1u);
	if (SC_NAPI(getString)(env, value, bytes.data(), bytes.size(), &length) != napi_ok) return false;
	output.assign(bytes.data(), length);
	return true;
}

bool stringProperty(napi_env env, napi_value object, const char *name, std::string &output)
{
	napi_value value;
	return property(env, object, name, value) && utf8(env, value, output);
}

bool unsignedProperty(napi_env env, napi_value object, const char *name, uint32_t &output)
{
	napi_value value;
	return property(env, object, name, value)
		&& SC_NAPI(getUnsigned)(env, value, &output) == napi_ok;
}

bool set(napi_env env, napi_value object, const char *name, napi_value value)
{
	return value != nullptr && SC_NAPI(setProperty)(env, object, name, value) == napi_ok;
}

bool setText(napi_env env, napi_value object, const char *name, const char *value)
{
	return set(env, object, name, text(env, value));
}

bool setNumber(napi_env env, napi_value object, const char *name, double value)
{
	napi_value number;
	return SC_NAPI(createDouble)(env, value, &number) == napi_ok
		&& set(env, object, name, number);
}

bool setBoolean(napi_env env, napi_value object, const char *name, bool value)
{
	napi_value boolean;
	return SC_NAPI(getBoolean)(env, value, &boolean) == napi_ok
		&& set(env, object, name, boolean);
}

const char *statusName(
	soundscaper_pro_os_codec_status status,
	const char *success,
	const char *failure)
{
	switch (status) {
	case SOUNDSCAPER_PRO_OS_CODEC_OK: return success;
	case SOUNDSCAPER_PRO_OS_CODEC_API_UNAVAILABLE: return "api-unavailable";
	case SOUNDSCAPER_PRO_OS_CODEC_TUPLE_UNSUPPORTED: return "tuple-unsupported";
	case SOUNDSCAPER_PRO_OS_CODEC_INVALID_REQUEST: return "invalid-request";
	case SOUNDSCAPER_PRO_OS_CODEC_INPUT_CHANGED: return "input-changed";
	case SOUNDSCAPER_PRO_OS_CODEC_OUTPUT_LIMIT: return "output-limit";
	case SOUNDSCAPER_PRO_OS_CODEC_IO_FAILED: return "io-failed";
	default: return failure;
	}
}

napi_value decodeOperatingSystemAudio(
	napi_env env,
	napi_callback_info info,
	soundscaper_pro_os_mp3_decode_result (*decode)(const soundscaper_pro_os_mp3_decode_request *))
{
	size_t count = 1u;
	napi_value arguments[1];
	CHECK(SC_NAPI(getCallbackInfo)(env, info, &count, arguments, nullptr, nullptr));
	std::string inputPath;
	std::string outputPath;
	uint32_t inputBytes = 0u;
	uint32_t maximumOutputBytes = 0u;
	if (count != 1u || !stringProperty(env, arguments[0], "inputPath", inputPath)
		|| !stringProperty(env, arguments[0], "outputPath", outputPath)
		|| !unsignedProperty(env, arguments[0], "inputBytes", inputBytes) || inputBytes == 0u
		|| !unsignedProperty(env, arguments[0], "maximumOutputBytes", maximumOutputBytes)
		|| maximumOutputBytes == 0u || inputPath == outputPath) {
		return typeError(env, "Operating-system decode requires exact bounded scratch files.");
	}
	const soundscaper_pro_os_mp3_decode_request request{
		inputPath.c_str(), outputPath.c_str(), inputBytes, maximumOutputBytes,
	};
	const auto outcome = decode(&request);
	napi_value result;
	CHECK(SC_NAPI(createObject)(env, &result));
	if (!setText(env, result, "status", statusName(outcome.status, "decoded", "decode-failed"))
		|| !setBoolean(env, result, "nativeApiReached", outcome.native_api_reached == 1u)
		|| !setBoolean(env, result, "exactTuplePassed", outcome.exact_tuple_passed == 1u)
		|| !setNumber(env, result, "outputBytes", static_cast<double>(outcome.output_bytes))
		|| !setNumber(env, result, "frameCount", static_cast<double>(outcome.frame_count))
		|| !setNumber(env, result, "sampleRate", outcome.sample_rate)
		|| !setNumber(env, result, "channelCount", outcome.channel_count)) return nullptr;
	return result;
}

napi_value decodeOperatingSystemMp3(napi_env env, napi_callback_info info)
{
	return decodeOperatingSystemAudio(env, info, soundscaper_pro_os_mp3_decode);
}

napi_value decodeOperatingSystemAacM4a(napi_env env, napi_callback_info info)
{
	return decodeOperatingSystemAudio(env, info, soundscaper_pro_os_aac_m4a_decode);
}

template<typename Request, typename Encode>
napi_value encodeOperatingSystemAudio(napi_env env, napi_callback_info info, Encode encode)
{
	size_t count = 1u;
	napi_value arguments[1];
	CHECK(SC_NAPI(getCallbackInfo)(env, info, &count, arguments, nullptr, nullptr));
	std::string inputPath;
	std::string outputPath;
	uint32_t inputBytes = 0u;
	uint32_t maximumOutputBytes = 0u;
	uint32_t sampleRate = 0u;
	uint32_t channelCount = 0u;
	uint32_t bitrateKbps = 0u;
	if (count != 1u || !stringProperty(env, arguments[0], "inputPath", inputPath)
		|| !stringProperty(env, arguments[0], "outputPath", outputPath)
		|| !unsignedProperty(env, arguments[0], "inputBytes", inputBytes) || inputBytes == 0u
		|| !unsignedProperty(env, arguments[0], "maximumOutputBytes", maximumOutputBytes)
		|| maximumOutputBytes == 0u
		|| !unsignedProperty(env, arguments[0], "sampleRate", sampleRate)
		|| !unsignedProperty(env, arguments[0], "channelCount", channelCount)
		|| !unsignedProperty(env, arguments[0], "bitrateKbps", bitrateKbps)
		|| inputPath == outputPath) {
		return typeError(env, "Operating-system encode requires exact bounded scratch files.");
	}
	const Request request{
		inputPath.c_str(), outputPath.c_str(), inputBytes, maximumOutputBytes,
		sampleRate, channelCount, bitrateKbps,
	};
	const auto outcome = encode(&request);
	napi_value result;
	CHECK(SC_NAPI(createObject)(env, &result));
	if (!setText(env, result, "status", statusName(outcome.status, "encoded", "encode-failed"))
		|| !setBoolean(env, result, "nativeApiReached", outcome.native_api_reached == 1u)
		|| !setBoolean(env, result, "exactTuplePassed", outcome.exact_tuple_passed == 1u)
		|| !setNumber(env, result, "outputBytes", static_cast<double>(outcome.output_bytes))
		|| !setNumber(env, result, "frameCount", static_cast<double>(outcome.frame_count))
		|| !setNumber(env, result, "sampleRate", outcome.sample_rate)
		|| !setNumber(env, result, "channelCount", outcome.channel_count)
		|| !setNumber(env, result, "bitrateKbps", outcome.bitrate_kbps)) return nullptr;
	return result;
}

napi_value encodeOperatingSystemAacM4a(napi_env env, napi_callback_info info)
{
	return encodeOperatingSystemAudio<soundscaper_pro_os_aac_m4a_encode_request>(
		env, info, soundscaper_pro_os_aac_m4a_encode);
}

napi_value encodeOperatingSystemMp3(napi_env env, napi_callback_info info)
{
	return encodeOperatingSystemAudio<soundscaper_pro_os_mp3_encode_request>(
		env, info, soundscaper_pro_os_mp3_encode);
}

} // namespace

NAPI_MODULE_INIT()
{
#if defined(_WIN32)
	if (!nodeApi().complete) {
		if (nodeApi().throwError != nullptr) {
			nodeApi().throwError(env, "SOUNDSCAPER_OS_CODEC_INIT",
				"Electron does not expose the required Node-API 8 surface.");
		}
		return nullptr;
	}
#endif
	const napi_property_descriptor properties[] = {
		{ "decodeOperatingSystemMp3", nullptr, decodeOperatingSystemMp3, nullptr, nullptr, nullptr, napi_default, nullptr },
		{ "decodeOperatingSystemAacM4a", nullptr, decodeOperatingSystemAacM4a, nullptr, nullptr, nullptr, napi_default, nullptr },
		{ "encodeOperatingSystemAacM4a", nullptr, encodeOperatingSystemAacM4a, nullptr, nullptr, nullptr, napi_default, nullptr },
		{ "encodeOperatingSystemMp3", nullptr, encodeOperatingSystemMp3, nullptr, nullptr, nullptr, napi_default, nullptr },
	};
	if (SC_NAPI(defineProperties)(env, exports,
		sizeof(properties) / sizeof(properties[0]), properties) != napi_ok) {
		SC_NAPI(throwError)(env, "SOUNDSCAPER_OS_CODEC_INIT",
			"The operating-system codec Node-API bridge could not initialize.");
		return nullptr;
	}
	return exports;
}
