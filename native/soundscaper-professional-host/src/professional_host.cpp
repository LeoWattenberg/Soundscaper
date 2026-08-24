/* SPDX-License-Identifier: AGPL-3.0-only */

#include "professional_host_api.h"

#if defined(SOUNDSCAPER_PRO_AUDIO_ONLY)
#include "juce_audio_adapter.h"
#elif defined(SOUNDSCAPER_PRO_PLUGIN_ONLY)
#include "direct_clap_adapter.h"
#include "juce_message_dispatcher.h"
#include "juce_plugin_adapter.h"
#else
#error "The professional core must compile as either trusted audio or isolated plug-in code."
#endif

#include <algorithm>
#include <cctype>
#include <cstring>
#include <memory>
#include <string>
#include <sstream>
#include <vector>

#if defined(__linux__) && defined(SOUNDSCAPER_PRO_AUDIO_ONLY)
extern "C" {
#include "../../soundscaper-helper-addon/src/audio_backends.h"
#include "../../soundscaper-helper-addon/src/audio_device.h"
}
#endif

#if defined(SOUNDSCAPER_PRO_AUDIO_ONLY)
struct soundscaper_pro_audio_session {
	std::unique_ptr<soundscaper::JuceAudioSession> juce;
#if defined(__linux__)
	soundscaper_audio_stream *linuxStream = nullptr;
#endif
	~soundscaper_pro_audio_session()
	{
#if defined(__linux__)
		soundscaper_audio_stream_destroy(linuxStream);
#endif
	}
};
#endif

#if defined(SOUNDSCAPER_PRO_PLUGIN_ONLY)
struct soundscaper_pro_plugin_instance {
	std::string format;
	std::unique_ptr<soundscaper::JucePluginInstance> juce;
	std::unique_ptr<soundscaper::DirectClapInstance> clap;
};
#endif

