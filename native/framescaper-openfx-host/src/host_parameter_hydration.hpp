/* SPDX-License-Identifier: AGPL-3.0-only */

#pragma once

#include "parameter_values.hpp"

#include <cstddef>
#include <vector>

namespace framescaper::openfx {

/** Validate the whole plug-in definition match before changing any instance value. */
template <typename ParameterSet>
bool hydrate_parameter_state(
	ParameterSet& target,
	const std::vector<HydratedParameterState>& values,
	std::size_t& parameter_count,
	std::size_t& keyframe_count
) {
	for (const auto& value : values) {
		const auto found = target.parameters.find(value.name);
		if (found == target.parameters.end() || found->second->type != value.ofx_type) return false;
		if (value.keyframe_count > 0) {
			const auto property = found->second->properties.values.find(kOfxParamPropAnimates);
			if (property == found->second->properties.values.end() || property->second.size() != 1) return false;
			const auto* animates = std::get_if<int>(&property->second.front());
			if (animates == nullptr || *animates != 1) return false;
		}
	}
	for (const auto& value : values) {
		target.parameters.at(value.name)->values = value.values;
		++parameter_count;
		keyframe_count += value.keyframe_count;
	}
	return true;
}

} // namespace framescaper::openfx
