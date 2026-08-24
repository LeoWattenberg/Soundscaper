/* SPDX-License-Identifier: AGPL-3.0-only */

#include "v12_gpu_qualification.hpp"

#include "v12_host_invocation.hpp"

#include <string>

namespace framescaper::openfx {

std::vector<Backend> authenticate_v12_gpu_qualification(
	const framescaper::media::json::value& value
) {
	namespace json = framescaper::media::json;
	const auto& qualified = json::array(value, "qualified OpenFX backends");
	if (qualified.empty() || qualified.size() > kRenderBackends.size()) {
		throw v12_invocation_error{"admission", "The qualified OpenFX backend set is empty or oversized."};
	}
	std::vector<Backend> output; output.reserve(qualified.size());
	std::size_t previous = 0;
	for (std::size_t index = 0; index < qualified.size(); ++index) {
		const auto parsed = parse_backend(json::string(qualified[index], "qualified OpenFX backend"));
		if (!parsed.has_value()) throw v12_invocation_error{"admission", "A qualified OpenFX backend is unknown."};
		const auto ordinal = static_cast<std::size_t>(*parsed);
		if ((index == 0 && *parsed != Backend::cpu) || (index != 0 && ordinal <= previous)) {
			throw v12_invocation_error{"admission", "Qualified OpenFX backends must be uniquely canonically ordered with CPU first."};
		}
		previous = ordinal; output.push_back(*parsed);
	}
	return output;
}

} // namespace framescaper::openfx
