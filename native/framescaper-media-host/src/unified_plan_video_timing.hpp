/* SPDX-License-Identifier: AGPL-3.0-only */

#pragma once

#include "unified_plan_common.hpp"
#include "video_timing_asset.hpp"

#include <charconv>
#include <cstdint>
#include <limits>
#include <string>

namespace framescaper::media::unified {

struct validated_video_timing_reference final {
	std::string sha256;
	std::int64_t frame_count{};
	std::int64_t byte_length{};
	std::int64_t timescale{};
	std::int64_t final_frame_duration_ticks{};
	const video_timing_asset_authority* asset{};
};

[[nodiscard]] inline std::int64_t positive_int64_decimal(
	const json::value& value,
	const std::string_view label
) {
	const auto text_value = json::string(value, label);
	std::int64_t result{};
	const auto parsed = std::from_chars(
		text_value.data(), text_value.data() + text_value.size(), result
	);
	if (text_value.empty() || text_value.front() == '0' || result <= 0
		|| parsed.ec != std::errc{} || parsed.ptr != text_value.data() + text_value.size()) {
		throw json::parse_error(std::string{label} + " is not a positive signed 64-bit decimal.");
	}
	return result;
}

[[nodiscard]] inline validated_video_timing_reference validate_video_timing_reference_summary(
	const json::value& value,
	const std::string& source_sha
) {
	exact(value, {
		"encoding", "storageKey", "sha256", "sourceSha256", "byteLength", "frameCount",
		"timescale", "finalFrameDurationTicks",
	});
	literal(json::member(value, "encoding"), "soundscaper-video-timing-v1", "timing encoding");
	const auto sha = digest(json::member(value, "sha256"), "timing digest");
	if (text(json::member(value, "storageKey"), "timing storage key") != "video-timing-sha256:" + sha
		|| digest(json::member(value, "sourceSha256"), "timing source digest") != source_sha) {
		throw json::parse_error("VFR timing does not bind its exact source and storage identities.");
	}
	const auto frames = safe_integer(json::member(value, "frameCount"), "timing frame count", 1);
	const auto byte_length = safe_integer(json::member(value, "byteLength"), "timing byte length", 1);
	const auto timescale = safe_integer(json::member(value, "timescale"), "timing timescale", 1);
	if (frames > video_timing_asset_maximum_frames
		|| byte_length != static_cast<std::int64_t>(video_timing_asset_header_bytes) + frames * 8
		|| timescale > std::numeric_limits<std::uint32_t>::max()) {
		throw json::parse_error("VFR timing summary exceeds or disagrees with its closed authority.");
	}
	const auto final_duration = positive_int64_decimal(
		json::member(value, "finalFrameDurationTicks"), "VFR final duration"
	);
	return {sha, frames, byte_length, timescale, final_duration, nullptr};
}

[[nodiscard]] inline validated_video_timing_reference validate_video_timing_reference(
	const json::value& value,
	const std::string& source_sha,
	video_timing_asset_registry& timing_assets
) {
	auto result = validate_video_timing_reference_summary(value, source_sha);
	result.asset = &timing_assets.require(
		result.sha256,
		static_cast<std::uintmax_t>(result.byte_length),
		static_cast<std::uint32_t>(result.frame_count),
		static_cast<std::uint32_t>(result.timescale),
		result.final_frame_duration_ticks
	);
	return result;
}

} // namespace framescaper::media::unified
