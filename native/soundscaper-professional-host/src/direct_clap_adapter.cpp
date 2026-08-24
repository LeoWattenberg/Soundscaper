/* SPDX-License-Identifier: AGPL-3.0-only */

#include "direct_clap_adapter.h"
#include "juce_message_dispatcher.h"

#include <clap/clap.h>
#include <juce_core/juce_core.h>

#include <algorithm>
#include <atomic>
#include <cstring>
#include <memory>
#include <set>
#include <vector>

namespace soundscaper {
namespace {

struct HostState {
	std::weak_ptr<HostState> self;
	std::atomic<const clap_plugin_t *> plugin{nullptr};
	std::atomic<bool> callbackQueued{false};
};

const void *hostExtension(const clap_host_t *, const char *) { return nullptr; }
void requestRestart(const clap_host_t *) {}
void requestProcess(const clap_host_t *) {}
void requestCallback(const clap_host_t *host)
{
	auto *raw = host == nullptr ? nullptr : static_cast<HostState *>(host->host_data);
	auto state = raw == nullptr ? std::shared_ptr<HostState>() : raw->self.lock();
	if (state == nullptr || state->callbackQueued.exchange(true, std::memory_order_acq_rel)) return;
	if (!postJuceMessageTask([state]() {
		state->callbackQueued.store(false, std::memory_order_release);
		const auto *plugin = state->plugin.load(std::memory_order_acquire);
		if (plugin != nullptr) plugin->on_main_thread(plugin);
	})) state->callbackQueued.store(false, std::memory_order_release);
}

struct EmptyEvents {
	clap_input_events_t input{};
	clap_output_events_t output{};
	EmptyEvents()
	{
		input.ctx = this;
		input.size = [](const clap_input_events_t *) -> uint32_t { return 0u; };
		input.get = [](const clap_input_events_t *, uint32_t) -> const clap_event_header_t * { return nullptr; };
		output.ctx = this;
		output.try_push = [](const clap_output_events_t *, const clap_event_header_t *) -> bool { return false; };
	}
};

std::unique_ptr<clap_host_t> makeHost(const std::shared_ptr<HostState> &state)
{
	state->self = state;
	return std::make_unique<clap_host_t>(clap_host_t{
		CLAP_VERSION,
		state.get(),
		"Soundscaper",
		"Soundscaper",
		"https://soundscaper.org",
		"29",
		hostExtension,
		requestRestart,
		requestProcess,
		requestCallback,
	});
}

struct LoadedClap {
	juce::DynamicLibrary library;
	const clap_plugin_entry_t *entry = nullptr;
	const clap_plugin_factory_t *factory = nullptr;
	std::string path;
	bool initialized = false;

