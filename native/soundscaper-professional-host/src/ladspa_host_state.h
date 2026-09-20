/* SPDX-License-Identifier: AGPL-3.0-only */

#ifndef SOUNDSCAPER_LADSPA_HOST_STATE_H
#define SOUNDSCAPER_LADSPA_HOST_STATE_H

#include "professional_host_api.h"

#include <cstddef>
#include <cstdint>
#include <vector>

namespace soundscaper {

soundscaper_pro_status saveLadspaHostState(
	const std::vector<float> &values, uint8_t *bytes, size_t capacity, size_t &written);
soundscaper_pro_status decodeLadspaHostState(
	const uint8_t *bytes, size_t length, size_t expectedValues, std::vector<float> &values);

} // namespace soundscaper

#endif
