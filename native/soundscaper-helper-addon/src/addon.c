/* SPDX-License-Identifier: AGPL-3.0-only */

/*
 * The Soundscaper native helper addon.
 *
 * This is the only native code milestone 5A loads, and it loads exclusively
 * inside a supervised Electron utility process — never in main, preload, the
 * renderer, or an AudioWorklet. The addon is Node-API only (no V8, no
 * node-addon-api, no C++ runtime) so one set of bytes per target keeps working
 * across Electron upgrades, and so the build is reproducible from the pinned
 * sources alone.
 *
 * The surface is deliberately narrow: describe the loaded payload, and run the
 * deterministic synthetic real-time engine the 5A-0c transport proof needs.
 * Device backends and plug-in formats extend this file only behind their own
 * capability rows.
 */

#define NAPI_VERSION 8

#include <node_api.h>

#include <stdlib.h>
#include <string.h>

#include "audio_backends.h"
#include "audio_device.h"
#include "pipewire_session.h"
#include "plugin_host.h"
#include "plugin_scan.h"
#include "synthetic_engine.h"

#ifndef SOUNDSCAPER_ADDON_VERSION
#define SOUNDSCAPER_ADDON_VERSION "0.0.0-unpinned"
#endif

#ifndef SOUNDSCAPER_ADDON_BUILD_ID
#define SOUNDSCAPER_ADDON_BUILD_ID "unpinned"
#endif

#define SOUNDSCAPER_CHECK(env, expression) \
	do { \
		if ((expression) != napi_ok) { \
			napi_throw_error((env), "SOUNDSCAPER_ADDON_FAILED", "The native helper addon call failed."); \
			return NULL; \
		} \
	} while (0)

static napi_value throw_type_error(napi_env env, const char *message)
{
	napi_throw_type_error(env, "SOUNDSCAPER_ADDON_INVALID_ARGUMENT", message);
	return NULL;
}

static napi_value throw_range_error(napi_env env, const char *message)
{
	napi_throw_range_error(env, "SOUNDSCAPER_ADDON_INVALID_ARGUMENT", message);
	return NULL;
}

static int read_uint32(napi_env env, napi_value object, const char *key, uint32_t *out)
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

static int read_double(napi_env env, napi_value object, const char *key, double *out)
{
	napi_value value;
	if (napi_get_named_property(env, object, key, &value) != napi_ok) return 0;
	napi_valuetype type;
	if (napi_typeof(env, value, &type) != napi_ok || type != napi_number) return 0;
	return napi_get_value_double(env, value, out) == napi_ok;
}

static int read_frame_index(napi_env env, napi_value value, uint64_t *out)
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

static void finalize_engine(napi_env env, void *data, void *hint)
{
	(void)env;
	(void)hint;
	soundscaper_synthetic_destroy((soundscaper_synthetic_engine *)data);
}

static napi_value describe(napi_env env, napi_callback_info info)
{
	(void)info;
	napi_value result;
	SOUNDSCAPER_CHECK(env, napi_create_object(env, &result));

	napi_value version;
	SOUNDSCAPER_CHECK(env, napi_create_string_utf8(env, SOUNDSCAPER_ADDON_VERSION, NAPI_AUTO_LENGTH, &version));
	SOUNDSCAPER_CHECK(env, napi_set_named_property(env, result, "addonVersion", version));

	napi_value build_id;
	SOUNDSCAPER_CHECK(env, napi_create_string_utf8(env, SOUNDSCAPER_ADDON_BUILD_ID, NAPI_AUTO_LENGTH, &build_id));
	SOUNDSCAPER_CHECK(env, napi_set_named_property(env, result, "buildId", build_id));

	napi_value napi_version;
	SOUNDSCAPER_CHECK(env, napi_create_uint32(env, (uint32_t)NAPI_VERSION, &napi_version));
	SOUNDSCAPER_CHECK(env, napi_set_named_property(env, result, "napiVersion", napi_version));

	napi_value max_channels;
	SOUNDSCAPER_CHECK(env, napi_create_uint32(env, (uint32_t)SOUNDSCAPER_SYNTHETIC_MAX_CHANNELS, &max_channels));
	SOUNDSCAPER_CHECK(env, napi_set_named_property(env, result, "maximumChannelCount", max_channels));

	napi_value max_frames;
	SOUNDSCAPER_CHECK(env, napi_create_uint32(env, (uint32_t)SOUNDSCAPER_SYNTHETIC_MAX_FRAMES, &max_frames));
	SOUNDSCAPER_CHECK(env, napi_set_named_property(env, result, "maximumFrameCount", max_frames));

	napi_value capabilities;
	SOUNDSCAPER_CHECK(env, napi_create_object(env, &capabilities));
	napi_value enabled;
	SOUNDSCAPER_CHECK(env, napi_get_boolean(env, true, &enabled));
	SOUNDSCAPER_CHECK(env, napi_set_named_property(env, capabilities, "syntheticRealtimeEngine", enabled));
	SOUNDSCAPER_CHECK(env, napi_set_named_property(env, capabilities, "audioBackendDiscovery", enabled));
	SOUNDSCAPER_CHECK(env, napi_set_named_property(env, result, "capabilities", capabilities));
	return result;
}

static napi_value set_string(napi_env env, napi_value target, const char *key, const char *value)
{
	napi_value text;
	SOUNDSCAPER_CHECK(env, napi_create_string_utf8(env, value, NAPI_AUTO_LENGTH, &text));
	SOUNDSCAPER_CHECK(env, napi_set_named_property(env, target, key, text));
	return target;
}

static const char *direction_name(soundscaper_device_direction direction)
{
	switch (direction) {
	case SOUNDSCAPER_DEVICE_INPUT: return "input";
	case SOUNDSCAPER_DEVICE_OUTPUT: return "output";
	default: return "duplex";
	}
}