namespace {

#if defined(SOUNDSCAPER_PRO_AUDIO_ONLY)
bool audioRequestValid(const soundscaper_pro_audio_request *request)
{
	return request != nullptr && request->backend != nullptr && request->device_handle != nullptr
		&& request->direction <= 2u && request->exclusive <= 1u
		&& request->sample_rate >= 8000u && request->sample_rate <= 768000u
		&& request->period_frames >= 1u && request->period_frames <= 16384u
		&& request->channel_count >= 1u && request->channel_count <= SOUNDSCAPER_PRO_MAX_CHANNELS;
}
#endif

#if defined(SOUNDSCAPER_PRO_PLUGIN_ONLY)
bool pluginOpenValid(
	const char *format, const char *path, const char *stableId,
	double sampleRate, uint32_t maximumFrames)
{
	return format != nullptr && path != nullptr && path[0] != '\0'
		&& stableId != nullptr && stableId[0] != '\0'
		&& std::strlen(stableId) < SOUNDSCAPER_PRO_MAX_TEXT
		&& sampleRate >= 8000.0 && sampleRate <= 768000.0
		&& maximumFrames >= 1u && maximumFrames <= 65536u;
}

bool juceFormat(const std::string &format)
{
	return format == "vst3" || format == "au" || format == "lv2";
}

bool opaqueWindowId(const char *value)
{
	if (value == nullptr) return false;
	const size_t length = std::strlen(value);
	if (length == 0u || length > 128u) return false;
	return std::all_of(value, value + length, [](unsigned char byte) {
		return std::isalnum(byte) != 0 || byte == '.' || byte == '_' || byte == '-';
	});
}
#endif

#if defined(__linux__) && defined(SOUNDSCAPER_PRO_AUDIO_ONLY)
soundscaper_pro_status linuxStatus(soundscaper_audio_open_status status)
{
	switch (status) {
	case SOUNDSCAPER_AUDIO_OPEN_OK: return SOUNDSCAPER_PRO_OK;
	case SOUNDSCAPER_AUDIO_OPEN_BACKEND_UNAVAILABLE: return SOUNDSCAPER_PRO_BACKEND_ABSENT;
	case SOUNDSCAPER_AUDIO_OPEN_DEVICE_UNAVAILABLE: return SOUNDSCAPER_PRO_DEVICE_UNAVAILABLE;
	case SOUNDSCAPER_AUDIO_OPEN_FORMAT_REFUSED: return SOUNDSCAPER_PRO_FORMAT_REFUSED;
	case SOUNDSCAPER_AUDIO_OPEN_MODE_REFUSED: return SOUNDSCAPER_PRO_MODE_REFUSED;
	default: return SOUNDSCAPER_PRO_UNSUPPORTED;
	}
}

bool linuxBackend(const std::string &name, soundscaper_audio_backend &backend)
{
	if (name == "pipewire") backend = SOUNDSCAPER_BACKEND_PIPEWIRE;
	else if (name == "alsa") backend = SOUNDSCAPER_BACKEND_ALSA;
	else if (name == "jack") backend = SOUNDSCAPER_BACKEND_JACK;
	else return false;
	return true;
}

std::string escaped(const char *value)
{
	std::string output;
	for (const char *cursor = value; cursor != nullptr && *cursor != '\0'; ++cursor) {
		if (*cursor == '"' || *cursor == '\\') output.push_back('\\');
		if (static_cast<unsigned char>(*cursor) >= 0x20u) output.push_back(*cursor);
	}
	return output;
}

soundscaper_pro_status enumerateLinuxAudio(const std::string &name, std::string &serialized)
{
	soundscaper_audio_backend backend;
	if (!linuxBackend(name, backend)) return SOUNDSCAPER_PRO_UNSUPPORTED;
	soundscaper_backend_inventory inventory{};
	soundscaper_audio_backend_enumerate(backend, &inventory);
	if (inventory.status != SOUNDSCAPER_BACKEND_AVAILABLE) {
		if (inventory.status == SOUNDSCAPER_BACKEND_SERVER_ABSENT) return SOUNDSCAPER_PRO_SERVER_ABSENT;
		return SOUNDSCAPER_PRO_BACKEND_ABSENT;
	}
	std::ostringstream output;
	output << "[";
	for (uint32_t index = 0; index < inventory.device_count; ++index) {
		const auto &device = inventory.devices[index];
		if (index > 0u) output << ",";
		const char *direction = device.direction == SOUNDSCAPER_DEVICE_INPUT ? "input"
			: device.direction == SOUNDSCAPER_DEVICE_OUTPUT ? "output" : "duplex";
		output << "{\"handle\":\"" << escaped(device.handle) << "\",\"label\":\""
			<< escaped(device.label) << "\",\"direction\":\"" << direction << "\"}";
	}
	output << "]";
	serialized = output.str();
	return SOUNDSCAPER_PRO_OK;
}

soundscaper_pro_audio_result openLinuxAudio(
	const soundscaper_pro_audio_request &request, soundscaper_audio_stream **stream)
{
	soundscaper_pro_audio_result result{};
	result.status = SOUNDSCAPER_PRO_UNSUPPORTED;
	soundscaper_audio_backend backend;
	if (!linuxBackend(request.backend, backend) || backend == SOUNDSCAPER_BACKEND_JACK) return result;
	soundscaper_audio_candidate candidate{};
	candidate.backend = backend;
	std::strncpy(candidate.device_handle, request.device_handle, sizeof(candidate.device_handle) - 1u);
	soundscaper_audio_open_report report{};
	const auto status = soundscaper_audio_stream_open(
		&candidate, 1u, static_cast<soundscaper_device_direction>(request.direction), request.exclusive,
		request.sample_rate, request.period_frames, request.channel_count, stream, &report);
	result.status = linuxStatus(status);
	std::strncpy(result.backend, request.backend, sizeof(result.backend) - 1u);
	if (report.attempt_count > 0u) {
		std::strncpy(result.detail, report.attempts[report.attempt_count - 1u].detail,
			sizeof(result.detail) - 1u);
	}
	if (status == SOUNDSCAPER_AUDIO_OPEN_OK) {
		result.sample_rate = report.granted.sample_rate;
		result.period_frames = report.granted.period_frames;
		result.channel_count = report.granted.channel_count;
		result.exclusive = report.granted.exclusive;
	}
	return result;
}
#endif

} // namespace

