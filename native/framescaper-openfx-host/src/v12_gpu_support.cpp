/* SPDX-License-Identifier: AGPL-3.0-only */

#include "v12_gpu_support.hpp"

#include "v12_host_invocation.hpp"

#include <string>

namespace framescaper::openfx {

std::vector<Backend> authenticate_v12_gpu_support(
	const framescaper::media::json::value& value
) {
	namespace json = framescaper::media::json;
	const auto& supported = json::array(value, "supported OpenFX backends");
	if (supported.empty() || supported.size() > kRenderBackends.size()) {
		throw v12_invocation_error{"admission", "The supported OpenFX backend set is empty or oversized."};
	}
	std::vector<Backend> output; output.reserve(supported.size());
	std::size_t previous = 0;
	for (std::size_t index = 0; index < supported.size(); ++index) {
		const auto parsed = parse_backend(json::string(supported[index], "supported OpenFX backend"));
		if (!parsed.has_value()) throw v12_invocation_error{"admission", "A supported OpenFX backend is unknown."};
		const auto ordinal = static_cast<std::size_t>(*parsed);
		if ((index == 0 && *parsed != Backend::cpu) || (index != 0 && ordinal <= previous)) {
			throw v12_invocation_error{"admission", "Supported OpenFX backends must be uniquely canonically ordered with CPU first."};
		}
		previous = ordinal; output.push_back(*parsed);
	}
	return output;
}

} // namespace framescaper::openfx