	~LoadedClap() { if (initialized) entry->deinit(); }
};

std::unique_ptr<LoadedClap> load(const std::string &path)
{
	auto loaded = std::make_unique<LoadedClap>();
	loaded->path = path;
	if (!loaded->library.open(juce::String(path))) return nullptr;
	loaded->entry = reinterpret_cast<const clap_plugin_entry_t *>(loaded->library.getFunction("clap_entry"));
	if (loaded->entry == nullptr || !clap_version_is_compatible(loaded->entry->clap_version)) return nullptr;
	loaded->initialized = loaded->entry->init(path.c_str());
	if (!loaded->initialized) return nullptr;
	loaded->factory = static_cast<const clap_plugin_factory_t *>(
		loaded->entry->get_factory(CLAP_PLUGIN_FACTORY_ID));
	if (loaded->factory == nullptr) return nullptr;
	return loaded;
}

void text(char *destination, const char *value)
{
	const size_t length = value == nullptr ? 0u
		: std::min(std::strlen(value), static_cast<size_t>(SOUNDSCAPER_PRO_MAX_TEXT - 1u));
	if (length > 0u) std::memcpy(destination, value, length);
	destination[length] = '\0';
}

bool isInstrument(const clap_plugin_descriptor_t &descriptor)
{
	if (descriptor.features == nullptr) return false;
	for (const char *const *feature = descriptor.features; *feature != nullptr; ++feature) {
		if (std::strcmp(*feature, CLAP_PLUGIN_FEATURE_INSTRUMENT) == 0) return true;
	}
	return false;
}

struct AudioTopology {
	uint32_t inputChannels = 0u;
	uint32_t outputChannels = 0u;
};

bool mainPortChannels(
	const clap_plugin_t *plugin, const clap_plugin_audio_ports_t *audioPorts,
	bool input, uint32_t &channels)
{
	const uint32_t count = audioPorts->count(plugin, input);
	if (count > 32u) return false;
	uint32_t mainCount = 0u;
	uint32_t onlyChannels = 0u;
	uint32_t mainChannels = 0u;
	for (uint32_t index = 0u; index < count; ++index) {
		clap_audio_port_info_t info{};
		if (!audioPorts->get(plugin, index, input, &info) || info.channel_count > 64u) return false;
		onlyChannels = info.channel_count;
		if ((info.flags & CLAP_AUDIO_PORT_IS_MAIN) != 0u) {
			mainCount += 1u;
			mainChannels = info.channel_count;
		}
	}
	// Host contract v1 transports one main bus in each direction. A lone port
	// that omitted the advisory MAIN flag is still unambiguous; auxiliary and
	// side-chain buses are refused until their authored routing is explicit.
	if (mainCount > 1u || (mainCount == 0u && count > 1u)) return false;
	channels = mainCount == 1u ? mainChannels : (count == 1u ? onlyChannels : 0u);
	return true;
}

bool audioTopology(const clap_plugin_t *plugin, AudioTopology &topology)
{
	const auto *audioPorts = static_cast<const clap_plugin_audio_ports_t *>(
		plugin->get_extension(plugin, CLAP_EXT_AUDIO_PORTS));
	return audioPorts != nullptr
		&& mainPortChannels(plugin, audioPorts, true, topology.inputChannels)
		&& mainPortChannels(plugin, audioPorts, false, topology.outputChannels)
		&& topology.outputChannels > 0u;
}

struct StateWriter {
	std::vector<uint8_t> bytes;
	bool overflow = false;
	clap_ostream_t stream{};
	StateWriter()
	{
		stream.ctx = this;
		stream.write = [](const clap_ostream_t *stream, const void *buffer, uint64_t size) -> int64_t {
			auto &writer = *static_cast<StateWriter *>(stream->ctx);
			if (size > SOUNDSCAPER_PRO_MAX_STATE_BYTES - writer.bytes.size()) {
				writer.overflow = true;
				return -1;
			}
			const auto *begin = static_cast<const uint8_t *>(buffer);
			writer.bytes.insert(writer.bytes.end(), begin, begin + size);
			return static_cast<int64_t>(size);
		};
	}
};

struct StateReader {
	const uint8_t *bytes;
	size_t length;
	size_t offset = 0u;
	clap_istream_t stream{};
	StateReader(const uint8_t *source, size_t size) : bytes(source), length(size)
	{
		stream.ctx = this;
		stream.read = [](const clap_istream_t *stream, void *buffer, uint64_t size) -> int64_t {
			auto &reader = *static_cast<StateReader *>(stream->ctx);
			const size_t remaining = reader.length - reader.offset;
			const size_t count = std::min(static_cast<size_t>(size), remaining);
			if (count > 0u) std::memcpy(buffer, reader.bytes + reader.offset, count);
			reader.offset += count;
			return static_cast<int64_t>(count);
		};
	}
};

class Instance final : public DirectClapInstance {
public:
	Instance(std::unique_ptr<LoadedClap> module, const clap_plugin_t *opened,
		std::unique_ptr<clap_host_t> hostValue, std::shared_ptr<HostState> hostStateValue,
		uint32_t maximumFrames, AudioTopology topologyValue)
		: loaded(std::move(module)), plugin(opened), host(std::move(hostValue)), ceiling(maximumFrames),
		topology(topologyValue), hostState(std::move(hostStateValue))
	{
		latencyExtension = static_cast<const clap_plugin_latency_t *>(plugin->get_extension(plugin, CLAP_EXT_LATENCY));
		stateExtension = static_cast<const clap_plugin_state_t *>(plugin->get_extension(plugin, CLAP_EXT_STATE));
		guiExtension = static_cast<const clap_plugin_gui_t *>(plugin->get_extension(plugin, CLAP_EXT_GUI));
	}

	~Instance() override
	{
		closeVendorWindow();
		hostState->plugin.store(nullptr, std::memory_order_release);
		plugin->stop_processing(plugin);
		plugin->deactivate(plugin);
		plugin->destroy(plugin);
	}