/*
 * Reports every backend this payload knows about, whether or not it is usable
 * here. A backend the platform cannot provide is reported with its exact
 * reason rather than omitted, because the surface has to be able to tell a
 * user why a device they expect is missing.
 */
static napi_value enumerate_audio_backends(napi_env env, napi_callback_info info)
{
	(void)info;
	napi_value result;
	SOUNDSCAPER_CHECK(env, napi_create_array_with_length(env, (size_t)SOUNDSCAPER_BACKEND_COUNT, &result));
	for (uint32_t index = 0; index < (uint32_t)SOUNDSCAPER_BACKEND_COUNT; index += 1u) {
		soundscaper_backend_inventory inventory;
		memset(&inventory, 0, sizeof(inventory));
		soundscaper_audio_backend_enumerate((soundscaper_audio_backend)index, &inventory);

		napi_value entry;
		SOUNDSCAPER_CHECK(env, napi_create_object(env, &entry));
		if (set_string(env, entry, "backend", soundscaper_audio_backend_name((soundscaper_audio_backend)index)) == NULL) {
			return NULL;
		}
		if (set_string(env, entry, "status", soundscaper_backend_status_name(inventory.status)) == NULL) return NULL;
		if (set_string(env, entry, "detail", inventory.detail) == NULL) return NULL;

		napi_value devices;
		SOUNDSCAPER_CHECK(env, napi_create_array_with_length(env, (size_t)inventory.device_count, &devices));
		for (uint32_t device_index = 0; device_index < inventory.device_count; device_index += 1u) {
			const soundscaper_audio_device *device = &inventory.devices[device_index];
			napi_value described;
			SOUNDSCAPER_CHECK(env, napi_create_object(env, &described));
			if (set_string(env, described, "handle", device->handle) == NULL) return NULL;
			if (set_string(env, described, "label", device->label) == NULL) return NULL;
			if (set_string(env, described, "direction", direction_name(device->direction)) == NULL) return NULL;
			SOUNDSCAPER_CHECK(env, napi_set_element(env, devices, device_index, described));
		}
		SOUNDSCAPER_CHECK(env, napi_set_named_property(env, entry, "devices", devices));
		SOUNDSCAPER_CHECK(env, napi_set_element(env, result, index, entry));
	}
	return result;
}

static napi_value create_synthetic_engine(napi_env env, napi_callback_info info)
{
	size_t argc = 1;
	napi_value argv[1];
	SOUNDSCAPER_CHECK(env, napi_get_cb_info(env, info, &argc, argv, NULL, NULL));
	if (argc < 1) return throw_type_error(env, "A synthetic engine requires its configuration record.");
	napi_valuetype type;
	SOUNDSCAPER_CHECK(env, napi_typeof(env, argv[0], &type));
	if (type != napi_object) return throw_type_error(env, "A synthetic engine configuration must be an object.");

	soundscaper_synthetic_config config;
	memset(&config, 0, sizeof(config));
	uint32_t mode = 0;
	uint32_t fault = 0;
	double fault_frame = 0.0;
	if (!read_uint32(env, argv[0], "channelCount", &config.channel_count)
		|| !read_uint32(env, argv[0], "frameCount", &config.frame_count)
		|| !read_uint32(env, argv[0], "sampleRate", &config.sample_rate)
		|| !read_uint32(env, argv[0], "generation", &config.generation)
		|| !read_uint32(env, argv[0], "mode", &mode)
		|| !read_uint32(env, argv[0], "fault", &fault)
		|| !read_double(env, argv[0], "gain", &config.gain)
		|| !read_double(env, argv[0], "faultFrame", &fault_frame)) {
		return throw_type_error(env, "A synthetic engine configuration must carry exactly its numeric fields.");
	}
	if (!(fault_frame >= 0.0 && fault_frame <= 9007199254740991.0) || fault_frame != (double)(uint64_t)fault_frame) {
		return throw_range_error(env, "A synthetic engine fault frame must be a non-negative safe integer.");
	}
	config.mode = (soundscaper_synthetic_mode)mode;
	config.fault = (soundscaper_synthetic_fault)fault;
	config.fault_frame = (uint64_t)fault_frame;

	soundscaper_synthetic_engine *engine = NULL;
	soundscaper_synthetic_status status = soundscaper_synthetic_create(&config, &engine);
	if (status == SOUNDSCAPER_SYNTHETIC_INVALID_CONFIG) {
		return throw_range_error(env, "The synthetic engine configuration is outside its admitted bounds.");
	}
	if (status != SOUNDSCAPER_SYNTHETIC_OK) {
		napi_throw_error(env, "SOUNDSCAPER_ADDON_FAILED", "The synthetic engine could not be created.");
		return NULL;
	}
	napi_value handle;
	if (napi_create_external(env, engine, finalize_engine, NULL, &handle) != napi_ok) {
		soundscaper_synthetic_destroy(engine);
		napi_throw_error(env, "SOUNDSCAPER_ADDON_FAILED", "The synthetic engine handle could not be created.");
		return NULL;
	}
	return handle;
}

