/* SPDX-License-Identifier: AGPL-3.0-only */

#include "juce_plugin_adapter.h"

#include <juce_audio_processors/juce_audio_processors.h>
#include <juce_gui_extra/juce_gui_extra.h>

#include <algorithm>
#include <cctype>
#include <cstring>
#include <memory>
#include <set>

namespace soundscaper {
namespace {

std::string lower(std::string value)
{
	std::transform(value.begin(), value.end(), value.begin(),
		[](unsigned char character) { return static_cast<char>(std::tolower(character)); });
	return value;
}

bool formatMatches(const juce::AudioPluginFormat &candidate, const std::string &format)
{
	const std::string name = lower(candidate.getName().toStdString());
	if (format == "vst3") return name.find("vst3") != std::string::npos;
	if (format == "au") return name.find("audio unit") != std::string::npos;
	if (format == "lv2") return name.find("lv2") != std::string::npos;
	return false;
}

/**
 * JUCE 9 deleted `addDefaultFormats()`, and its replacements register every
 * format the framework can build. This host registers only the formats its own
 * target compiled in, so a build that was not configured for a format cannot
 * acquire the ability to load it: the set here and the JUCE_PLUGINHOST_* set in
 * CMakeLists are deliberately the same decision, expressed once per language.
 * CLAP is absent by design — it is hosted through the direct ABI adapter, never
 * through JUCE.
 */
void registerCompiledFormats(juce::AudioPluginFormatManager &manager)
{
#if JUCE_PLUGINHOST_VST3
	manager.addFormat(std::make_unique<juce::VST3PluginFormat>());
#endif
#if JUCE_PLUGINHOST_AU
	manager.addFormat(std::make_unique<juce::AudioUnitPluginFormat>());
#endif
#if JUCE_PLUGINHOST_LV2
	manager.addFormat(std::make_unique<juce::LV2PluginFormat>());
#endif
}

juce::AudioPluginFormat *selectedFormat(juce::AudioPluginFormatManager &manager, const std::string &format)
{
	for (int index = 0; index < manager.getNumFormats(); ++index) {
		auto *candidate = manager.getFormat(index);
		if (candidate != nullptr && formatMatches(*candidate, format)) return candidate;
	}
	return nullptr;
}

void text(char *destination, const juce::String &value)
{
	const std::string encoded = value.toStdString();
	const size_t length = std::min(encoded.size(), static_cast<size_t>(SOUNDSCAPER_PRO_MAX_TEXT - 1u));
	std::memcpy(destination, encoded.data(), length);
	destination[length] = '\0';
}

void describe(const std::string &format, const juce::PluginDescription &source,
	soundscaper_pro_plugin_description &destination)
{
	destination = {};
	destination.status = SOUNDSCAPER_PRO_OK;
	std::strncpy(destination.format, format.c_str(), sizeof(destination.format) - 1u);
	text(destination.stable_id, source.createIdentifierString());
	text(destination.name, source.name);
	text(destination.vendor, source.manufacturerName);
	text(destination.version, source.version);
	destination.input_channels = static_cast<uint32_t>(std::max(0, source.numInputChannels));
	destination.output_channels = static_cast<uint32_t>(std::max(0, source.numOutputChannels));
	destination.is_instrument = source.isInstrument ? 1u : 0u;
}

std::unique_ptr<juce::AudioPluginInstance> instantiate(
	juce::AudioPluginFormatManager &manager, const std::string &format, const std::string &path,
	const std::string &stableId, double sampleRate, uint32_t maximumFrames, juce::String &error)
{
	auto *adapter = selectedFormat(manager, format);
	if (adapter == nullptr) {
		error = "That plug-in format is not compiled into this target.";
		return nullptr;
	}
	juce::OwnedArray<juce::PluginDescription> descriptions;
	adapter->findAllTypesForFile(descriptions, juce::String(path));
	juce::PluginDescription *selected = nullptr;
	for (auto *description : descriptions) {
		if (description->createIdentifierString().toStdString() != stableId) continue;
		if (selected != nullptr) { error = "The stable descriptor ID is ambiguous."; return nullptr; }
		selected = description;
	}
	if (selected == nullptr) { error = "The selected descriptor is no longer present."; return nullptr; }
	if (selected->isInstrument) {
		error = "Instrument plug-ins are recorded but never hosted as effects.";
		return nullptr;
	}
	return manager.createPluginInstance(*selected, sampleRate,
		static_cast<int>(maximumFrames), error);
}

class VendorWindow final : public juce::DocumentWindow {
public:
	VendorWindow(const juce::String &title, juce::AudioProcessorEditor &editor)
		: juce::DocumentWindow(title, juce::Colours::black,
			juce::DocumentWindow::closeButton, false)
	{
		setUsingNativeTitleBar(true);
		setContentOwned(&editor, true);
		setResizable(editor.isResizable(), false);
		centreWithSize(editor.getWidth(), editor.getHeight());
		setVisible(true);
		toFront(true);
	}

