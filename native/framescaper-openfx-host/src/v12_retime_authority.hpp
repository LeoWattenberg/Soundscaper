/* SPDX-License-Identifier: AGPL-3.0-only */

#pragma once

#include "strict_json.hpp"
#include "video_timing_asset.hpp"

#include <vector>

namespace framescaper::openfx {

/** Recompute a Retimer SourceTime from one admitted V12 plan ordinal. */
[[nodiscard]] double verified_v12_retimer_source_time(
	const framescaper::media::json::value& plan,
	const framescaper::media::json::value& source_time,
	const std::vector<framescaper::media::video_timing_asset_grant>& timing_grants
);

} // namespace framescaper::openfx