	soundscaper_pro_status process(
		const float *const *inputs, uint32_t inputChannels, float **outputs,
		uint32_t outputChannels, uint32_t frames) override
	{
		if (frames == 0u || frames > ceiling || inputChannels != topology.inputChannels
			|| outputChannels != topology.outputChannels
			|| (inputChannels > 0u && inputs == nullptr) || outputs == nullptr) {
			return SOUNDSCAPER_PRO_FORMAT_REFUSED;
		}
		clap_audio_buffer_t inputBuffer{};
		clap_audio_buffer_t outputBuffer{};
		inputBuffer.data32 = const_cast<float **>(inputs);
		inputBuffer.channel_count = inputChannels;
		outputBuffer.data32 = outputs;
		outputBuffer.channel_count = outputChannels;
		clap_process_t request{};
		request.steady_time = -1;
		request.frames_count = frames;
		request.audio_inputs = inputChannels == 0u ? nullptr : &inputBuffer;
		request.audio_inputs_count = inputChannels == 0u ? 0u : 1u;
		request.audio_outputs = outputChannels == 0u ? nullptr : &outputBuffer;
		request.audio_outputs_count = outputChannels == 0u ? 0u : 1u;
		request.in_events = &events.input;
		request.out_events = &events.output;
		const clap_process_status status = plugin->process(plugin, &request);
		return status == CLAP_PROCESS_ERROR ? SOUNDSCAPER_PRO_PLUGIN_MALFORMED : SOUNDSCAPER_PRO_OK;
	}

	uint32_t latency() const override
	{
		return latencyExtension == nullptr ? 0u : latencyExtension->get(plugin);
	}

	soundscaper_pro_status saveState(uint8_t *bytes, size_t capacity, size_t &written) override
	{
		if (stateExtension == nullptr) return SOUNDSCAPER_PRO_UNSUPPORTED;
		StateWriter writer;
		if (!stateExtension->save(plugin, &writer.stream) || writer.overflow) return SOUNDSCAPER_PRO_STATE_TOO_LARGE;
		written = writer.bytes.size();
		if (written > capacity) return SOUNDSCAPER_PRO_STATE_TOO_LARGE;
		if (written > 0u && bytes == nullptr) return SOUNDSCAPER_PRO_STATE_REJECTED;
		std::memcpy(bytes, writer.bytes.data(), written);
		return SOUNDSCAPER_PRO_OK;
	}

	soundscaper_pro_status loadState(const uint8_t *bytes, size_t length) override
	{
		if (stateExtension == nullptr) return SOUNDSCAPER_PRO_UNSUPPORTED;
		if (length > SOUNDSCAPER_PRO_MAX_STATE_BYTES || (length > 0u && bytes == nullptr)) {
			return SOUNDSCAPER_PRO_STATE_TOO_LARGE;
		}
		StateReader reader(bytes, length);
		return stateExtension->load(plugin, &reader.stream)
			? SOUNDSCAPER_PRO_OK : SOUNDSCAPER_PRO_STATE_REJECTED;
	}

	soundscaper_pro_status openVendorWindow(const std::string &opaqueId) override
	{
		if (opaqueId.empty()) return SOUNDSCAPER_PRO_UNSUPPORTED;
		if (guiExtension == nullptr || guiOpen) return guiOpen ? SOUNDSCAPER_PRO_OK : SOUNDSCAPER_PRO_UNSUPPORTED;
#if defined(_WIN32)
		const char *api = CLAP_WINDOW_API_WIN32;
#elif defined(__APPLE__)
		const char *api = CLAP_WINDOW_API_COCOA;
#else
		const char *api = CLAP_WINDOW_API_X11;
#endif
		if (!guiExtension->is_api_supported(plugin, api, true)
			|| !guiExtension->create(plugin, api, true)
			|| !guiExtension->show(plugin)) return SOUNDSCAPER_PRO_UNSUPPORTED;
		guiOpen = true;
		return SOUNDSCAPER_PRO_OK;
	}

