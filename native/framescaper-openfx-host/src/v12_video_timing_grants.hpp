/* SPDX-License-Identifier: AGPL-3.0-only */

#pragma once

#include "strict_json.hpp"
#include "video_timing_asset.hpp"

#include <filesystem>
#include <set>
#include <vector>

namespace framescaper::openfx {

struct V12VideoTimingGrants final {
	std::vector<framescaper::media::video_timing_asset_grant> grants;
	std::set<std::filesystem::path> paths;
};

/** Parse exact reservation-local SCTI grants carried outside the canonical plan. */
[[nodiscard]] V12VideoTimingGrants parse_v12_video_timing_grants(
	const framescaper::media::json::value* value,
	const std::filesystem::path& reservation,
	const std::set<std::filesystem::path>& forbidden_paths
);

} // namespace framescaper::openfx
