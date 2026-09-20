/* SPDX-License-Identifier: AGPL-3.0-only */

#ifndef SOUNDSCAPER_LADSPA_PLUGIN_METADATA_H
#define SOUNDSCAPER_LADSPA_PLUGIN_METADATA_H

#include "professional_host_api.h"

#include <cstdint>
#include <string>
#include <vector>

namespace soundscaper {

struct LadspaParameterHint {
	uint32_t port = 0u;
	uint32_t flags = 0u;
};

soundscaper_pro_status inspectLadspaParameters(
	const std::string &path, uint32_t descriptorIndex, std::vector<LadspaParameterHint> &hints);

} // namespace soundscaper

#endif