	void closeVendorWindow() override
	{
		if (!guiOpen || guiExtension == nullptr) return;
		guiExtension->hide(plugin);
		guiExtension->destroy(plugin);
		guiOpen = false;
	}

private:
	std::unique_ptr<LoadedClap> loaded;
	const clap_plugin_t *plugin;
	std::unique_ptr<clap_host_t> host;
	const uint32_t ceiling;
	const AudioTopology topology;
	std::shared_ptr<HostState> hostState;
	const clap_plugin_latency_t *latencyExtension = nullptr;
	const clap_plugin_state_t *stateExtension = nullptr;
	const clap_plugin_gui_t *guiExtension = nullptr;
	EmptyEvents events;
	bool guiOpen = false;
};

} // namespace

soundscaper_pro_status scanDirectClap(
	const std::string &path, std::vector<soundscaper_pro_plugin_description> &descriptions)
{
	auto loaded = load(path);
	if (loaded == nullptr) return SOUNDSCAPER_PRO_PLUGIN_UNREADABLE;
	const uint32_t count = loaded->factory->get_plugin_count(loaded->factory);
	if (count == 0u || count > SOUNDSCAPER_PRO_MAX_PLUGIN_DESCRIPTORS) return SOUNDSCAPER_PRO_PLUGIN_MALFORMED;
	std::set<std::string> stableIds;
	for (uint32_t index = 0u; index < count; ++index) {
		const auto *descriptor = loaded->factory->get_plugin_descriptor(loaded->factory, index);
		if (descriptor == nullptr || descriptor->id == nullptr || descriptor->id[0] == '\0'
			|| std::strlen(descriptor->id) >= SOUNDSCAPER_PRO_MAX_TEXT
			|| !stableIds.insert(descriptor->id).second) return SOUNDSCAPER_PRO_PLUGIN_MALFORMED;
		soundscaper_pro_plugin_description description{};
		description.status = SOUNDSCAPER_PRO_OK;
		std::strncpy(description.format, "clap", sizeof(description.format) - 1u);
		text(description.stable_id, descriptor->id);
		text(description.name, descriptor->name);
		text(description.vendor, descriptor->vendor);
		text(description.version, descriptor->version);
		description.is_instrument = isInstrument(*descriptor) ? 1u : 0u;
		auto hostState = std::make_shared<HostState>();
		auto host = makeHost(hostState);
		const clap_plugin_t *plugin = loaded->factory->create_plugin(loaded->factory, host.get(), descriptor->id);
		hostState->plugin.store(plugin, std::memory_order_release);
		const bool initialized = plugin != nullptr && plugin->init(plugin);
		AudioTopology topology;
		const bool topologyValid = initialized && audioTopology(plugin, topology);
		hostState->plugin.store(nullptr, std::memory_order_release);
		if (plugin != nullptr) plugin->destroy(plugin);
		if (!initialized) description.status = SOUNDSCAPER_PRO_PLUGIN_MALFORMED;
		else if (!topologyValid) description.status = SOUNDSCAPER_PRO_FORMAT_REFUSED;
		else {
			description.input_channels = topology.inputChannels;
			description.output_channels = topology.outputChannels;
		}
		descriptions.push_back(description);
	}
	std::sort(descriptions.begin(), descriptions.end(), [](const auto &left, const auto &right) {
		return std::strcmp(left.stable_id, right.stable_id) < 0;
	});
	return SOUNDSCAPER_PRO_OK;
}

soundscaper_pro_status openDirectClap(
	const std::string &path, const std::string &stableId, double sampleRate, uint32_t maximumFrames,
	std::unique_ptr<DirectClapInstance> &instance)
{
	auto loaded = load(path);
	if (loaded == nullptr) return SOUNDSCAPER_PRO_PLUGIN_UNREADABLE;
	const uint32_t count = loaded->factory->get_plugin_count(loaded->factory);
	if (count == 0u || count > SOUNDSCAPER_PRO_MAX_PLUGIN_DESCRIPTORS) return SOUNDSCAPER_PRO_PLUGIN_MALFORMED;
	const clap_plugin_descriptor_t *descriptor = nullptr;
	std::set<std::string> stableIds;
	for (uint32_t index = 0u; index < count; ++index) {
		const auto *candidate = loaded->factory->get_plugin_descriptor(loaded->factory, index);
		if (candidate == nullptr || candidate->id == nullptr || candidate->id[0] == '\0'
			|| std::strlen(candidate->id) >= SOUNDSCAPER_PRO_MAX_TEXT
			|| !stableIds.insert(candidate->id).second) return SOUNDSCAPER_PRO_PLUGIN_MALFORMED;
		if (stableId == candidate->id) descriptor = candidate;
	}
	if (descriptor == nullptr || isInstrument(*descriptor)) return SOUNDSCAPER_PRO_PLUGIN_MALFORMED;
	auto hostState = std::make_shared<HostState>();
	auto host = makeHost(hostState);
	const clap_plugin_t *plugin = loaded->factory->create_plugin(loaded->factory, host.get(), descriptor->id);
	hostState->plugin.store(plugin, std::memory_order_release);
	const bool initialized = plugin != nullptr && plugin->init(plugin);
	AudioTopology topology;
	const bool topologyValid = initialized && audioTopology(plugin, topology);
	const bool activated = topologyValid && plugin->activate(plugin, sampleRate, 1u, maximumFrames);
	const bool processing = activated && plugin->start_processing(plugin);
	if (!processing) {
		hostState->plugin.store(nullptr, std::memory_order_release);
		if (activated) plugin->deactivate(plugin);
		if (plugin != nullptr) plugin->destroy(plugin);
		return SOUNDSCAPER_PRO_PLUGIN_MALFORMED;
	}
	instance = std::make_unique<Instance>(
		std::move(loaded), plugin, std::move(host), std::move(hostState), maximumFrames, topology);
	return SOUNDSCAPER_PRO_OK;
}

} // namespace soundscaper