extern "C" {

#if defined(SOUNDSCAPER_PRO_AUDIO_ONLY)
soundscaper_pro_status soundscaper_pro_audio_enumerate(
	const char *backend, char *json, size_t capacity, size_t *written)
{
	if (backend == nullptr || json == nullptr || written == nullptr || capacity == 0u) {
		return SOUNDSCAPER_PRO_FORMAT_REFUSED;
	}
	std::string serialized;
	const std::string selected(backend);
#if defined(__linux__)
	const auto status = selected == "pipewire" || selected == "alsa" || selected == "jack"
		? enumerateLinuxAudio(selected, serialized)
		: soundscaper::enumerateJuceAudio(selected, serialized);
#else
	const auto status = soundscaper::enumerateJuceAudio(selected, serialized);
#endif
	if (status != SOUNDSCAPER_PRO_OK) return status;
	*written = serialized.size();
	if (serialized.size() + 1u > capacity) return SOUNDSCAPER_PRO_FORMAT_REFUSED;
	std::memcpy(json, serialized.data(), serialized.size());
	json[serialized.size()] = '\0';
	return SOUNDSCAPER_PRO_OK;
}

soundscaper_pro_audio_result soundscaper_pro_audio_open(
	const soundscaper_pro_audio_request *request, soundscaper_pro_audio_session **session)
{
	soundscaper_pro_audio_result refused{};
	refused.status = SOUNDSCAPER_PRO_FORMAT_REFUSED;
	if (!audioRequestValid(request) || session == nullptr) return refused;
	*session = nullptr;
	auto owned = std::make_unique<soundscaper_pro_audio_session>();
	soundscaper_pro_audio_result result;
#if defined(__linux__)
	const std::string selected(request->backend);
	result = selected == "pipewire" || selected == "alsa" || selected == "jack"
		? openLinuxAudio(*request, &owned->linuxStream)
		: soundscaper::openJuceAudio(*request, owned->juce);
#else
	result = soundscaper::openJuceAudio(*request, owned->juce);
#endif
	if (result.status == SOUNDSCAPER_PRO_OK) *session = owned.release();
	return result;
}

soundscaper_pro_status soundscaper_pro_audio_read(
	soundscaper_pro_audio_session *session, float **planes, uint32_t channels, uint32_t frames)
{
	if (session == nullptr) return SOUNDSCAPER_PRO_DEVICE_UNAVAILABLE;
#if defined(__linux__)
	if (session->linuxStream != nullptr) {
		uint64_t lost = 0u;
		return soundscaper_audio_stream_read(session->linuxStream, planes, frames, &lost)
			== SOUNDSCAPER_AUDIO_IO_OK ? SOUNDSCAPER_PRO_OK : SOUNDSCAPER_PRO_DEVICE_UNAVAILABLE;
	}
#endif
	return session->juce == nullptr ? SOUNDSCAPER_PRO_DEVICE_UNAVAILABLE
		: soundscaper::readJuceAudio(*session->juce, planes, channels, frames);
}

soundscaper_pro_status soundscaper_pro_audio_write(
	soundscaper_pro_audio_session *session, const float *const *planes, uint32_t channels, uint32_t frames)
{
	if (session == nullptr) return SOUNDSCAPER_PRO_DEVICE_UNAVAILABLE;
#if defined(__linux__)
	if (session->linuxStream != nullptr) {
		uint64_t lost = 0u;
		return soundscaper_audio_stream_write(session->linuxStream, planes, frames, &lost)
			== SOUNDSCAPER_AUDIO_IO_OK ? SOUNDSCAPER_PRO_OK : SOUNDSCAPER_PRO_DEVICE_UNAVAILABLE;
	}
#endif
	return session->juce == nullptr ? SOUNDSCAPER_PRO_DEVICE_UNAVAILABLE
		: soundscaper::writeJuceAudio(*session->juce, planes, channels, frames);
}

void soundscaper_pro_audio_close(soundscaper_pro_audio_session *session) { delete session; }
#endif

#if defined(SOUNDSCAPER_PRO_PLUGIN_ONLY)
soundscaper_pro_status soundscaper_pro_plugin_scan(
	const char *format, const char *path, soundscaper_pro_plugin_description *descriptions,
	size_t capacity, size_t *written)
{
	if (format == nullptr || path == nullptr || written == nullptr) return SOUNDSCAPER_PRO_PLUGIN_MALFORMED;
	*written = 0u;
	const std::string selected(format);
	std::vector<soundscaper_pro_plugin_description> found;
	const auto status = soundscaper::dispatchJuceMessageTask([&]() {
		if (selected == "clap") return soundscaper::scanDirectClap(path, found);
		return juceFormat(selected) ? soundscaper::scanJucePlugin(selected, path, found)
			: SOUNDSCAPER_PRO_UNSUPPORTED;
	});
	if (status != SOUNDSCAPER_PRO_OK) return status;
	if (found.empty() || found.size() > SOUNDSCAPER_PRO_MAX_PLUGIN_DESCRIPTORS) {
		return SOUNDSCAPER_PRO_PLUGIN_MALFORMED;
	}
	*written = found.size();
	if (descriptions == nullptr || capacity == 0u) return SOUNDSCAPER_PRO_OK;
	if (capacity < found.size()) return SOUNDSCAPER_PRO_FORMAT_REFUSED;
	std::copy(found.begin(), found.end(), descriptions);
	return SOUNDSCAPER_PRO_OK;
}

soundscaper_pro_status soundscaper_pro_plugin_open(
	const char *format, const char *path, const char *stableId,
	double sampleRate, uint32_t maximumFrames,
	soundscaper_pro_plugin_instance **instance)
{
	if (!pluginOpenValid(format, path, stableId, sampleRate, maximumFrames) || instance == nullptr) {
		return SOUNDSCAPER_PRO_PLUGIN_MALFORMED;
	}
	*instance = nullptr;
	auto owned = std::make_unique<soundscaper_pro_plugin_instance>();
	owned->format = format;
	soundscaper_pro_status status;
	status = soundscaper::dispatchJuceMessageTask([&]() {
		if (owned->format == "clap") {
			return soundscaper::openDirectClap(path, stableId, sampleRate, maximumFrames, owned->clap);
		}
		if (juceFormat(owned->format)) {
			return soundscaper::openJucePlugin(
				owned->format, path, stableId, sampleRate, maximumFrames, owned->juce);
		}
		return SOUNDSCAPER_PRO_UNSUPPORTED;
	});
	if (status == SOUNDSCAPER_PRO_OK) *instance = owned.release();
	return status;
}

soundscaper_pro_status soundscaper_pro_plugin_process(
	soundscaper_pro_plugin_instance *instance, const float *const *inputs, uint32_t inputChannels,
	float **outputs, uint32_t outputChannels, uint32_t frames)
{
	if (instance == nullptr) return SOUNDSCAPER_PRO_PLUGIN_MALFORMED;
	if (instance->clap != nullptr) return instance->clap->process(inputs, inputChannels, outputs, outputChannels, frames);
	return instance->juce == nullptr ? SOUNDSCAPER_PRO_PLUGIN_MALFORMED
		: soundscaper::processJucePlugin(*instance->juce, inputs, inputChannels, outputs, outputChannels, frames);
}

uint32_t soundscaper_pro_plugin_latency(soundscaper_pro_plugin_instance *instance)
{
	if (instance == nullptr) return 0u;
	if (instance->clap != nullptr) return instance->clap->latency();
	return instance->juce == nullptr ? 0u : soundscaper::jucePluginLatency(*instance->juce);
}

soundscaper_pro_status soundscaper_pro_plugin_save_state(
	soundscaper_pro_plugin_instance *instance, uint8_t *bytes, size_t capacity, size_t *written)
{
	if (instance == nullptr || written == nullptr) return SOUNDSCAPER_PRO_STATE_REJECTED;
	if (instance->clap != nullptr) return instance->clap->saveState(bytes, capacity, *written);
	return instance->juce == nullptr ? SOUNDSCAPER_PRO_STATE_REJECTED
		: soundscaper::saveJucePluginState(*instance->juce, bytes, capacity, *written);
}

soundscaper_pro_status soundscaper_pro_plugin_load_state(
	soundscaper_pro_plugin_instance *instance, const uint8_t *bytes, size_t length)
{
	if (instance == nullptr) return SOUNDSCAPER_PRO_STATE_REJECTED;
	if (instance->clap != nullptr) return instance->clap->loadState(bytes, length);
	return instance->juce == nullptr ? SOUNDSCAPER_PRO_STATE_REJECTED
		: soundscaper::loadJucePluginState(*instance->juce, bytes, length);
}

soundscaper_pro_status soundscaper_pro_plugin_open_vendor_window(
	soundscaper_pro_plugin_instance *instance, const char *opaqueWindowId)
{
	if (instance == nullptr || !::opaqueWindowId(opaqueWindowId)) return SOUNDSCAPER_PRO_UNSUPPORTED;
	return soundscaper::dispatchJuceMessageTask([&]() {
		if (instance->clap != nullptr) return instance->clap->openVendorWindow(opaqueWindowId);
		return instance->juce == nullptr ? SOUNDSCAPER_PRO_UNSUPPORTED
			: soundscaper::openJuceVendorWindow(*instance->juce, opaqueWindowId);
	});
}

void soundscaper_pro_plugin_close_vendor_window(soundscaper_pro_plugin_instance *instance)
{
	if (instance == nullptr) return;
	(void)soundscaper::dispatchJuceMessageTask([&]() {
		if (instance->clap != nullptr) instance->clap->closeVendorWindow();
		else if (instance->juce != nullptr) soundscaper::closeJuceVendorWindow(*instance->juce);
		return SOUNDSCAPER_PRO_OK;
	});
}

void soundscaper_pro_plugin_close(soundscaper_pro_plugin_instance *instance)
{
	if (instance == nullptr) return;
	(void)soundscaper::dispatchJuceMessageTask([&]() {
		delete instance;
		return SOUNDSCAPER_PRO_OK;
	});
}
#endif

} // extern "C"
