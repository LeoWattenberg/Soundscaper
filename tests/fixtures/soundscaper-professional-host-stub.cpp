/* SPDX-License-Identifier: AGPL-3.0-only */

#include "professional_host_api.h"

#include <algorithm>
#include <cstring>

struct soundscaper_pro_plugin_instance { int selected; const char *window; double parameter; };
struct soundscaper_pro_audio_session {};

static void text(char *output, size_t length, const char *value) {
	std::strncpy(output, value, length - 1u);
}

extern "C" soundscaper_pro_status soundscaper_pro_plugin_scan(
	const char *format, const char *, soundscaper_pro_plugin_description *values,
	size_t capacity, size_t *written) {
	if (std::strcmp(format, "vst3") != 0 || written == nullptr) return SOUNDSCAPER_PRO_FORMAT_REFUSED;
	*written = 2u;
	if (values == nullptr || capacity == 0u) return SOUNDSCAPER_PRO_OK;
	if (capacity < 2u) return SOUNDSCAPER_PRO_FORMAT_REFUSED;
	for (size_t index = 0u; index < 2u; ++index) {
		values[index] = {}; values[index].status = SOUNDSCAPER_PRO_OK;
		text(values[index].format, sizeof(values[index].format), "vst3");
		text(values[index].stable_id, sizeof(values[index].stable_id), index == 0u ? "fixture:a" : "fixture:b");
		text(values[index].name, sizeof(values[index].name), index == 0u ? "Fixture A" : "Fixture B");
		text(values[index].vendor, sizeof(values[index].vendor), "Soundscaper");
		text(values[index].version, sizeof(values[index].version), "1.0.0");
		values[index].input_channels = 2u; values[index].output_channels = 2u; values[index].latency_frames = 32u;
	}
	return SOUNDSCAPER_PRO_OK;
}
extern "C" soundscaper_pro_status soundscaper_pro_plugin_open(
	const char *, const char *, const char *stable, double, uint32_t,
	soundscaper_pro_plugin_instance **instance) {
	if (std::strcmp(stable, "fixture:b") != 0) return SOUNDSCAPER_PRO_PLUGIN_UNREADABLE;
	*instance = new soundscaper_pro_plugin_instance{2, nullptr, 0.5}; return SOUNDSCAPER_PRO_OK;
}
extern "C" soundscaper_pro_status soundscaper_pro_plugin_process(
	soundscaper_pro_plugin_instance *, const float *const *input, uint32_t inputs,
	float **output, uint32_t outputs, uint32_t frames) {
	if (inputs != 2u || outputs != 2u) return SOUNDSCAPER_PRO_PLUGIN_MALFORMED;
	for (uint32_t channel = 0u; channel < outputs; ++channel)
		for (uint32_t frame = 0u; frame < frames; ++frame) output[channel][frame] = input[channel][frame] * 2.0f;
	return SOUNDSCAPER_PRO_OK;
}
extern "C" uint32_t soundscaper_pro_plugin_latency(soundscaper_pro_plugin_instance *) { return 32u; }
extern "C" soundscaper_pro_status soundscaper_pro_plugin_save_state(
	soundscaper_pro_plugin_instance *, uint8_t *bytes, size_t capacity, size_t *written) {
	*written = 3u; if (bytes == nullptr || capacity == 0u) return SOUNDSCAPER_PRO_STATE_TOO_LARGE;
	if (capacity < 3u) return SOUNDSCAPER_PRO_STATE_TOO_LARGE;
	bytes[0] = 1u; bytes[1] = 2u; bytes[2] = 3u; return SOUNDSCAPER_PRO_OK;
}
extern "C" soundscaper_pro_status soundscaper_pro_plugin_load_state(
	soundscaper_pro_plugin_instance *, const uint8_t *bytes, size_t length) {
	return length == 3u && bytes[0] == 3u ? SOUNDSCAPER_PRO_OK : SOUNDSCAPER_PRO_STATE_REJECTED;
}
extern "C" soundscaper_pro_status soundscaper_pro_plugin_get_capabilities(
	soundscaper_pro_plugin_instance *, soundscaper_pro_plugin_capability_report *report) {
	if (report == nullptr) return SOUNDSCAPER_PRO_PLUGIN_MALFORMED;
	*report = {1u, 1u}; return SOUNDSCAPER_PRO_OK;
}
extern "C" soundscaper_pro_status soundscaper_pro_plugin_describe_parameters(
	soundscaper_pro_plugin_instance *, soundscaper_pro_plugin_parameter *parameters,
	size_t capacity, size_t *written) {
	if (written == nullptr) return SOUNDSCAPER_PRO_PLUGIN_MALFORMED;
	*written = 1u;
	if (parameters == nullptr || capacity == 0u) return SOUNDSCAPER_PRO_OK;
	if (capacity < 1u) return SOUNDSCAPER_PRO_FORMAT_REFUSED;
	parameters[0] = {};
	text(parameters[0].id, sizeof(parameters[0].id), "gain");
	text(parameters[0].name, sizeof(parameters[0].name), "Gain");
	parameters[0].default_value = 0.5; parameters[0].minimum_value = 0.0;
	parameters[0].maximum_value = 1.0; parameters[0].flags = SOUNDSCAPER_PRO_PARAMETER_AUTOMATABLE;
	return SOUNDSCAPER_PRO_OK;
}
extern "C" soundscaper_pro_status soundscaper_pro_plugin_read_parameter(
	soundscaper_pro_plugin_instance *instance, uint32_t index, double *value) {
	if (instance == nullptr || index != 0u || value == nullptr) return SOUNDSCAPER_PRO_FORMAT_REFUSED;
	*value = instance->parameter; return SOUNDSCAPER_PRO_OK;
}
extern "C" soundscaper_pro_status soundscaper_pro_plugin_write_parameter(
	soundscaper_pro_plugin_instance *instance, uint32_t index, double value) {
	if (instance == nullptr || index != 0u || value < 0.0 || value > 1.0) return SOUNDSCAPER_PRO_FORMAT_REFUSED;
	instance->parameter = value; return SOUNDSCAPER_PRO_OK;
}
extern "C" soundscaper_pro_status soundscaper_pro_plugin_open_vendor_window(
	soundscaper_pro_plugin_instance *instance, const char *capability) {
	if (instance == nullptr || capability == nullptr) return SOUNDSCAPER_PRO_UNSUPPORTED;
	instance->window = capability; return SOUNDSCAPER_PRO_OK;
}
extern "C" void soundscaper_pro_plugin_close_vendor_window(soundscaper_pro_plugin_instance *instance) {
	if (instance != nullptr) instance->window = nullptr;
}
extern "C" void soundscaper_pro_plugin_close(soundscaper_pro_plugin_instance *instance) { delete instance; }
namespace soundscaper { void shutdownJuceMessageDispatcher() {} }
