/* SPDX-License-Identifier: AGPL-3.0-only */

/** Node-API 8 bridge loaded only inside a role-scoped Electron utility process. */

#include "professional_host_api.h"
#include "os_audio_codec.h"

#include <node_api.h>

#include <algorithm>
#include <array>
#include <cstring>
#include <filesystem>
#include <string>
#include <vector>

namespace {

constexpr uint32_t maximumCandidates = 512u;
constexpr uint32_t maximumChannels = 4096u;
constexpr uint32_t maximumFrames = 65536u;

#define CHECK(call) do { if ((call) != napi_ok) return nullptr; } while (false)

struct AudioHandle {
	soundscaper_pro_audio_session *session = nullptr;
	uint32_t channels = 0u;
	bool closed = false;
};

napi_value fail(napi_env env, const char *code, const std::string &message)
{
	napi_throw_error(env, code, message.c_str());
	return nullptr;
}

napi_value typeError(napi_env env, const char *message)
{
	napi_throw_type_error(env, "SOUNDSCAPER_PRO_INVALID", message);
	return nullptr;
}

napi_value text(napi_env env, const char *value)
{
	napi_value result;
	if (napi_create_string_utf8(env, value == nullptr ? "" : value, NAPI_AUTO_LENGTH, &result) != napi_ok) return nullptr;
	return result;
}

bool property(napi_env env, napi_value object, const char *name, napi_value &value)
{
	return napi_get_named_property(env, object, name, &value) == napi_ok;
}

bool utf8(napi_env env, napi_value value, std::string &output, size_t ceiling = SOUNDSCAPER_PRO_MAX_TEXT)
{
	size_t length = 0u;
	if (napi_get_value_string_utf8(env, value, nullptr, 0u, &length) != napi_ok || length == 0u || length >= ceiling) return false;
	std::vector<char> bytes(length + 1u);
	if (napi_get_value_string_utf8(env, value, bytes.data(), bytes.size(), &length) != napi_ok) return false;
	output.assign(bytes.data(), length);
	return true;
}

bool stringProperty(napi_env env, napi_value object, const char *name, std::string &output, size_t ceiling = SOUNDSCAPER_PRO_MAX_TEXT)
{
	napi_value value;
	return property(env, object, name, value) && utf8(env, value, output, ceiling);
}

bool unsignedProperty(napi_env env, napi_value object, const char *name, uint32_t &output)
{
	napi_value value;
	return property(env, object, name, value) && napi_get_value_uint32(env, value, &output) == napi_ok;
}

bool number(napi_env env, napi_value value, double &output)
{
	return napi_get_value_double(env, value, &output) == napi_ok;
}

bool set(napi_env env, napi_value object, const char *name, napi_value value)
{
	return value != nullptr && napi_set_named_property(env, object, name, value) == napi_ok;
}

bool setText(napi_env env, napi_value object, const char *name, const char *value)
{
	return set(env, object, name, text(env, value));
}

bool setNumber(napi_env env, napi_value object, const char *name, double value)
{
	napi_value numberValue;
	return napi_create_double(env, value, &numberValue) == napi_ok && set(env, object, name, numberValue);
}

bool setBoolean(napi_env env, napi_value object, const char *name, bool value)
{
	napi_value boolean;
	return napi_get_boolean(env, value, &boolean) == napi_ok && set(env, object, name, boolean);
}

const char *statusName(soundscaper_pro_status status)
{
	switch (status) {
	case SOUNDSCAPER_PRO_OK: return "ok";
	case SOUNDSCAPER_PRO_BACKEND_ABSENT: return "backend-unavailable";
	case SOUNDSCAPER_PRO_SERVER_ABSENT: return "server-unavailable";
	case SOUNDSCAPER_PRO_DEVICE_UNAVAILABLE: return "device-unavailable";
	case SOUNDSCAPER_PRO_FORMAT_REFUSED: return "format-refused";
	case SOUNDSCAPER_PRO_MODE_REFUSED: return "mode-refused";
	case SOUNDSCAPER_PRO_PLUGIN_UNREADABLE: return "unreadable";
	case SOUNDSCAPER_PRO_PLUGIN_MALFORMED: return "malformed";
	case SOUNDSCAPER_PRO_STATE_TOO_LARGE: return "state-too-large";
	case SOUNDSCAPER_PRO_STATE_REJECTED: return "state-rejected";
	default: return "unsupported";
	}
}

const char *osCodecStatusName(
	soundscaper_pro_os_codec_status status,
	const char *success = "decoded",
	const char *failure = "decode-failed")
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

void closeAudio(AudioHandle *handle)
{
	if (handle == nullptr || handle->closed) return;
	handle->closed = true;
	soundscaper_pro_audio_close(handle->session);
	handle->session = nullptr;
}

void finalizeAudio(napi_env, void *value, void *) { auto *handle = static_cast<AudioHandle *>(value); closeAudio(handle); delete handle; }

napi_value describe(napi_env env, napi_callback_info)
{
	napi_value result;
	CHECK(napi_create_object(env, &result));
	if (!setText(env, result, "addonVersion", "1.0.0")
		|| !setText(env, result, "buildId", "soundscaper-professional-host")
		|| !setNumber(env, result, "napiVersion", NAPI_VERSION)
		|| !setNumber(env, result, "maximumChannelCount", maximumChannels)
		|| !setNumber(env, result, "maximumFrameCount", maximumFrames)) return nullptr;
	const std::array<const char *, 0> formats{};
	napi_value pluginFormats;
	CHECK(napi_create_array_with_length(env, formats.size(), &pluginFormats));
	for (uint32_t index = 0u; index < formats.size(); ++index) {
		CHECK(napi_set_element(env, pluginFormats, index, text(env, formats[index])));
	}
	if (!set(env, result, "pluginFormats", pluginFormats)) return nullptr;
	return result;
}

napi_value jsonParse(napi_env env, const std::string &json)
{
	napi_value global, jsonObject, parseFunction, argument, answer;
	CHECK(napi_get_global(env, &global));
	CHECK(napi_get_named_property(env, global, "JSON", &jsonObject));
	CHECK(napi_get_named_property(env, jsonObject, "parse", &parseFunction));
	CHECK(napi_create_string_utf8(env, json.c_str(), json.size(), &argument));
	CHECK(napi_call_function(env, jsonObject, parseFunction, 1u, &argument, &answer));
	return answer;
}

napi_value enumerateAudioBackends(napi_env env, napi_callback_info)
{
#if defined(__APPLE__)
	const std::array<const char *, 1> backends{ "coreaudio" };
#elif defined(_WIN32)
	const std::array<const char *, 2> backends{ "wasapi", "asio" };
#else
	const std::array<const char *, 3> backends{ "pipewire", "alsa", "jack" };
#endif
	napi_value result;
	CHECK(napi_create_array_with_length(env, backends.size(), &result));
	for (size_t index = 0u; index < backends.size(); ++index) {
		std::vector<char> buffer(256u * 1024u);
		size_t written = 0u;
		const auto status = soundscaper_pro_audio_enumerate(backends[index], buffer.data(), buffer.size(), &written);
		napi_value entry, devices;
		CHECK(napi_create_object(env, &entry));
		CHECK(napi_create_array(env, &devices));
		if (status == SOUNDSCAPER_PRO_OK) devices = jsonParse(env, std::string(buffer.data(), written));
		if (!devices || !setText(env, entry, "backend", backends[index])
			|| !setText(env, entry, "status", statusName(status))
			|| !setText(env, entry, "detail", status == SOUNDSCAPER_PRO_OK ? "" : statusName(status))
			|| !set(env, entry, "devices", devices)) return nullptr;
		CHECK(napi_set_element(env, result, index, entry));
	}
	return result;
}

napi_value openAudioDevice(napi_env env, napi_callback_info info)
{
	size_t argc = 1u;
	napi_value argv[1];
	CHECK(napi_get_cb_info(env, info, &argc, argv, nullptr, nullptr));
	if (argc != 1u) return typeError(env, "Opening audio requires one exact request.");
	napi_value candidates;
	uint32_t direction, exclusive, sampleRate, periodFrames, channelCount, candidateCount = 0u;
	if (!property(env, argv[0], "candidates", candidates)
		|| napi_get_array_length(env, candidates, &candidateCount) != napi_ok
		|| candidateCount < 1u || candidateCount > 4u
		|| !unsignedProperty(env, argv[0], "direction", direction)
		|| !unsignedProperty(env, argv[0], "exclusive", exclusive)
		|| !unsignedProperty(env, argv[0], "sampleRate", sampleRate)
		|| !unsignedProperty(env, argv[0], "periodFrames", periodFrames)
		|| !unsignedProperty(env, argv[0], "channelCount", channelCount)) {
		return typeError(env, "The professional audio request is malformed.");
	}
	napi_value attempts;
	CHECK(napi_create_array(env, &attempts));
	soundscaper_pro_audio_session *opened = nullptr;
	soundscaper_pro_audio_result outcome{};
	std::string requestedBackend;
	for (uint32_t index = 0u; index < candidateCount; ++index) {
		napi_value candidate;
		CHECK(napi_get_element(env, candidates, index, &candidate));
		std::string backend, device;
		if (!stringProperty(env, candidate, "backend", backend, 32u)
			|| !stringProperty(env, candidate, "deviceHandle", device)) return typeError(env, "An audio candidate is malformed.");
		if (index == 0u) requestedBackend = backend;
		const soundscaper_pro_audio_request request{
			backend.c_str(), device.c_str(), direction, exclusive, sampleRate, periodFrames, channelCount,
		};
		outcome = soundscaper_pro_audio_open(&request, &opened);
		napi_value attempt;
		CHECK(napi_create_object(env, &attempt));
		if (!setText(env, attempt, "backend", backend.c_str()) || !setText(env, attempt, "deviceHandle", device.c_str())
			|| !setText(env, attempt, "status", statusName(outcome.status)) || !setText(env, attempt, "detail", outcome.detail)) return nullptr;
		CHECK(napi_set_element(env, attempts, index, attempt));
		if (outcome.status == SOUNDSCAPER_PRO_OK) break;
		if (outcome.status != SOUNDSCAPER_PRO_BACKEND_ABSENT && outcome.status != SOUNDSCAPER_PRO_SERVER_ABSENT) break;
	}
	napi_value result;
	CHECK(napi_create_object(env, &result));
	if (!setText(env, result, "status", statusName(outcome.status))
		|| !setText(env, result, "requestedBackend", requestedBackend.c_str())
		|| !setText(env, result, "detail", outcome.detail) || !set(env, result, "attempts", attempts)) return nullptr;
	if (outcome.status != SOUNDSCAPER_PRO_OK || opened == nullptr) return result;
	auto *handle = new AudioHandle{ opened, outcome.channel_count, false };
	napi_value external;
	if (napi_create_external(env, handle, finalizeAudio, nullptr, &external) != napi_ok) {
		finalizeAudio(env, handle, nullptr);
		return fail(env, "SOUNDSCAPER_PRO_OPEN", "The professional audio handle could not be created.");
	}
	if (!setText(env, result, "grantedBackend", outcome.backend)
		|| !setBoolean(env, result, "fellBack", requestedBackend != outcome.backend)
		|| !setBoolean(env, result, "grantedExclusive", outcome.exclusive != 0u)
		|| !setNumber(env, result, "grantedSampleRate", outcome.sample_rate)
		|| !setNumber(env, result, "grantedPeriodFrames", outcome.period_frames)
		|| !setNumber(env, result, "grantedChannelCount", outcome.channel_count)
		|| !set(env, result, "session", external)) return nullptr;
	return result;
}

bool planes(napi_env env, napi_value value, uint32_t channels, uint32_t frames, std::vector<float *> &output)
{
	uint32_t count = 0u;
	if (napi_get_array_length(env, value, &count) != napi_ok || count != channels) return false;
	output.clear();
	for (uint32_t index = 0u; index < count; ++index) {
		napi_value plane;
		napi_typedarray_type type;
		size_t length = 0u;
		void *data = nullptr;
		if (napi_get_element(env, value, index, &plane) != napi_ok
			|| napi_get_typedarray_info(env, plane, &type, &length, &data, nullptr, nullptr) != napi_ok
			|| type != napi_float32_array || length != frames || data == nullptr) return false;
		output.push_back(static_cast<float *>(data));
	}
	return true;
}

napi_value transferAudio(napi_env env, napi_callback_info info, bool writing)
{
	size_t argc = 3u;
	napi_value argv[3];
	CHECK(napi_get_cb_info(env, info, &argc, argv, nullptr, nullptr));
	AudioHandle *handle = nullptr;
	double frameValue = 0.0;
	if (argc != 3u || napi_get_value_external(env, argv[0], reinterpret_cast<void **>(&handle)) != napi_ok
		|| handle == nullptr || handle->closed || !number(env, argv[1], frameValue)
		|| frameValue < 1.0 || frameValue > maximumFrames || frameValue != static_cast<uint32_t>(frameValue)) {
		return typeError(env, "The professional audio transfer is malformed.");
	}
	const uint32_t frames = static_cast<uint32_t>(frameValue);
	std::vector<float *> pointers;
	if (!planes(env, argv[2], handle->channels, frames, pointers)) return typeError(env, "The audio planes are malformed.");
	const auto status = writing
		? soundscaper_pro_audio_write(handle->session, const_cast<const float *const *>(pointers.data()), handle->channels, frames)
		: soundscaper_pro_audio_read(handle->session, pointers.data(), handle->channels, frames);
	napi_value result;
	CHECK(napi_create_object(env, &result));
	if (!setText(env, result, "status", statusName(status))
		|| !setNumber(env, result, "framesTransferred", status == SOUNDSCAPER_PRO_OK ? frames : 0u)
		|| !setNumber(env, result, "lostFrames", 0u) || !setNumber(env, result, "totalLostFrames", 0u)) return nullptr;
	return result;
}

napi_value writeAudioDevice(napi_env env, napi_callback_info info) { return transferAudio(env, info, true); }
napi_value readAudioDevice(napi_env env, napi_callback_info info) { return transferAudio(env, info, false); }

napi_value closeAudioDevice(napi_env env, napi_callback_info info)
{
	size_t argc = 1u; napi_value argv[1]; AudioHandle *handle = nullptr;
	CHECK(napi_get_cb_info(env, info, &argc, argv, nullptr, nullptr));
	if (argc != 1u || napi_get_value_external(env, argv[0], reinterpret_cast<void **>(&handle)) != napi_ok || handle == nullptr) {
		return typeError(env, "Closing audio requires its handle.");
	}
	closeAudio(handle); napi_value result; CHECK(napi_get_boolean(env, true, &result)); return result;
}

napi_value decodeOperatingSystemAudio(napi_env env, napi_callback_info info,
	soundscaper_pro_os_mp3_decode_result (*decode)(const soundscaper_pro_os_mp3_decode_request *))
{
	size_t argc = 1u;
	napi_value argv[1];
	CHECK(napi_get_cb_info(env, info, &argc, argv, nullptr, nullptr));
	std::string inputPath;
	std::string outputPath;
	uint32_t inputBytes = 0u;
	uint32_t maximumOutputBytes = 0u;
	if (argc != 1u || !stringProperty(env, argv[0], "inputPath", inputPath, 4097u)
		|| !stringProperty(env, argv[0], "outputPath", outputPath, 4097u)
		|| !unsignedProperty(env, argv[0], "inputBytes", inputBytes) || inputBytes == 0u
		|| !unsignedProperty(env, argv[0], "maximumOutputBytes", maximumOutputBytes)
		|| maximumOutputBytes == 0u || inputPath == outputPath) {
		return typeError(env, "An operating-system MP3 decode requires exact bounded scratch files.");
	}
	const soundscaper_pro_os_mp3_decode_request request{
		inputPath.c_str(), outputPath.c_str(), inputBytes, maximumOutputBytes,
	};
	const auto outcome = decode(&request);
	napi_value result;
	CHECK(napi_create_object(env, &result));
	if (!setText(env, result, "status", osCodecStatusName(outcome.status))
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
napi_value encodeOperatingSystemAudio(
	napi_env env,
	napi_callback_info info,
	Encode encode,
	const char *requestError)
{
	size_t argc = 1u;
	napi_value argv[1];
	CHECK(napi_get_cb_info(env, info, &argc, argv, nullptr, nullptr));
	std::string inputPath;
	std::string outputPath;
	uint32_t inputBytes = 0u;
	uint32_t maximumOutputBytes = 0u;
	uint32_t sampleRate = 0u;
	uint32_t channelCount = 0u;
	uint32_t bitrateKbps = 0u;
	if (argc != 1u || !stringProperty(env, argv[0], "inputPath", inputPath, 4097u)
		|| !stringProperty(env, argv[0], "outputPath", outputPath, 4097u)
		|| !unsignedProperty(env, argv[0], "inputBytes", inputBytes) || inputBytes == 0u
		|| !unsignedProperty(env, argv[0], "maximumOutputBytes", maximumOutputBytes)
		|| maximumOutputBytes == 0u
		|| !unsignedProperty(env, argv[0], "sampleRate", sampleRate)
		|| !unsignedProperty(env, argv[0], "channelCount", channelCount)
		|| !unsignedProperty(env, argv[0], "bitrateKbps", bitrateKbps)
		|| inputPath == outputPath) {
		return typeError(env, requestError);
	}
	const Request request{
		inputPath.c_str(), outputPath.c_str(), inputBytes, maximumOutputBytes,
		sampleRate, channelCount, bitrateKbps,
	};
	const auto outcome = encode(&request);
	napi_value result;
	CHECK(napi_create_object(env, &result));
	if (!setText(env, result, "status", osCodecStatusName(outcome.status, "encoded", "encode-failed"))
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
	return encodeOperatingSystemAudio<soundscaper_pro_os_aac_m4a_encode_request>(env, info,
		soundscaper_pro_os_aac_m4a_encode,
		"An operating-system AAC encode requires exact bounded scratch files.");
}

napi_value encodeOperatingSystemMp3(napi_env env, napi_callback_info info)
{
	return encodeOperatingSystemAudio<soundscaper_pro_os_mp3_encode_request>(env, info,
		soundscaper_pro_os_mp3_encode,
		"An operating-system MP3 encode requires exact bounded scratch files.");
}

void collectCandidates(const std::filesystem::path &root, const std::string &suffix,
	std::vector<std::filesystem::path> &output, uint32_t depth = 0u)
{
	if (depth > 16u || output.size() >= maximumCandidates) return;
	std::error_code error;
	std::vector<std::filesystem::directory_entry> entries;
	for (std::filesystem::directory_iterator iterator(root,
		std::filesystem::directory_options::skip_permission_denied, error), end; iterator != end && !error; iterator.increment(error)) {
		if (!iterator->is_symlink(error)) entries.push_back(*iterator);
	}
	std::sort(entries.begin(), entries.end(), [](const auto &left, const auto &right) {
		return left.path().generic_string() < right.path().generic_string();
	});
	for (const auto &entry : entries) {
		if (entry.path().extension() == suffix && (entry.is_regular_file(error) || entry.is_directory(error))) {
			output.push_back(entry.path());
			if (output.size() >= maximumCandidates) return;
		} else if (entry.is_directory(error)) collectCandidates(entry.path(), suffix, output, depth + 1u);
	}
}

napi_value listPluginCandidates(napi_env env, napi_callback_info info)
{
	size_t argc = 2u; napi_value argv[2]; std::string root, suffix;
	CHECK(napi_get_cb_info(env, info, &argc, argv, nullptr, nullptr));
	if (argc != 2u || !utf8(env, argv[0], root, 4096u) || !utf8(env, argv[1], suffix, 32u)
		|| suffix[0] != '.') return typeError(env, "A plug-in scan requires a root and suffix.");
	std::error_code error;
	const auto canonical = std::filesystem::canonical(root, error);
	if (error || !std::filesystem::is_directory(canonical, error)) return fail(env, "SOUNDSCAPER_PRO_SCAN", "The scan root is unavailable.");
	std::vector<std::filesystem::path> candidates;
	collectCandidates(canonical, suffix, candidates);
	napi_value result; CHECK(napi_create_array_with_length(env, candidates.size(), &result));
	for (uint32_t index = 0u; index < candidates.size(); ++index) {
		const auto path = candidates[index].string();
		CHECK(napi_set_element(env, result, index, text(env, path.c_str())));
	}
	return result;
}

} // namespace

NAPI_MODULE_INIT()
{
	const napi_property_descriptor properties[] = {
		{ "describe", nullptr, describe, nullptr, nullptr, nullptr, napi_default, nullptr },
		{ "enumerateAudioBackends", nullptr, enumerateAudioBackends, nullptr, nullptr, nullptr, napi_default, nullptr },
		{ "openAudioDevice", nullptr, openAudioDevice, nullptr, nullptr, nullptr, napi_default, nullptr },
		{ "writeAudioDevice", nullptr, writeAudioDevice, nullptr, nullptr, nullptr, napi_default, nullptr },
		{ "readAudioDevice", nullptr, readAudioDevice, nullptr, nullptr, nullptr, napi_default, nullptr },
		{ "closeAudioDevice", nullptr, closeAudioDevice, nullptr, nullptr, nullptr, napi_default, nullptr },
		{ "decodeOperatingSystemMp3", nullptr, decodeOperatingSystemMp3, nullptr, nullptr, nullptr, napi_default, nullptr },
		{ "decodeOperatingSystemAacM4a", nullptr, decodeOperatingSystemAacM4a, nullptr, nullptr, nullptr, napi_default, nullptr },
		{ "encodeOperatingSystemAacM4a", nullptr, encodeOperatingSystemAacM4a, nullptr, nullptr, nullptr, napi_default, nullptr },
		{ "encodeOperatingSystemMp3", nullptr, encodeOperatingSystemMp3, nullptr, nullptr, nullptr, napi_default, nullptr },
		{ "listPluginCandidates", nullptr, listPluginCandidates, nullptr, nullptr, nullptr, napi_default, nullptr },
	};
	if (napi_define_properties(env, exports, std::size(properties), properties) != napi_ok) {
		return fail(env, "SOUNDSCAPER_PRO_INIT", "The professional Node-API bridge could not initialize.");
	}
	return exports;
}
