/* SPDX-License-Identifier: AGPL-3.0-only */

#pragma once

#include "isolation_contract.hpp"
#include "parameter_values.hpp"

#include "../../framescaper-media-host/src/strict_json.hpp"

#include <cstddef>

namespace framescaper::openfx {

enum class ParameterWireOrigin { authored_interact, persisted_v12 };

/** Decode one parameter's OFX ABI once, retaining the grant-specific admission policy. */
[[nodiscard]] HydratedParameterState hydrate_parameter_wire_state(
	const framescaper::media::json::value& value,
	Context context,
	std::size_t& total_keys,
	ParameterWireOrigin origin
);

} // namespace framescaper::openfx
