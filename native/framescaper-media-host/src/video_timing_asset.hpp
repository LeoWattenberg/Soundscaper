/* SPDX-License-Identifier: AGPL-3.0-only */

#pragma once

#include "media_file_grants.hpp"
#include "sha256.hpp"

#include <cstdint>
#include <filesystem>
#include <fstream>
#include <limits>
#include <map>
#include <set>
#include <string>
#include <string_view>
#include <vector>

namespace framescaper::media {

constexpr std::uintmax_t video_timing_asset_header_bytes = 32;
constexpr std::uint32_t video_timing_asset_maximum_frames = 2'000'000;
constexpr std::size_t video_timing_asset_maximum_grants = 4'096;
constexpr std::uintmax_t video_timing_asset_maximum_bytes =
	video_timing_asset_header_bytes + static_cast<std::uintmax_t>(video_timing_asset_maximum_frames) * 8;

struct video_timing_asset_grant final {
	std::filesystem::path path;
	std::string sha256;
};

struct video_timing_asset_authority final {
	std::string sha256;
	std::uintmax_t byte_length{};
	std::uint32_t frame_count{};
	std::uint32_t timescale{};
	std::int64_t final_frame_duration_ticks{};
	std::int64_t end_ticks{};
	std::vector<std::int64_t> presentation_ticks;

