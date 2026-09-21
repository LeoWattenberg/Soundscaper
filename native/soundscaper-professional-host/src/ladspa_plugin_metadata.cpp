/* SPDX-License-Identifier: AGPL-3.0-only */

#include "ladspa_plugin_metadata.h"

#include <ladspa.h>

#include <dlfcn.h>

#include <memory>

namespace soundscaper {

soundscaper_pro_status inspectLadspaParameters(
	const std::string &path, uint32_t descriptorIndex, std::vector<LadspaParameterHint> &hints)
{
	hints.clear();
	using Library = std::unique_ptr<void, int (*)(void *)>;
	Library library(dlopen(path.c_str(), RTLD_NOW | RTLD_LOCAL), dlclose);
	if (library == nullptr) return SOUNDSCAPER_PRO_PLUGIN_UNREADABLE;
	using DescriptorFunction = const LADSPA_Descriptor *(*)(unsigned long);
	auto descriptorFunction = reinterpret_cast<DescriptorFunction>(dlsym(library.get(), "ladspa_descriptor"));
	if (descriptorFunction == nullptr) return SOUNDSCAPER_PRO_PLUGIN_MALFORMED;
	const LADSPA_Descriptor *descriptor = descriptorFunction(descriptorIndex);
	if (descriptor == nullptr || descriptor->PortCount > SOUNDSCAPER_PRO_MAX_CHANNELS
		|| descriptor->PortDescriptors == nullptr || descriptor->PortRangeHints == nullptr) {
		return SOUNDSCAPER_PRO_PLUGIN_MALFORMED;
	}
	for (uint32_t port = 0u; port < descriptor->PortCount; ++port) {
		const auto portDescriptor = descriptor->PortDescriptors[port];
		if (!LADSPA_IS_PORT_CONTROL(portDescriptor) || !LADSPA_IS_PORT_INPUT(portDescriptor)) continue;
		const auto range = descriptor->PortRangeHints[port].HintDescriptor;
		uint32_t flags = SOUNDSCAPER_PRO_PARAMETER_AUTOMATABLE;
		if (LADSPA_IS_HINT_TOGGLED(range)) flags |= SOUNDSCAPER_PRO_PARAMETER_BOOLEAN;
		if (LADSPA_IS_HINT_INTEGER(range)) flags |= SOUNDSCAPER_PRO_PARAMETER_INTEGER;
		if (LADSPA_IS_HINT_LOGARITHMIC(range)) flags |= SOUNDSCAPER_PRO_PARAMETER_LOGARITHMIC;
		hints.push_back({ port, flags });
		if (hints.size() > SOUNDSCAPER_PRO_MAX_PLUGIN_PARAMETERS) {
			return SOUNDSCAPER_PRO_PLUGIN_MALFORMED;
		}
	}
	return SOUNDSCAPER_PRO_OK;
}

} // namespace soundscaper
