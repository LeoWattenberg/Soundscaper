/* SPDX-License-Identifier: AGPL-3.0-only */

#include "ladspa_host_state.h"

#include <algorithm>
#include <array>
#include <cmath>
#include <cstring>

namespace soundscaper {
namespace {

constexpr std::array<uint8_t, 8> stateMagic{ 'S', 'C', 'L', 'A', 'D', 'S', 'P', 1u };
constexpr size_t stateHeaderBytes = stateMagic.size() + sizeof(uint32_t);

void encode32(uint8_t *bytes, uint32_t value)
{
	for (uint32_t index = 0u; index < 4u; ++index) {
		bytes[index] = static_cast<uint8_t>(value >> (index * 8u));
	}
}

uint32_t decode32(const uint8_t *bytes)
{
	return static_cast<uint32_t>(bytes[0]) | static_cast<uint32_t>(bytes[1]) << 8u
		| static_cast<uint32_t>(bytes[2]) << 16u | static_cast<uint32_t>(bytes[3]) << 24u;
}

bool normalized(float value)
{
	return std::isfinite(value) && value >= 0.0F && value <= 1.0F;
}

} // namespace

soundscaper_pro_status saveLadspaHostState(
	const std::vector<float> &values, uint8_t *bytes, size_t capacity, size_t &written)
{
	if (values.size() > SOUNDSCAPER_PRO_MAX_PLUGIN_PARAMETERS
		|| !std::all_of(values.begin(), values.end(), normalized)) {
		written = 0u;
		return SOUNDSCAPER_PRO_STATE_REJECTED;
	}
	written = stateHeaderBytes + values.size() * sizeof(uint32_t);
	if (written > SOUNDSCAPER_PRO_MAX_STATE_BYTES || written > capacity) {
		return SOUNDSCAPER_PRO_STATE_TOO_LARGE;
	}
	if (bytes == nullptr) return SOUNDSCAPER_PRO_STATE_REJECTED;
	std::copy(stateMagic.begin(), stateMagic.end(), bytes);
	encode32(bytes + stateMagic.size(), static_cast<uint32_t>(values.size()));
	for (size_t index = 0u; index < values.size(); ++index) {
		uint32_t encoded = 0u;
		std::memcpy(&encoded, &values[index], sizeof(encoded));
		encode32(bytes + stateHeaderBytes + index * sizeof(uint32_t), encoded);
	}
	return SOUNDSCAPER_PRO_OK;
}

soundscaper_pro_status decodeLadspaHostState(
	const uint8_t *bytes, size_t length, size_t expectedValues, std::vector<float> &values)
{
	values.clear();
	if (bytes == nullptr || expectedValues > SOUNDSCAPER_PRO_MAX_PLUGIN_PARAMETERS
		|| length != stateHeaderBytes + expectedValues * sizeof(uint32_t)
		|| !std::equal(stateMagic.begin(), stateMagic.end(), bytes)
		|| decode32(bytes + stateMagic.size()) != expectedValues) {
		return SOUNDSCAPER_PRO_STATE_REJECTED;
	}
	std::vector<float> decoded(expectedValues);
	for (size_t index = 0u; index < decoded.size(); ++index) {
		const uint32_t encoded = decode32(bytes + stateHeaderBytes + index * sizeof(uint32_t));
		std::memcpy(&decoded[index], &encoded, sizeof(encoded));
		if (!normalized(decoded[index])) return SOUNDSCAPER_PRO_STATE_REJECTED;
	}
	values = std::move(decoded);
	return SOUNDSCAPER_PRO_OK;
}

} // namespace soundscaper