static int read_channel_pointers(
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

static napi_value render_synthetic_block(napi_env env, napi_callback_info info)
{
	size_t argc = 5;
	napi_value argv[5];
	SOUNDSCAPER_CHECK(env, napi_get_cb_info(env, info, &argc, argv, NULL, NULL));
	if (argc < 5) return throw_type_error(env, "Rendering a synthetic block requires five arguments.");

	soundscaper_synthetic_engine *engine = NULL;
	if (napi_get_value_external(env, argv[0], (void **)&engine) != napi_ok || engine == NULL) {
		return throw_type_error(env, "Rendering a synthetic block requires a live engine handle.");
	}
	uint64_t start_frame = 0;
	if (!read_frame_index(env, argv[1], &start_frame)) {
		return throw_range_error(env, "A synthetic block start frame must be a non-negative safe integer.");
	}
	uint32_t frame_count = 0;
	{
		double number;
		napi_valuetype type;
		if (napi_typeof(env, argv[2], &type) != napi_ok || type != napi_number
			|| napi_get_value_double(env, argv[2], &number) != napi_ok
			|| !(number >= 1.0 && number <= (double)SOUNDSCAPER_SYNTHETIC_MAX_FRAMES)
			|| number != (double)(uint32_t)number) {
			return throw_range_error(env, "A synthetic block frame count is outside its admitted bounds.");
		}
		frame_count = (uint32_t)number;
	}

	uint32_t channel_count = 0;
	{
		bool is_array = false;
		if (napi_is_array(env, argv[4], &is_array) != napi_ok || !is_array
			|| napi_get_array_length(env, argv[4], &channel_count) != napi_ok
			|| channel_count == 0u || channel_count > SOUNDSCAPER_SYNTHETIC_MAX_CHANNELS) {
			return throw_type_error(env, "A synthetic block requires its planar output channel array.");
		}
	}

	float *outputs[SOUNDSCAPER_SYNTHETIC_MAX_CHANNELS];
	float *inputs[SOUNDSCAPER_SYNTHETIC_MAX_CHANNELS];
	if (!read_channel_pointers(env, argv[4], channel_count, frame_count, outputs)) {
		return throw_type_error(env, "Every synthetic block output channel must be a large enough Float32Array.");
	}
	int has_input = 0;
	napi_valuetype input_type;
	SOUNDSCAPER_CHECK(env, napi_typeof(env, argv[3], &input_type));
	if (input_type != napi_null && input_type != napi_undefined) {
		if (!read_channel_pointers(env, argv[3], channel_count, frame_count, inputs)) {
			return throw_type_error(env, "Every synthetic block input channel must be a large enough Float32Array.");
		}
		has_input = 1;
	}

	soundscaper_synthetic_status status = soundscaper_synthetic_render(
		engine,
		start_frame,
		frame_count,
		has_input ? (const float *const *)inputs : NULL,
		outputs);
	if (status == SOUNDSCAPER_SYNTHETIC_NON_CONTIGUOUS) {
		napi_throw_error(env, "SOUNDSCAPER_ADDON_NON_CONTIGUOUS",
			"A synthetic block must continue exactly where the previous block ended.");
		return NULL;
	}
	if (status != SOUNDSCAPER_SYNTHETIC_OK) {
		return throw_range_error(env, "The synthetic block was rejected by the engine.");
	}
	napi_value rendered;
	SOUNDSCAPER_CHECK(env, napi_create_double(env,
		(double)soundscaper_synthetic_rendered_frames(engine), &rendered));
	return rendered;
}

static napi_value expected_synthetic_sample(napi_env env, napi_callback_info info)
{
	size_t argc = 3;
	napi_value argv[3];
	SOUNDSCAPER_CHECK(env, napi_get_cb_info(env, info, &argc, argv, NULL, NULL));
	if (argc < 3) return throw_type_error(env, "An expected sample requires configuration, channel and frame.");
	napi_valuetype type;
	SOUNDSCAPER_CHECK(env, napi_typeof(env, argv[0], &type));
	if (type != napi_object) return throw_type_error(env, "An expected sample requires a configuration object.");
	soundscaper_synthetic_config config;
	memset(&config, 0, sizeof(config));
	uint32_t mode = 0;
	if (!read_uint32(env, argv[0], "generation", &config.generation)
		|| !read_uint32(env, argv[0], "mode", &mode)) {
		return throw_type_error(env, "An expected sample configuration requires generation and mode.");
	}
	config.mode = (soundscaper_synthetic_mode)mode;
	uint32_t channel = 0;
	uint64_t frame = 0;
	{
		double number;
		if (napi_get_value_double(env, argv[1], &number) != napi_ok
			|| !(number >= 0.0 && number < (double)SOUNDSCAPER_SYNTHETIC_MAX_CHANNELS)
			|| number != (double)(uint32_t)number) {
			return throw_range_error(env, "An expected sample channel is outside its admitted bounds.");
		}
		channel = (uint32_t)number;
	}
	if (!read_frame_index(env, argv[2], &frame)) {
		return throw_range_error(env, "An expected sample frame must be a non-negative safe integer.");
	}
	napi_value result;
	SOUNDSCAPER_CHECK(env, napi_create_double(env,
		(double)soundscaper_synthetic_expected_sample(&config, channel, frame), &result));
	return result;
}

static int read_utf8(napi_env env, napi_value value, char *buffer, size_t capacity)
{
	size_t written = 0;
	napi_valuetype type;
	if (napi_typeof(env, value, &type) != napi_ok || type != napi_string) return 0;
	if (napi_get_value_string_utf8(env, value, buffer, capacity, &written) != napi_ok) return 0;
	return written > 0 && written < capacity;
}

static void finalize_audio_session(napi_env env, void *data, void *hint)
{
	(void)env;
	(void)hint;
	soundscaper_audio_stream_destroy((soundscaper_audio_stream *)data);
}

static soundscaper_audio_backend backend_from_name(const char *name)
{
	if (strcmp(name, "pipewire") == 0) return SOUNDSCAPER_BACKEND_PIPEWIRE;
	if (strcmp(name, "alsa") == 0) return SOUNDSCAPER_BACKEND_ALSA;
	if (strcmp(name, "jack") == 0) return SOUNDSCAPER_BACKEND_JACK;
	return SOUNDSCAPER_BACKEND_COUNT;
}

/*
 * Reads the caller's ordered candidate chain. Every entry names its own backend
 * AND its own device, because a device handle means nothing outside the backend
 * that issued it — there is no honest way to retry `@DEFAULT_SINK@` on ALSA.
 */
static int read_candidates(
	napi_env env,
	napi_value value,
	soundscaper_audio_candidate *candidates,
	uint32_t *out_count)
{
	bool is_array = false;
	uint32_t length = 0;
	if (napi_is_array(env, value, &is_array) != napi_ok || !is_array
		|| napi_get_array_length(env, value, &length) != napi_ok
		|| length == 0u || length > SOUNDSCAPER_AUDIO_MAX_CANDIDATES) {
		return 0;
	}
	for (uint32_t index = 0u; index < length; index += 1u) {
		napi_value entry;
		napi_value field;
		char backend[64];
		if (napi_get_element(env, value, index, &entry) != napi_ok) return 0;
		if (napi_get_named_property(env, entry, "backend", &field) != napi_ok
			|| !read_utf8(env, field, backend, sizeof(backend))) {
			return 0;
		}
		candidates[index].backend = backend_from_name(backend);
		if (candidates[index].backend == SOUNDSCAPER_BACKEND_COUNT) return 0;
		if (napi_get_named_property(env, entry, "deviceHandle", &field) != napi_ok
			|| !read_utf8(env, field, candidates[index].device_handle, SOUNDSCAPER_AUDIO_MAX_TEXT)) {
			return 0;
		}
	}
	*out_count = length;
	return 1;
}

static const char *open_status_name(soundscaper_audio_open_status status)
{
	switch (status) {
	case SOUNDSCAPER_AUDIO_OPEN_OK: return "ok";
	case SOUNDSCAPER_AUDIO_OPEN_BACKEND_UNAVAILABLE: return "backend-unavailable";
	case SOUNDSCAPER_AUDIO_OPEN_DEVICE_UNAVAILABLE: return "device-unavailable";
	case SOUNDSCAPER_AUDIO_OPEN_FORMAT_REFUSED: return "format-refused";
	case SOUNDSCAPER_AUDIO_OPEN_MODE_REFUSED: return "mode-refused";
	case SOUNDSCAPER_AUDIO_OPEN_INVALID_REQUEST: return "invalid-request";
	default: return "not-implemented";
	}
}

static const char *io_status_name(soundscaper_audio_io_status status)
{
	switch (status) {
	case SOUNDSCAPER_AUDIO_IO_OK: return "ok";
	case SOUNDSCAPER_AUDIO_IO_CLOSED: return "closed";
	case SOUNDSCAPER_AUDIO_IO_INVALID_BLOCK: return "invalid-block";
	case SOUNDSCAPER_AUDIO_IO_WRONG_DIRECTION: return "wrong-direction";
	case SOUNDSCAPER_AUDIO_IO_RECOVERED: return "recovered";
	default: return "device-lost";
	}
}

/*
 * Opens one device. The answer always carries both what was requested and what
 * the graph granted, because a caller that cannot tell them apart will record
 * the request as though it were the outcome.
 */
static napi_value open_audio_device(napi_env env, napi_callback_info info)
{
	size_t argc = 1;
	napi_value argv[1];
	SOUNDSCAPER_CHECK(env, napi_get_cb_info(env, info, &argc, argv, NULL, NULL));
	napi_valuetype type;
	if (argc < 1 || napi_typeof(env, argv[0], &type) != napi_ok || type != napi_object) {
		return throw_type_error(env, "Opening an audio device requires its request record.");
	}
	napi_value candidates_value;
	soundscaper_audio_candidate candidates[SOUNDSCAPER_AUDIO_MAX_CANDIDATES];
	uint32_t candidate_count = 0;
	SOUNDSCAPER_CHECK(env, napi_get_named_property(env, argv[0], "candidates", &candidates_value));
	if (!read_candidates(env, candidates_value, candidates, &candidate_count)) {
		return throw_type_error(env,
			"An audio device request requires an ordered candidate list, each naming its backend and device.");
	}
	uint32_t direction = 0, exclusive = 0, rate = 0, frames = 0, channels = 0;
	if (!read_uint32(env, argv[0], "direction", &direction)
		|| !read_uint32(env, argv[0], "exclusive", &exclusive)
		|| !read_uint32(env, argv[0], "sampleRate", &rate)
		|| !read_uint32(env, argv[0], "periodFrames", &frames)
		|| !read_uint32(env, argv[0], "channelCount", &channels)) {
		return throw_type_error(env, "An audio device request must carry exactly its numeric fields.");
	}

	soundscaper_audio_stream *device = NULL;
	soundscaper_audio_open_report report;
	const soundscaper_audio_open_status status = soundscaper_audio_stream_open(
		candidates, candidate_count, (soundscaper_device_direction)direction, exclusive,
		rate, frames, channels, &device, &report);

	napi_value result;
	SOUNDSCAPER_CHECK(env, napi_create_object(env, &result));
	if (set_string(env, result, "status", open_status_name(status)) == NULL) return NULL;

	/* Every attempt is reported, in order, so a fallback is visible as a
	 * sequence of refusals rather than appearing as a plain success. */
	napi_value attempts;
	SOUNDSCAPER_CHECK(env, napi_create_array_with_length(env, (size_t)report.attempt_count, &attempts));
	for (uint32_t index = 0u; index < report.attempt_count; index += 1u) {
		napi_value attempt;
		SOUNDSCAPER_CHECK(env, napi_create_object(env, &attempt));
		if (set_string(env, attempt, "backend", soundscaper_audio_backend_name(report.attempts[index].backend)) == NULL) return NULL;
		if (set_string(env, attempt, "deviceHandle", report.attempts[index].device_handle) == NULL) return NULL;
		if (set_string(env, attempt, "status", open_status_name(report.attempts[index].status)) == NULL) return NULL;
		if (set_string(env, attempt, "detail", report.attempts[index].detail) == NULL) return NULL;
		SOUNDSCAPER_CHECK(env, napi_set_element(env, attempts, index, attempt));
	}
	SOUNDSCAPER_CHECK(env, napi_set_named_property(env, result, "attempts", attempts));
	if (set_string(env, result, "requestedBackend",
		soundscaper_audio_backend_name(candidates[0].backend)) == NULL) {
		return NULL;
	}
	if (status != SOUNDSCAPER_AUDIO_OPEN_OK) {
		if (set_string(env, result, "detail",
			report.attempt_count > 0u ? report.attempts[report.attempt_count - 1u].detail : "") == NULL) {
			return NULL;
		}
		return result;
	}

	if (set_string(env, result, "grantedBackend", soundscaper_audio_backend_name(report.granted_backend)) == NULL) return NULL;
	if (set_string(env, result, "deviceName", report.granted.device_name) == NULL) return NULL;
	if (set_string(env, result, "detail", report.granted.detail) == NULL) return NULL;
	napi_value number;
	SOUNDSCAPER_CHECK(env, napi_get_boolean(env, report.granted_backend != candidates[0].backend, &number));
	SOUNDSCAPER_CHECK(env, napi_set_named_property(env, result, "fellBack", number));
	SOUNDSCAPER_CHECK(env, napi_create_uint32(env, report.granted.sample_rate, &number));
	SOUNDSCAPER_CHECK(env, napi_set_named_property(env, result, "grantedSampleRate", number));
	SOUNDSCAPER_CHECK(env, napi_create_uint32(env, report.granted.period_frames, &number));
	SOUNDSCAPER_CHECK(env, napi_set_named_property(env, result, "grantedPeriodFrames", number));
	SOUNDSCAPER_CHECK(env, napi_create_uint32(env, report.granted.channel_count, &number));
	SOUNDSCAPER_CHECK(env, napi_set_named_property(env, result, "grantedChannelCount", number));
	SOUNDSCAPER_CHECK(env, napi_get_boolean(env, report.granted.exclusive != 0u, &number));
	SOUNDSCAPER_CHECK(env, napi_set_named_property(env, result, "grantedExclusive", number));
	napi_value session_handle;
	if (napi_create_external(env, device, finalize_audio_session, NULL, &session_handle) != napi_ok) {
		soundscaper_audio_stream_close(device);
		napi_throw_error(env, "SOUNDSCAPER_ADDON_FAILED", "The audio session handle could not be created.");
		return NULL;
	}
	SOUNDSCAPER_CHECK(env, napi_set_named_property(env, result, "session", session_handle));
	return result;
}

static napi_value audio_device_transfer(napi_env env, napi_callback_info info, int writing)
{
	size_t argc = 3;
	napi_value argv[3];
	SOUNDSCAPER_CHECK(env, napi_get_cb_info(env, info, &argc, argv, NULL, NULL));
	soundscaper_audio_stream *session = NULL;
	if (argc < 3 || napi_get_value_external(env, argv[0], (void **)&session) != napi_ok || session == NULL) {
		return throw_type_error(env, "An audio transfer requires a live session handle.");
	}
	double number;
	if (napi_get_value_double(env, argv[1], &number) != napi_ok
		|| !(number >= 1.0 && number <= 8192.0) || number != (double)(uint32_t)number) {
		return throw_range_error(env, "An audio transfer frame count is outside its admitted bounds.");
	}
	const uint32_t frame_count = (uint32_t)number;
	uint32_t channel_count = 0;
	bool is_array = false;
	if (napi_is_array(env, argv[2], &is_array) != napi_ok || !is_array
		|| napi_get_array_length(env, argv[2], &channel_count) != napi_ok
		|| channel_count == 0u || channel_count > SOUNDSCAPER_SYNTHETIC_MAX_CHANNELS) {
		return throw_type_error(env, "An audio transfer requires its planar channel array.");
	}
	float *pointers[SOUNDSCAPER_SYNTHETIC_MAX_CHANNELS];
	if (!read_channel_pointers(env, argv[2], channel_count, frame_count, pointers)) {
		return throw_type_error(env, "Every audio transfer channel must be a large enough Float32Array.");
	}
	uint64_t lost = 0u;
	const soundscaper_audio_io_status status = writing
		? soundscaper_audio_stream_write(session, (const float *const *)pointers, frame_count, &lost)
		: soundscaper_audio_stream_read(session, pointers, frame_count, &lost);

	napi_value result;
	SOUNDSCAPER_CHECK(env, napi_create_object(env, &result));
	if (set_string(env, result, "status", io_status_name(status)) == NULL) return NULL;
	napi_value number_value;
	SOUNDSCAPER_CHECK(env, napi_create_double(env, (double)lost, &number_value));
	SOUNDSCAPER_CHECK(env, napi_set_named_property(env, result, "lostFrames", number_value));
	SOUNDSCAPER_CHECK(env, napi_create_double(env, (double)soundscaper_audio_stream_frames(session), &number_value));
	SOUNDSCAPER_CHECK(env, napi_set_named_property(env, result, "framesTransferred", number_value));
	SOUNDSCAPER_CHECK(env, napi_create_double(env, (double)soundscaper_audio_stream_lost_frames(session), &number_value));
	SOUNDSCAPER_CHECK(env, napi_set_named_property(env, result, "totalLostFrames", number_value));
	return result;
}

static napi_value write_audio_device(napi_env env, napi_callback_info info)
{
	return audio_device_transfer(env, info, 1);
}

static napi_value read_audio_device(napi_env env, napi_callback_info info)
{
	return audio_device_transfer(env, info, 0);
}

static napi_value close_audio_device(napi_env env, napi_callback_info info)
{
	size_t argc = 1;
	napi_value argv[1];
	SOUNDSCAPER_CHECK(env, napi_get_cb_info(env, info, &argc, argv, NULL, NULL));
	soundscaper_audio_stream *session = NULL;
	if (argc < 1 || napi_get_value_external(env, argv[0], (void **)&session) != napi_ok || session == NULL) {
		return throw_type_error(env, "Closing an audio device requires its session handle.");
	}
	soundscaper_audio_stream_close(session);
	napi_value ok;
	SOUNDSCAPER_CHECK(env, napi_get_boolean(env, true, &ok));
	return ok;
}

static napi_value list_plugin_candidates(napi_env env, napi_callback_info info)
{
	size_t argc = 2;
	napi_value argv[2];
	SOUNDSCAPER_CHECK(env, napi_get_cb_info(env, info, &argc, argv, NULL, NULL));
	char root[SOUNDSCAPER_PLUGIN_MAX_PATH];
	char suffix[64];
	if (argc < 2 || !read_utf8(env, argv[0], root, sizeof(root)) || !read_utf8(env, argv[1], suffix, sizeof(suffix))) {
		return throw_type_error(env, "Listing plug-in candidates requires a root path and a filename suffix.");
	}
	soundscaper_plugin_candidates *candidates = calloc(1u, sizeof(*candidates));
	if (candidates == NULL) {
		napi_throw_error(env, "SOUNDSCAPER_ADDON_FAILED", "The candidate list could not be allocated.");
		return NULL;
	}
	const int listed = soundscaper_plugin_list_candidates(root, suffix, candidates);
	napi_value result = NULL;
	if (listed != 0) {
		free(candidates);
		napi_throw_error(env, "SOUNDSCAPER_PLUGIN_ROOT_UNREADABLE", "The plug-in root could not be read.");
		return NULL;
	}
	if (napi_create_array_with_length(env, (size_t)candidates->count, &result) != napi_ok) {
		free(candidates);
		napi_throw_error(env, "SOUNDSCAPER_ADDON_FAILED", "The candidate list could not be created.");
		return NULL;
	}
	for (uint32_t index = 0u; index < candidates->count; index += 1u) {
		napi_value path;
		if (napi_create_string_utf8(env, candidates->paths[index], NAPI_AUTO_LENGTH, &path) != napi_ok
			|| napi_set_element(env, result, index, path) != napi_ok) {
			free(candidates);
			napi_throw_error(env, "SOUNDSCAPER_ADDON_FAILED", "The candidate list could not be populated.");
			return NULL;
		}
	}
	free(candidates);
	return result;
}

static const char *inspect_status_name(soundscaper_plugin_inspect_status status)
{
	switch (status) {
	case SOUNDSCAPER_PLUGIN_INSPECT_OK: return "ok";
	case SOUNDSCAPER_PLUGIN_INSPECT_UNREADABLE: return "unreadable";
	case SOUNDSCAPER_PLUGIN_INSPECT_NOT_A_MODULE: return "not-a-module";
	case SOUNDSCAPER_PLUGIN_INSPECT_NO_ENTRY: return "no-entry";
	case SOUNDSCAPER_PLUGIN_INSPECT_ABI_MISMATCH: return "abi-mismatch";
	default: return "malformed";
	}
}

static napi_value inspect_plugin_candidate(napi_env env, napi_callback_info info)
{
	size_t argc = 1;
	napi_value argv[1];
	SOUNDSCAPER_CHECK(env, napi_get_cb_info(env, info, &argc, argv, NULL, NULL));
	char path[SOUNDSCAPER_PLUGIN_MAX_PATH];
	if (argc < 1 || !read_utf8(env, argv[0], path, sizeof(path))) {
		return throw_type_error(env, "Inspecting a plug-in candidate requires its path.");
	}
	soundscaper_plugin_inspection inspection;
	soundscaper_plugin_inspect(path, &inspection);

	napi_value result;
	SOUNDSCAPER_CHECK(env, napi_create_object(env, &result));
	if (set_string(env, result, "status", inspect_status_name(inspection.status)) == NULL) return NULL;
	if (set_string(env, result, "detail", inspection.detail) == NULL) return NULL;
	if (set_string(env, result, "stableId", inspection.stable_id) == NULL) return NULL;
	if (set_string(env, result, "name", inspection.name) == NULL) return NULL;
	if (set_string(env, result, "vendor", inspection.vendor) == NULL) return NULL;
	if (set_string(env, result, "version", inspection.version) == NULL) return NULL;
	if (set_string(env, result, "classification",
		inspection.classification == SOUNDSCAPER_FIXTURE_INSTRUMENT ? "instrument" : "effect") == NULL) {
		return NULL;
	}
	napi_value number;
	SOUNDSCAPER_CHECK(env, napi_create_uint32(env, inspection.input_channels, &number));
	SOUNDSCAPER_CHECK(env, napi_set_named_property(env, result, "inputChannels", number));
	SOUNDSCAPER_CHECK(env, napi_create_uint32(env, inspection.output_channels, &number));
	SOUNDSCAPER_CHECK(env, napi_set_named_property(env, result, "outputChannels", number));
	SOUNDSCAPER_CHECK(env, napi_get_boolean(env, inspection.realtime != 0u, &number));
	SOUNDSCAPER_CHECK(env, napi_set_named_property(env, result, "realtime", number));
	SOUNDSCAPER_CHECK(env, napi_get_boolean(env, inspection.offline != 0u, &number));
	SOUNDSCAPER_CHECK(env, napi_set_named_property(env, result, "offline", number));
	/* A plug-in that reports no latency is not the same as one reporting zero,
	 * and the difference has to survive all the way to the delay plan. */
	if (inspection.reported_latency_frames < 0) {
		SOUNDSCAPER_CHECK(env, napi_get_null(env, &number));
	} else {
		SOUNDSCAPER_CHECK(env, napi_create_int32(env, inspection.reported_latency_frames, &number));
	}
	SOUNDSCAPER_CHECK(env, napi_set_named_property(env, result, "reportedLatencyFrames", number));
	return result;
}

static void finalize_plugin_host(napi_env env, void *data, void *hint)
{
	(void)env;
	(void)hint;
	soundscaper_plugin_host_close((soundscaper_plugin_host *)data);
}

static const char *host_status_name(soundscaper_plugin_host_status status)
{
	switch (status) {
	case SOUNDSCAPER_PLUGIN_HOST_OK: return "ok";
	case SOUNDSCAPER_PLUGIN_HOST_UNREADABLE: return "unreadable";
	case SOUNDSCAPER_PLUGIN_HOST_NO_ENTRY: return "no-entry";
	case SOUNDSCAPER_PLUGIN_HOST_ABI_MISMATCH: return "abi-mismatch";
	case SOUNDSCAPER_PLUGIN_HOST_INVALID_BLOCK: return "invalid-block";
	case SOUNDSCAPER_PLUGIN_HOST_STATE_TOO_LARGE: return "state-too-large";
	case SOUNDSCAPER_PLUGIN_HOST_STATE_REJECTED: return "state-rejected";
	default: return "refused";
	}
}

static napi_value open_plugin_instance(napi_env env, napi_callback_info info)
{
	size_t argc = 3;
	napi_value argv[3];
	SOUNDSCAPER_CHECK(env, napi_get_cb_info(env, info, &argc, argv, NULL, NULL));
	char path[SOUNDSCAPER_PLUGIN_MAX_PATH];
	uint32_t sample_rate = 0;
	uint32_t maximum_frames = 0;
	double number;
	if (argc < 3 || !read_utf8(env, argv[0], path, sizeof(path))
		|| napi_get_value_double(env, argv[1], &number) != napi_ok || number < 8000.0 || number > 768000.0) {
		return throw_type_error(env, "Opening a plug-in instance requires a path, sample rate and block ceiling.");
	}
	sample_rate = (uint32_t)number;
	if (napi_get_value_double(env, argv[2], &number) != napi_ok || number < 1.0 || number > 65536.0) {
		return throw_range_error(env, "A plug-in block ceiling is outside its admitted bounds.");
	}
	maximum_frames = (uint32_t)number;

	soundscaper_plugin_host *host = NULL;
	const soundscaper_plugin_host_status status =
		soundscaper_plugin_host_open(path, sample_rate, maximum_frames, &host);
	if (status != SOUNDSCAPER_PLUGIN_HOST_OK) {
		napi_throw_error(env, "SOUNDSCAPER_PLUGIN_HOST_REFUSED", host_status_name(status));
		return NULL;
	}
	napi_value handle;
	if (napi_create_external(env, host, finalize_plugin_host, NULL, &handle) != napi_ok) {
		soundscaper_plugin_host_close(host);
		napi_throw_error(env, "SOUNDSCAPER_ADDON_FAILED", "The plug-in host handle could not be created.");
		return NULL;
	}
	return handle;
}

static napi_value process_plugin_block(napi_env env, napi_callback_info info)
{
	size_t argc = 4;
	napi_value argv[4];
	SOUNDSCAPER_CHECK(env, napi_get_cb_info(env, info, &argc, argv, NULL, NULL));
	soundscaper_plugin_host *host = NULL;
	if (argc < 4 || napi_get_value_external(env, argv[0], (void **)&host) != napi_ok || host == NULL) {
		return throw_type_error(env, "Processing a plug-in block requires a live host handle.");
	}
	double number;
	if (napi_get_value_double(env, argv[1], &number) != napi_ok
		|| number < 1.0 || number > (double)SOUNDSCAPER_SYNTHETIC_MAX_FRAMES || number != (double)(uint32_t)number) {
		return throw_range_error(env, "A plug-in block frame count is outside its admitted bounds.");
	}
	const uint32_t frame_count = (uint32_t)number;
	const uint32_t channel_count = soundscaper_plugin_host_channel_count(host);
	if (channel_count == 0u || channel_count > SOUNDSCAPER_SYNTHETIC_MAX_CHANNELS) {
		return throw_range_error(env, "The plug-in reports an unusable channel count.");
	}
	float *outputs[SOUNDSCAPER_SYNTHETIC_MAX_CHANNELS];
	float *inputs[SOUNDSCAPER_SYNTHETIC_MAX_CHANNELS];
	if (!read_channel_pointers(env, argv[3], channel_count, frame_count, outputs)) {
		return throw_type_error(env, "Every plug-in output channel must be a large enough Float32Array.");
	}
	int has_input = 0;
	napi_valuetype input_type;
	SOUNDSCAPER_CHECK(env, napi_typeof(env, argv[2], &input_type));
	if (input_type != napi_null && input_type != napi_undefined) {
		if (!read_channel_pointers(env, argv[2], channel_count, frame_count, inputs)) {
			return throw_type_error(env, "Every plug-in input channel must be a large enough Float32Array.");
		}
		has_input = 1;
	}
	const soundscaper_plugin_host_status status = soundscaper_plugin_host_process(
		host, frame_count, has_input ? (const float *const *)inputs : NULL, outputs);
	if (status != SOUNDSCAPER_PLUGIN_HOST_OK) {
		napi_throw_error(env, "SOUNDSCAPER_PLUGIN_HOST_FAILED", host_status_name(status));
		return NULL;
	}
	napi_value rendered;
	SOUNDSCAPER_CHECK(env, napi_create_uint32(env, frame_count, &rendered));
	return rendered;
}

static napi_value plugin_latency_frames(napi_env env, napi_callback_info info)
{
	size_t argc = 1;
	napi_value argv[1];
	SOUNDSCAPER_CHECK(env, napi_get_cb_info(env, info, &argc, argv, NULL, NULL));
	soundscaper_plugin_host *host = NULL;
	if (argc < 1 || napi_get_value_external(env, argv[0], (void **)&host) != napi_ok || host == NULL) {
		return throw_type_error(env, "A plug-in latency query requires a live host handle.");
	}
	const int32_t frames = soundscaper_plugin_host_latency_frames(host);
	napi_value result;
	if (frames < 0) {
		SOUNDSCAPER_CHECK(env, napi_get_null(env, &result));
	} else {
		SOUNDSCAPER_CHECK(env, napi_create_int32(env, frames, &result));
	}
	return result;
}

static napi_value save_plugin_state(napi_env env, napi_callback_info info)
{
	size_t argc = 1;
	napi_value argv[1];
	SOUNDSCAPER_CHECK(env, napi_get_cb_info(env, info, &argc, argv, NULL, NULL));
	soundscaper_plugin_host *host = NULL;
	if (argc < 1 || napi_get_value_external(env, argv[0], (void **)&host) != napi_ok || host == NULL) {
		return throw_type_error(env, "Saving plug-in state requires a live host handle.");
	}
	uint32_t required = 0;
	soundscaper_plugin_host_status status = soundscaper_plugin_host_save_state(host, NULL, 0u, &required);
	if (status == SOUNDSCAPER_PLUGIN_HOST_STATE_TOO_LARGE && required > SOUNDSCAPER_FIXTURE_MAX_STATE_BYTES) {
		napi_throw_error(env, "SOUNDSCAPER_PLUGIN_STATE_TOO_LARGE", "state-too-large");
		return NULL;
	}
	void *data = NULL;
	napi_value buffer;
	SOUNDSCAPER_CHECK(env, napi_create_arraybuffer(env, (size_t)required, &data, &buffer));
	status = soundscaper_plugin_host_save_state(host, (uint8_t *)data, required, &required);
	if (status != SOUNDSCAPER_PLUGIN_HOST_OK) {
		napi_throw_error(env, "SOUNDSCAPER_PLUGIN_STATE_REJECTED", host_status_name(status));
		return NULL;
	}
	return buffer;
}

static napi_value load_plugin_state(napi_env env, napi_callback_info info)
{
	size_t argc = 2;
	napi_value argv[2];
	SOUNDSCAPER_CHECK(env, napi_get_cb_info(env, info, &argc, argv, NULL, NULL));
	soundscaper_plugin_host *host = NULL;
	if (argc < 2 || napi_get_value_external(env, argv[0], (void **)&host) != napi_ok || host == NULL) {
		return throw_type_error(env, "Loading plug-in state requires a live host handle.");
	}
	napi_typedarray_type element_type;
	size_t byte_length = 0;
	void *data = NULL;
	if (napi_get_typedarray_info(env, argv[1], &element_type, &byte_length, &data, NULL, NULL) != napi_ok
		|| element_type != napi_uint8_array || data == NULL) {
		return throw_type_error(env, "Plug-in state must arrive as a Uint8Array.");
	}
	if (byte_length > SOUNDSCAPER_FIXTURE_MAX_STATE_BYTES) {
		napi_throw_error(env, "SOUNDSCAPER_PLUGIN_STATE_TOO_LARGE", "state-too-large");
		return NULL;
	}
	const soundscaper_plugin_host_status status =
		soundscaper_plugin_host_load_state(host, (const uint8_t *)data, (uint32_t)byte_length);
	if (status != SOUNDSCAPER_PLUGIN_HOST_OK) {
		napi_throw_error(env, "SOUNDSCAPER_PLUGIN_STATE_REJECTED", host_status_name(status));
		return NULL;
	}
	napi_value ok;
	SOUNDSCAPER_CHECK(env, napi_get_boolean(env, true, &ok));
	return ok;
}

NAPI_MODULE_INIT()
{
	const napi_property_descriptor properties[] = {
		{ "describe", NULL, describe, NULL, NULL, NULL, napi_default, NULL },
		{ "createSyntheticEngine", NULL, create_synthetic_engine, NULL, NULL, NULL, napi_default, NULL },
		{ "renderSyntheticBlock", NULL, render_synthetic_block, NULL, NULL, NULL, napi_default, NULL },
		{ "expectedSyntheticSample", NULL, expected_synthetic_sample, NULL, NULL, NULL, napi_default, NULL },
		{ "enumerateAudioBackends", NULL, enumerate_audio_backends, NULL, NULL, NULL, napi_default, NULL },
		{ "openAudioDevice", NULL, open_audio_device, NULL, NULL, NULL, napi_default, NULL },
		{ "writeAudioDevice", NULL, write_audio_device, NULL, NULL, NULL, napi_default, NULL },
		{ "readAudioDevice", NULL, read_audio_device, NULL, NULL, NULL, napi_default, NULL },
		{ "closeAudioDevice", NULL, close_audio_device, NULL, NULL, NULL, napi_default, NULL },
		{ "listPluginCandidates", NULL, list_plugin_candidates, NULL, NULL, NULL, napi_default, NULL },
		{ "inspectPluginCandidate", NULL, inspect_plugin_candidate, NULL, NULL, NULL, napi_default, NULL },
		{ "openPluginInstance", NULL, open_plugin_instance, NULL, NULL, NULL, napi_default, NULL },
		{ "processPluginBlock", NULL, process_plugin_block, NULL, NULL, NULL, napi_default, NULL },
		{ "pluginLatencyFrames", NULL, plugin_latency_frames, NULL, NULL, NULL, napi_default, NULL },
		{ "savePluginState", NULL, save_plugin_state, NULL, NULL, NULL, napi_default, NULL },
		{ "loadPluginState", NULL, load_plugin_state, NULL, NULL, NULL, napi_default, NULL },
	};
	if (napi_define_properties(env, exports, sizeof(properties) / sizeof(properties[0]), properties) != napi_ok) {
		napi_throw_error(env, "SOUNDSCAPER_ADDON_FAILED", "The native helper addon could not be initialized.");
		return NULL;
	}
	return exports;
}