	void closeButtonPressed() override { setVisible(false); }
};

class Instance final : public JucePluginInstance {
public:
	Instance(std::unique_ptr<juce::AudioPluginInstance> opened, uint32_t maximumFrames)
		: plugin(std::move(opened)), ceiling(maximumFrames)
	{
		const int channels = std::max(plugin->getTotalNumInputChannels(), plugin->getTotalNumOutputChannels());
		buffer.setSize(std::max(1, channels), static_cast<int>(maximumFrames), false, true, false);
		plugin->prepareToPlay(plugin->getSampleRate(), static_cast<int>(maximumFrames));
	}

	~Instance() override
	{
		closeVendorWindow();
		plugin->releaseResources();
	}

	soundscaper_pro_status process(
		const float *const *inputs, uint32_t inputChannels, float **outputs,
		uint32_t outputChannels, uint32_t frames) override
	{
		if (frames == 0u || frames > ceiling
			|| inputChannels != static_cast<uint32_t>(plugin->getTotalNumInputChannels())
			|| outputChannels != static_cast<uint32_t>(plugin->getTotalNumOutputChannels())) {
			return SOUNDSCAPER_PRO_FORMAT_REFUSED;
		}
		buffer.clear();
		for (uint32_t channel = 0; channel < inputChannels; ++channel) {
			if (inputs == nullptr || inputs[channel] == nullptr) return SOUNDSCAPER_PRO_FORMAT_REFUSED;
			buffer.copyFrom(static_cast<int>(channel), 0, inputs[channel], static_cast<int>(frames));
		}
		juce::ScopedNoDenormals noDenormals;
		plugin->processBlock(buffer, midi);
		for (uint32_t channel = 0; channel < outputChannels; ++channel) {
			if (outputs == nullptr || outputs[channel] == nullptr) return SOUNDSCAPER_PRO_FORMAT_REFUSED;
			std::memcpy(outputs[channel], buffer.getReadPointer(static_cast<int>(channel)),
				static_cast<size_t>(frames) * sizeof(float));
		}
		return SOUNDSCAPER_PRO_OK;
	}

	uint32_t latency() const override
	{
		return static_cast<uint32_t>(std::max(0, plugin->getLatencySamples()));
	}

	soundscaper_pro_status saveState(uint8_t *bytes, size_t capacity, size_t &written) override
	{
		juce::MemoryBlock state;
		plugin->getStateInformation(state);
		written = state.getSize();
		if (written > SOUNDSCAPER_PRO_MAX_STATE_BYTES || written > capacity) {
			return SOUNDSCAPER_PRO_STATE_TOO_LARGE;
		}
		if (written > 0u && bytes == nullptr) return SOUNDSCAPER_PRO_STATE_REJECTED;
		std::memcpy(bytes, state.getData(), written);
		return SOUNDSCAPER_PRO_OK;
	}

	soundscaper_pro_status loadState(const uint8_t *bytes, size_t length) override
	{
		if (length > SOUNDSCAPER_PRO_MAX_STATE_BYTES || (length > 0u && bytes == nullptr)) {
			return SOUNDSCAPER_PRO_STATE_TOO_LARGE;
		}
		plugin->setStateInformation(bytes, static_cast<int>(length));
		return SOUNDSCAPER_PRO_OK;
	}

