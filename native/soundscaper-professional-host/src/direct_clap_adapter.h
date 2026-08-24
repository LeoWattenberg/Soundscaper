/* SPDX-License-Identifier: AGPL-3.0-only */

#ifndef SOUNDSCAPER_DIRECT_CLAP_ADAPTER_H
#define SOUNDSCAPER_DIRECT_CLAP_ADAPTER_H

#include "professional_host_api.h"

#include <memory>
#include <string>
#include <vector>

namespace soundscaper {

class DirectClapInstance {
public:
	virtual ~DirectClapInstance() = default;
	virtual soundscaper_pro_status process(
		const float *const *inputs, uint32_t inputChannels, float **outputs,
		uint32_t outputChannels, uint32_t frames) = 0;
	virtual uint32_t latency() const = 0;
	virtual soundscaper_pro_status saveState(uint8_t *bytes, size_t capacity, size_t &written) = 0;
	virtual soundscaper_pro_status loadState(const uint8_t *bytes, size_t length) = 0;
	virtual soundscaper_pro_status openVendorWindow(const std::string &opaqueId) = 0;
	virtual void closeVendorWindow() = 0;
};

soundscaper_pro_status scanDirectClap(
	const std::string &path, std::vector<soundscaper_pro_plugin_description> &descriptions);
soundscaper_pro_status openDirectClap(
	const std::string &path, const std::string &stableId, double sampleRate, uint32_t maximumFrames,
	std::unique_ptr<DirectClapInstance> &instance);

} // namespace soundscaper

#endif
