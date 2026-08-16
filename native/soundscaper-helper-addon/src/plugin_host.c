/* SPDX-License-Identifier: AGPL-3.0-only */

#include "plugin_host.h"

#include <stdlib.h>
#include <string.h>

#if defined(_WIN32)
#define SOUNDSCAPER_PLUGIN_HAS_DLOPEN 0
#else
#define SOUNDSCAPER_PLUGIN_HAS_DLOPEN 1
#include <dlfcn.h>
#endif

struct soundscaper_plugin_host {
	void *library;
	const soundscaper_fixture_descriptor *descriptor;
	soundscaper_fixture_instance *instance;
	uint32_t maximum_frames;
};

soundscaper_plugin_host_status soundscaper_plugin_host_open(
	const char *path,
	uint32_t sample_rate,
	uint32_t maximum_frames,
	soundscaper_plugin_host **out_host)
{
	if (out_host == NULL) return SOUNDSCAPER_PLUGIN_HOST_REFUSED;
	*out_host = NULL;
	if (path == NULL || maximum_frames == 0u || maximum_frames > 65536u) {
		return SOUNDSCAPER_PLUGIN_HOST_REFUSED;
	}
#if SOUNDSCAPER_PLUGIN_HAS_DLOPEN
	void *library = dlopen(path, RTLD_NOW | RTLD_LOCAL);
	if (library == NULL) return SOUNDSCAPER_PLUGIN_HOST_UNREADABLE;
	soundscaper_fixture_entry_fn entry =
		(soundscaper_fixture_entry_fn)dlsym(library, SOUNDSCAPER_FIXTURE_ENTRY_SYMBOL);
	if (entry == NULL) {
		dlclose(library);
		return SOUNDSCAPER_PLUGIN_HOST_NO_ENTRY;
	}
	const soundscaper_fixture_descriptor *descriptor = entry();
	if (descriptor == NULL || descriptor->abi_version != SOUNDSCAPER_FIXTURE_ABI_VERSION) {
		dlclose(library);
		return SOUNDSCAPER_PLUGIN_HOST_ABI_MISMATCH;
	}
	/* Instruments are identified by scanning but never instantiated before
	 * milestone 8B, and the refusal lives here as well as in the registry so
	 * that a registry mistake still cannot start one. */
	if (descriptor->classification != SOUNDSCAPER_FIXTURE_EFFECT
		|| descriptor->create == NULL || descriptor->destroy == NULL || descriptor->process == NULL
		|| descriptor->output_channels == 0u || descriptor->output_channels > 64u) {
		dlclose(library);
		return SOUNDSCAPER_PLUGIN_HOST_REFUSED;
	}
	soundscaper_fixture_instance *instance = descriptor->create(sample_rate, maximum_frames);
	if (instance == NULL) {
		dlclose(library);
		return SOUNDSCAPER_PLUGIN_HOST_REFUSED;
	}
	soundscaper_plugin_host *host = calloc(1u, sizeof(*host));
	if (host == NULL) {
		descriptor->destroy(instance);
		dlclose(library);
		return SOUNDSCAPER_PLUGIN_HOST_REFUSED;
	}
	host->library = library;
	host->descriptor = descriptor;
	host->instance = instance;
	host->maximum_frames = maximum_frames;
	*out_host = host;
	return SOUNDSCAPER_PLUGIN_HOST_OK;
#else
	(void)sample_rate;
	return SOUNDSCAPER_PLUGIN_HOST_UNREADABLE;
#endif
}

void soundscaper_plugin_host_close(soundscaper_plugin_host *host)
{
	if (host == NULL) return;
	if (host->descriptor != NULL && host->instance != NULL) host->descriptor->destroy(host->instance);
#if SOUNDSCAPER_PLUGIN_HAS_DLOPEN
	if (host->library != NULL) dlclose(host->library);
#endif
	free(host);
}

soundscaper_plugin_host_status soundscaper_plugin_host_process(
	soundscaper_plugin_host *host,
	uint32_t frame_count,
	const float *const *input,
	float *const *output)
{
	if (host == NULL || output == NULL) return SOUNDSCAPER_PLUGIN_HOST_REFUSED;
	if (frame_count == 0u || frame_count > host->maximum_frames) return SOUNDSCAPER_PLUGIN_HOST_INVALID_BLOCK;
	return host->descriptor->process(host->instance, frame_count, input, output) == 0
		? SOUNDSCAPER_PLUGIN_HOST_OK
		: SOUNDSCAPER_PLUGIN_HOST_INVALID_BLOCK;
}

soundscaper_plugin_host_status soundscaper_plugin_host_save_state(
	soundscaper_plugin_host *host,
	uint8_t *buffer,
	uint32_t capacity,
	uint32_t *out_byte_length)
{
	if (host == NULL || out_byte_length == NULL) return SOUNDSCAPER_PLUGIN_HOST_REFUSED;
	*out_byte_length = 0u;
	if (host->descriptor->save_state == NULL) return SOUNDSCAPER_PLUGIN_HOST_OK;
	const uint32_t required = host->descriptor->save_state(host->instance, NULL, 0u);
	if (required > SOUNDSCAPER_FIXTURE_MAX_STATE_BYTES) return SOUNDSCAPER_PLUGIN_HOST_STATE_TOO_LARGE;
	if (buffer == NULL || capacity < required) {
		*out_byte_length = required;
		return SOUNDSCAPER_PLUGIN_HOST_STATE_TOO_LARGE;
	}
	const uint32_t written = host->descriptor->save_state(host->instance, buffer, capacity);
	/* A plug-in that answers differently the second time is not merely
	 * inconsistent: honouring it would write past what the caller reserved. */
	if (written != required) return SOUNDSCAPER_PLUGIN_HOST_STATE_REJECTED;
	*out_byte_length = written;
	return SOUNDSCAPER_PLUGIN_HOST_OK;
}

soundscaper_plugin_host_status soundscaper_plugin_host_load_state(
	soundscaper_plugin_host *host,
	const uint8_t *buffer,
	uint32_t byte_length)
{
	if (host == NULL || buffer == NULL) return SOUNDSCAPER_PLUGIN_HOST_REFUSED;
	if (byte_length > SOUNDSCAPER_FIXTURE_MAX_STATE_BYTES) return SOUNDSCAPER_PLUGIN_HOST_STATE_TOO_LARGE;
	if (host->descriptor->load_state == NULL) return SOUNDSCAPER_PLUGIN_HOST_STATE_REJECTED;
	return host->descriptor->load_state(host->instance, buffer, byte_length) == 0
		? SOUNDSCAPER_PLUGIN_HOST_OK
		: SOUNDSCAPER_PLUGIN_HOST_STATE_REJECTED;
}

int32_t soundscaper_plugin_host_latency_frames(soundscaper_plugin_host *host)
{
	if (host == NULL) return -1;
	if (host->descriptor->latency_frames == NULL) return host->descriptor->reported_latency_frames;
	return host->descriptor->latency_frames(host->instance);
}

uint32_t soundscaper_plugin_host_channel_count(const soundscaper_plugin_host *host)
{
	return host == NULL ? 0u : host->descriptor->output_channels;
}