	soundscaper_pro_status openVendorWindow(const std::string &opaqueId) override
	{
		if (!juce::MessageManager::getInstance()->isThisTheMessageThread()) return SOUNDSCAPER_PRO_UNSUPPORTED;
		if (window != nullptr) {
			if (vendorWindowId != opaqueId) return SOUNDSCAPER_PRO_MODE_REFUSED;
			window->setVisible(true);
			window->toFront(true);
			return SOUNDSCAPER_PRO_OK;
		}
		auto *editor = plugin->createEditorIfNeeded();
		if (editor == nullptr) return SOUNDSCAPER_PRO_UNSUPPORTED;
		window = std::make_unique<VendorWindow>(plugin->getName(), *editor);
		vendorWindowId = opaqueId;
		return SOUNDSCAPER_PRO_OK;
	}

	void closeVendorWindow() override
	{
		if (window != nullptr) {
			window->setVisible(false);
			window.reset();
			vendorWindowId.clear();
		}
	}

private:
	std::unique_ptr<juce::AudioPluginInstance> plugin;
	const uint32_t ceiling;
	juce::AudioBuffer<float> buffer;
	juce::MidiBuffer midi;
	std::unique_ptr<VendorWindow> window;
	std::string vendorWindowId;
};

} // namespace

soundscaper_pro_status scanJucePlugin(
	const std::string &format, const std::string &path,
	std::vector<soundscaper_pro_plugin_description> &output)
{
	juce::AudioPluginFormatManager manager;
	registerCompiledFormats(manager);
	auto *adapter = selectedFormat(manager, format);
	if (adapter == nullptr) return SOUNDSCAPER_PRO_UNSUPPORTED;
	juce::OwnedArray<juce::PluginDescription> descriptions;
	adapter->findAllTypesForFile(descriptions, juce::String(path));
	if (descriptions.isEmpty() || descriptions.size() > static_cast<int>(SOUNDSCAPER_PRO_MAX_PLUGIN_DESCRIPTORS)) {
		return SOUNDSCAPER_PRO_PLUGIN_MALFORMED;
	}
	std::set<std::string> stableIds;
	for (const auto *source : descriptions) {
		const std::string stableId = source->createIdentifierString().toStdString();
		if (stableId.empty() || stableId.size() >= SOUNDSCAPER_PRO_MAX_TEXT
			|| !stableIds.insert(stableId).second) return SOUNDSCAPER_PRO_PLUGIN_MALFORMED;
		soundscaper_pro_plugin_description destination{};
		describe(format, *source, destination);
		output.push_back(destination);
	}
	std::sort(output.begin(), output.end(), [](const auto &left, const auto &right) {
		return std::strcmp(left.stable_id, right.stable_id) < 0;
	});
	return SOUNDSCAPER_PRO_OK;
}

soundscaper_pro_status openJucePlugin(
	const std::string &format, const std::string &path, const std::string &stableId,
	double sampleRate, uint32_t maximumFrames,
	std::unique_ptr<JucePluginInstance> &instance)
{
	juce::AudioPluginFormatManager manager;
	registerCompiledFormats(manager);
	juce::String error;
	auto plugin = instantiate(manager, format, path, stableId, sampleRate, maximumFrames, error);
	if (plugin == nullptr) return error.containsIgnoreCase("format")
		? SOUNDSCAPER_PRO_UNSUPPORTED : SOUNDSCAPER_PRO_PLUGIN_MALFORMED;
	plugin->setRateAndBufferSizeDetails(sampleRate, static_cast<int>(maximumFrames));
	instance = std::make_unique<Instance>(std::move(plugin), maximumFrames);
	return SOUNDSCAPER_PRO_OK;
}

soundscaper_pro_status processJucePlugin(
	JucePluginInstance &instance, const float *const *inputs, uint32_t inputChannels,
	float **outputs, uint32_t outputChannels, uint32_t frames)
{
	return instance.process(inputs, inputChannels, outputs, outputChannels, frames);
}

uint32_t jucePluginLatency(JucePluginInstance &instance) { return instance.latency(); }

soundscaper_pro_status saveJucePluginState(
	JucePluginInstance &instance, uint8_t *bytes, size_t capacity, size_t &written)
{
	return instance.saveState(bytes, capacity, written);
}

soundscaper_pro_status loadJucePluginState(JucePluginInstance &instance, const uint8_t *bytes, size_t length)
{
	return instance.loadState(bytes, length);
}

soundscaper_pro_status openJuceVendorWindow(JucePluginInstance &instance, const std::string &opaqueId)
{
	return instance.openVendorWindow(opaqueId);
}

void closeJuceVendorWindow(JucePluginInstance &instance) { instance.closeVendorWindow(); }

} // namespace soundscaper
