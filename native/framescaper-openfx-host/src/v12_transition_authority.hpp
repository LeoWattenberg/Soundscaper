/* SPDX-License-Identifier: AGPL-3.0-only */

#pragma once

#include "strict_json.hpp"

#include <cstdint>
#include <string_view>

namespace framescaper::openfx {

/** Derive the standard Transition value from one authenticated V12 plan ordinal. */
[[nodiscard]] double verified_v12_transition_value(
	const framescaper::media::json::value& plan,
	std::string_view transition_id,
	std::uint64_t output_ordinal
);

} // namespace framescaper::openfx
