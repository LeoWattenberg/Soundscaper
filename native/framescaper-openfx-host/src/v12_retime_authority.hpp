/* SPDX-License-Identifier: AGPL-3.0-only */

#pragma once

#include "strict_json.hpp"

namespace framescaper::openfx {

/** Recompute a Retimer SourceTime from one admitted V12 plan ordinal. */
[[nodiscard]] double verified_v12_retimer_source_time(
	const framescaper::media::json::value& plan,
	const framescaper::media::json::value& source_time
);

} // namespace framescaper::openfx
