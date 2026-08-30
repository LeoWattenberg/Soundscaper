/* SPDX-License-Identifier: AGPL-3.0-only */

/** Deterministic, redistributable CLAP fixture for the installed peer canary. */

#include <clap/clap.h>

#include <algorithm>
#include <cstdint>
#include <cstring>
#include <new>

namespace {

constexpr uint32_t fixtureLatency = 32u;
constexpr char fixtureId[] = "org.soundscaper.fixture.deterministic-gain";
constexpr const char *fixtureFeatures[] = { CLAP_PLUGIN_FEATURE_AUDIO_EFFECT, nullptr };

const clap_plugin_descriptor_t descriptor{
	CLAP_VERSION,
	fixtureId,
	"Soundscaper deterministic gain fixture",
	"Soundscaper",
	"https://soundscaper.org",
	"",
	"",
	"1.0.0",
	"Doubles two-channel input and persists one exact gain value.",
	fixtureFeatures,
};

struct Instance {
	clap_plugin_t plugin{};
	float gain = 2.0F;
};

Instance &instance(const clap_plugin_t *plugin)
{
	return *static_cast<Instance *>(plugin->plugin_data);
}

bool init(const clap_plugin_t *) { return true; }
void destroy(const clap_plugin_t *plugin) { delete &instance(plugin); }
bool activate(const clap_plugin_t *, double sampleRate, uint32_t minimum, uint32_t maximum)
{
	return sampleRate >= 8'000.0 && sampleRate <= 768'000.0
		&& minimum > 0u && maximum >= minimum && maximum <= 65'536u;
}
void deactivate(const clap_plugin_t *) {}
bool start(const clap_plugin_t *) { return true; }
void stop(const clap_plugin_t *) {}
void reset(const clap_plugin_t *) {}

clap_process_status process(const clap_plugin_t *plugin, const clap_process_t *request)
{
	if (request == nullptr || request->frames_count == 0u
		|| request->audio_inputs_count != 1u || request->audio_outputs_count != 1u
		|| request->audio_inputs == nullptr || request->audio_outputs == nullptr
		|| request->audio_inputs[0].channel_count != 2u
		|| request->audio_outputs[0].channel_count != 2u
		|| request->audio_inputs[0].data32 == nullptr
		|| request->audio_outputs[0].data32 == nullptr) return CLAP_PROCESS_ERROR;
	for (uint32_t channel = 0u; channel < 2u; ++channel) {
		const float *input = request->audio_inputs[0].data32[channel];
		float *output = request->audio_outputs[0].data32[channel];
		if (input == nullptr || output == nullptr) return CLAP_PROCESS_ERROR;
		for (uint32_t frame = 0u; frame < request->frames_count; ++frame) {
			output[frame] = input[frame] * instance(plugin).gain;
		}
	}
	return CLAP_PROCESS_CONTINUE;
}

uint32_t portCount(const clap_plugin_t *, bool) { return 1u; }
bool port(const clap_plugin_t *, uint32_t index, bool input, clap_audio_port_info_t *info)
{
	if (index != 0u || info == nullptr) return false;
	*info = clap_audio_port_info_t{};
	info->id = input ? 1u : 2u;
	std::strncpy(info->name, input ? "Input" : "Output", sizeof(info->name) - 1u);
	info->flags = CLAP_AUDIO_PORT_IS_MAIN;
	info->channel_count = 2u;
	info->port_type = CLAP_PORT_STEREO;
	info->in_place_pair = CLAP_INVALID_ID;
	return true;
}

uint32_t latency(const clap_plugin_t *) { return fixtureLatency; }

bool save(const clap_plugin_t *plugin, const clap_ostream_t *stream)
{
	if (stream == nullptr || stream->write == nullptr) return false;
	const float gain = instance(plugin).gain;
	return stream->write(stream, &gain, sizeof(gain)) == static_cast<int64_t>(sizeof(gain));
}

bool load(const clap_plugin_t *plugin, const clap_istream_t *stream)
{
	if (stream == nullptr || stream->read == nullptr) return false;
	float gain = 0.0F;
	if (stream->read(stream, &gain, sizeof(gain)) != static_cast<int64_t>(sizeof(gain))
		|| !(gain >= 0.25F && gain <= 4.0F)) return false;
	instance(plugin).gain = gain;
	return true;
}

const clap_plugin_audio_ports_t audioPorts{portCount, port};
const clap_plugin_latency_t latencyExtension{latency};
const clap_plugin_state_t stateExtension{save, load};

const void *extension(const clap_plugin_t *, const char *id)
{
	if (id == nullptr) return nullptr;
	if (std::strcmp(id, CLAP_EXT_AUDIO_PORTS) == 0) return &audioPorts;
	if (std::strcmp(id, CLAP_EXT_LATENCY) == 0) return &latencyExtension;
	if (std::strcmp(id, CLAP_EXT_STATE) == 0) return &stateExtension;
	return nullptr;
}

void mainThread(const clap_plugin_t *) {}

uint32_t count(const clap_plugin_factory_t *) { return 1u; }
const clap_plugin_descriptor_t *describe(const clap_plugin_factory_t *, uint32_t index)
{
	return index == 0u ? &descriptor : nullptr;
}

const clap_plugin_t *create(
	const clap_plugin_factory_t *, const clap_host_t *, const char *pluginId)
{
	if (pluginId == nullptr || std::strcmp(pluginId, fixtureId) != 0) return nullptr;
	auto *value = new (std::nothrow) Instance();
	if (value == nullptr) return nullptr;
	value->plugin = clap_plugin_t{
		&descriptor,
		value,
		init,
		destroy,
		activate,
		deactivate,
		start,
		stop,
		reset,
		process,
		extension,
		mainThread,
	};
	return &value->plugin;
}

const clap_plugin_factory_t factory{count, describe, create};
bool entryInit(const char *path) { return path != nullptr && path[0] != '\0'; }
void entryDeinit() {}
const void *getFactory(const char *id)
{
	return id != nullptr && std::strcmp(id, CLAP_PLUGIN_FACTORY_ID) == 0 ? &factory : nullptr;
}

} // namespace

extern "C" CLAP_EXPORT const clap_plugin_entry_t clap_entry{
	CLAP_VERSION,
	entryInit,
	entryDeinit,
	getFactory,
};