	[[nodiscard]] std::int64_t boundary_ticks(const std::int64_t frame) const {
		if (frame < 0 || frame > static_cast<std::int64_t>(frame_count)) {
			throw authentication_error("A VFR source boundary escapes its authenticated timing asset.");
		}
		return frame == static_cast<std::int64_t>(frame_count)
			? end_ticks : presentation_ticks[static_cast<std::size_t>(frame)];
	}
};

namespace video_timing_detail {

[[nodiscard]] inline std::uint16_t unsigned_16_le(
	const std::vector<std::uint8_t>& bytes,
	const std::size_t offset
) {
	return static_cast<std::uint16_t>(bytes[offset])
		| static_cast<std::uint16_t>(static_cast<std::uint16_t>(bytes[offset + 1]) << 8U);
}

[[nodiscard]] inline std::uint32_t unsigned_32_le(
	const std::vector<std::uint8_t>& bytes,
	const std::size_t offset
) {
	std::uint32_t result{};
	for (std::size_t index = 0; index < 4; ++index) {
		result |= static_cast<std::uint32_t>(bytes[offset + index]) << (index * 8U);
	}
	return result;
}

[[nodiscard]] inline std::uint64_t unsigned_64_le(
	const std::vector<std::uint8_t>& bytes,
	const std::size_t offset
) {
	std::uint64_t result{};
	for (std::size_t index = 0; index < 8; ++index) {
		result |= static_cast<std::uint64_t>(bytes[offset + index]) << (index * 8U);
	}
	return result;
}

[[nodiscard]] inline std::int64_t signed_64_le(
	const std::vector<std::uint8_t>& bytes,
	const std::size_t offset
) {
	const auto value = unsigned_64_le(bytes, offset);
	if (value <= static_cast<std::uint64_t>(std::numeric_limits<std::int64_t>::max())) {
		return static_cast<std::int64_t>(value);
	}
	return -1 - static_cast<std::int64_t>(~value);
}

[[nodiscard]] inline std::vector<std::uint8_t> authenticated_bytes(
	const video_timing_asset_grant& grant
) {
	const auto canonical = authenticate_regular_file(
		grant.path, grant.sha256, "VFR timing asset", video_timing_asset_maximum_bytes
	);
	std::error_code error;
	const auto length = std::filesystem::file_size(canonical, error);
	if (error || length > video_timing_asset_maximum_bytes) {
		throw grant_error("The VFR timing asset length could not be authenticated.");
	}
	std::vector<std::uint8_t> bytes(static_cast<std::size_t>(length));
	std::ifstream input(canonical, std::ios::binary);
	if (!bytes.empty()) {
		input.read(reinterpret_cast<char*>(bytes.data()), static_cast<std::streamsize>(bytes.size()));
	}
	if (!input || input.peek() != std::ifstream::traits_type::eof()
		|| sha256_bytes(bytes.data(), bytes.size()) != grant.sha256) {
		throw authentication_error("The VFR timing asset bytes changed after authentication.");
	}
	return bytes;
}

[[nodiscard]] inline video_timing_asset_authority decode(
	const std::string& sha256,
	const std::vector<std::uint8_t>& bytes
) {
	if (bytes.size() < video_timing_asset_header_bytes
		|| bytes[0] != 0x53 || bytes[1] != 0x43 || bytes[2] != 0x54 || bytes[3] != 0x49) {
		throw authentication_error("The VFR timing asset magic or header is invalid.");
	}
	if (unsigned_16_le(bytes, 4) != 1) {
		throw authentication_error("The VFR timing asset version is unsupported.");
	}
	if (unsigned_16_le(bytes, 6) != video_timing_asset_header_bytes) {
		throw authentication_error("The VFR timing asset header length is invalid.");
	}
	const auto timescale = unsigned_32_le(bytes, 8);
	const auto frame_count = unsigned_32_le(bytes, 12);
	const auto final_duration = signed_64_le(bytes, 16);
	if (unsigned_64_le(bytes, 24) != 0) {
		throw authentication_error("The VFR timing asset reserved header bytes are not zero.");
	}
	if (timescale == 0 || frame_count == 0 || frame_count > video_timing_asset_maximum_frames
		|| bytes.size() != video_timing_asset_header_bytes + static_cast<std::size_t>(frame_count) * 8) {
		throw authentication_error("The VFR timing asset dimensions exceed their closed authority.");
	}
	if (final_duration <= 0) {
		throw authentication_error("The VFR final frame duration is not positive.");
	}
	video_timing_asset_authority result{
		sha256, bytes.size(), frame_count, timescale, final_duration, 0, {},
	};
	result.presentation_ticks.reserve(frame_count);
	for (std::size_t index = 0; index < frame_count; ++index) {
		const auto tick = signed_64_le(bytes, video_timing_asset_header_bytes + index * 8);
		if (tick < 0 || (index == 0 && tick != 0)
			|| (index > 0 && tick <= result.presentation_ticks.back())) {
			throw authentication_error("VFR presentation ticks are not canonical strict nonnegative order.");
		}
		result.presentation_ticks.push_back(tick);
	}
	const auto last = result.presentation_ticks.back();
	if (last > std::numeric_limits<std::int64_t>::max() - final_duration) {
		throw authentication_error("The VFR timing end exceeds signed 64-bit authority.");
	}
	result.end_ticks = last + final_duration;
	return result;
}

} // namespace video_timing_detail

class video_timing_asset_registry final {
public:
	explicit video_timing_asset_registry(const std::vector<video_timing_asset_grant>& grants) {
		if (grants.size() > video_timing_asset_maximum_grants) {
			throw authentication_error("The VFR timing asset grant count exceeds 4,096.");
		}
		for (const auto& grant : grants) {
			if (!assets_.emplace(grant.sha256, video_timing_asset_authority{}).second) {
				throw authentication_error("A VFR timing asset grant digest is duplicated.");
			}
			auto bytes = video_timing_detail::authenticated_bytes(grant);
			assets_.at(grant.sha256) = video_timing_detail::decode(grant.sha256, bytes);
		}
	}

	[[nodiscard]] const video_timing_asset_authority& require(
		const std::string& sha256,
		const std::uintmax_t byte_length,
		const std::uint32_t frame_count,
		const std::uint32_t timescale,
		const std::int64_t final_frame_duration_ticks
	) {
		const auto found = assets_.find(sha256);
		if (found == assets_.end()) {
			throw authentication_error(
				"Unified VFR retime admission requires verified timing asset bytes."
			);
		}
		const auto& asset = found->second;
		if (asset.byte_length != byte_length || asset.frame_count != frame_count
			|| asset.timescale != timescale
			|| asset.final_frame_duration_ticks != final_frame_duration_ticks) {
			throw authentication_error("The VFR timing asset bytes disagree with their persisted summary.");
		}
		used_.insert(sha256);
		return asset;
	}

	void require_all_used() const {
		if (used_.size() != assets_.size()) {
			throw authentication_error("A VFR timing asset grant is not owned by the authenticated plan.");
		}
	}

private:
	std::map<std::string, video_timing_asset_authority> assets_;
	std::set<std::string> used_;
};

} // namespace framescaper::media
