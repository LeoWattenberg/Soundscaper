/* SPDX-License-Identifier: AGPL-3.0-only */

#include "addon_plugin.h"

#include <stdlib.h>

#include "plugin_host.h"
#include "plugin_scan.h"
#include "synthetic_engine.h"

napi_value list_plugin_candidates(napi_env env, napi_callback_info info)
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
	if (listed == SOUNDSCAPER_PLUGIN_LIST_UNIMPLEMENTED) {
		free(candidates);
		napi_throw_error(env, "SOUNDSCAPER_PLUGIN_SCAN_UNIMPLEMENTED",
			"This target does not implement plug-in scanning.");
		return NULL;
	}
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
	case SOUNDSCAPER_PLUGIN_INSPECT_UNIMPLEMENTED: return "unimplemented";
	default: return "malformed";
	}
}

napi_value inspect_plugin_candidate(napi_env env, napi_callback_info info)
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

napi_value open_plugin_instance(napi_env env, napi_callback_info info)
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

napi_value process_plugin_block(napi_env env, napi_callback_info info)
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
	/* A plug-in may read more channels than it writes, and `process` reads the
	 * count it declared: sizing the input by the output count hands it pointers
	 * nobody supplied. */
	const uint32_t input_channel_count = soundscaper_plugin_host_input_channel_count(host);
	if (input_channel_count > SOUNDSCAPER_SYNTHETIC_MAX_CHANNELS) {
		return throw_range_error(env, "The plug-in reports an unusable input channel count.");
	}
	float *outputs[SOUNDSCAPER_SYNTHETIC_MAX_CHANNELS];
	float *inputs[SOUNDSCAPER_SYNTHETIC_MAX_CHANNELS];
	if (!read_channel_pointers(env, argv[3], channel_count, frame_count, outputs)) {
		return throw_type_error(env,
			"A plug-in block requires one large enough Float32Array per output channel.");
	}
	int has_input = 0;
	napi_valuetype input_type;
	SOUNDSCAPER_CHECK(env, napi_typeof(env, argv[2], &input_type));
	if (input_type != napi_null && input_type != napi_undefined) {
		if (!read_channel_pointers(env, argv[2], input_channel_count, frame_count, inputs)) {
			return throw_type_error(env,
				"A plug-in block requires one large enough Float32Array per declared input channel.");
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

napi_value plugin_latency_frames(napi_env env, napi_callback_info info)
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

napi_value save_plugin_state(napi_env env, napi_callback_info info)
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

napi_value load_plugin_state(napi_env env, napi_callback_info info)
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
