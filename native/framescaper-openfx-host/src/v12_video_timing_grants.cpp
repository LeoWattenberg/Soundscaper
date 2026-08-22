/* SPDX-License-Identifier: AGPL-3.0-only */

#include "v12_video_timing_grants.hpp"

#include <algorithm>
#include <cctype>
#include <cstdint>
#include <limits>
#include <stdexcept>
#include <string>
#include <string_view>

namespace framescaper::openfx {
namespace {

namespace json = framescaper::media::json;

[[nodiscard]] bool valid_digest(const std::string_view value) {
	return value.size() == 64 && std::all_of(value.begin(), value.end(), [](const unsigned char byte) {
		return std::isdigit(byte) != 0 || (byte >= 'a' && byte <= 'f');
	});
}

[[nodiscard]] std::filesystem::path absolute_path(const json::value& value) {
	const std::filesystem::path path{json::string(value, "timing path")};
	if (!path.is_absolute() || path != path.lexically_normal()) {
		throw std::runtime_error("An OpenFX V12 timing path is not exact normalized absolute authority.");
	}
	return path;
}

[[nodiscard]] std::uintmax_t byte_length(const json::value& value) {
	const auto result = json::integer(value, "timing byte length");
	if (result < 1 || static_cast<std::uint64_t>(result)
		> framescaper::media::video_timing_asset_maximum_bytes) {
		throw std::runtime_error("An OpenFX V12 timing length exceeds the SCTI bound.");
	}
	return static_cast<std::uintmax_t>(result);
}

} // namespace

V12VideoTimingGrants parse_v12_video_timing_grants(
	const json::value* value,
	const std::filesystem::path& reservation,
	const std::set<std::filesystem::path>& forbidden_paths
) {
	V12VideoTimingGrants result;
	if (value == nullptr) return result;
	const auto& rows = json::array(*value, "video timing asset grants");
	if (rows.empty() || rows.size() > framescaper::media::video_timing_asset_maximum_grants) {
		throw std::runtime_error("An OpenFX V12 timing authority requires 1 through 4,096 grants.");
	}
	std::set<std::string> digests;
	for (const auto& row : rows) {
		json::require_exact_keys(row, {"path", "byteLength", "sha256"});
		const auto path = absolute_path(json::member(row, "path"));
		const auto digest = std::string{json::string(json::member(row, "sha256"), "timing digest")};
		if (path.parent_path() != reservation || forbidden_paths.contains(path)) {
			throw std::runtime_error("An OpenFX V12 timing grant escaped or aliases its reservation.");
		}
		if (!valid_digest(digest) || !result.paths.insert(path).second || !digests.insert(digest).second) {
			throw std::runtime_error("An OpenFX V12 timing grant replays a path or digest.");
		}
		result.grants.push_back({path, digest, byte_length(json::member(row, "byteLength"))});
	}
	return result;
}

} // namespace framescaper::openfx
