/* SPDX-License-Identifier: AGPL-3.0-only */

#ifndef SOUNDSCAPER_JUCE_PLUGIN_ADAPTER_H
#define SOUNDSCAPER_JUCE_PLUGIN_ADAPTER_H

#include "professional_host_api.h"

#include <memory>
#include <string>
#include <vector>

namespace soundscaper {

class JucePluginInstance {
public:
	virtual ~JucePluginInstance() = default;
	virtual soundscaper_pro_status process(
		const float *const *inputs, uint32_t inputChannels, float **outputs,
		uint32_t outputChannels, uint32_t frames) = 0;
	virtual uint32_t latency() const = 0;
	virtual soundscaper_pro_status saveState(uint8_t *bytes, size_t capacity, size_t &written) = 0;
	virtual soundscaper_pro_status loadState(const uint8_t *bytes, size_t length) = 0;
	virtual soundscaper_pro_status openVendorWindow(const std::string &opaqueId) = 0;
	virtual void closeVendorWindow() = 0;
};

soundscaper_pro_status scanJucePlugin(
	const std::string &format, const std::string &path,
	std::vector<soundscaper_pro_plugin_description> &descriptions);
soundscaper_pro_status openJucePlugin(
	const std::string &format, const std::string &path, const std::string &stableId,
	double sampleRate, uint32_t maximumFrames,
	std::unique_ptr<JucePluginInstance> &instance);
soundscaper_pro_status processJucePlugin(
	JucePluginInstance &instance, const float *const *inputs, uint32_t inputChannels,
	float **outputs, uint32_t outputChannels, uint32_t frames);
uint32_t jucePluginLatency(JucePluginInstance &instance);
soundscaper_pro_status saveJucePluginState(
	JucePluginInstance &instance, uint8_t *bytes, size_t capacity, size_t &written);
soundscaper_pro_status loadJucePluginState(
	JucePluginInstance &instance, const uint8_t *bytes, size_t length);
soundscaper_pro_status openJuceVendorWindow(JucePluginInstance &instance, const std::string &opaqueId);
void closeJuceVendorWindow(JucePluginInstance &instance);

} // namespace soundscaper

#endif
