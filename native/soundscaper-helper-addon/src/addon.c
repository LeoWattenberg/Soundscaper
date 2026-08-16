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
	SOUNDSCAPER_CHECK(env, napi_set_named_property(env, result, "capabilities", capabilities));
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

NAPI_MODULE_INIT()
{
	const napi_property_descriptor properties[] = {
		{ "describe", NULL, describe, NULL, NULL, NULL, napi_default, NULL },
		{ "createSyntheticEngine", NULL, create_synthetic_engine, NULL, NULL, NULL, napi_default, NULL },
		{ "renderSyntheticBlock", NULL, render_synthetic_block, NULL, NULL, NULL, napi_default, NULL },
		{ "expectedSyntheticSample", NULL, expected_synthetic_sample, NULL, NULL, NULL, napi_default, NULL },
	};
	if (napi_define_properties(env, exports, sizeof(properties) / sizeof(properties[0]), properties) != napi_ok) {
		napi_throw_error(env, "SOUNDSCAPER_ADDON_FAILED", "The native helper addon could not be initialized.");
		return NULL;
	}
	return exports;
}
