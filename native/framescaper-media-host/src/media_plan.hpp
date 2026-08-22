/* SPDX-License-Identifier: AGPL-3.0-only */

#pragma once

#include <cstdint>
#include <filesystem>
#include <string>
#include <vector>

namespace framescaper::media {

struct admitted_media_plan final {
	int version{};
	std::string strategy;
	std::string container;
	std::string video_codec;
	std::string video_encoder;
	std::string pixel_format;
	std::vector<std::string> source_sha256;
	std::uint32_t width{};
	std::uint32_t height{};
	std::uint64_t output_frame_count{};
	std::uint32_t frame_rate_num{};
	std::uint32_t frame_rate_den{};
	std::uint64_t source_in_frame{};
	std::uint64_t source_frame_count{};
	bool includes_audio{};
	bool simple_full_frame_clip{};
	std::vector<std::string> image_sequence_inventory_sha256;
	std::vector<std::uint64_t> image_sequence_frame_count;
	std::vector<std::uint32_t> image_sequence_frame_rate_num;
	std::vector<std::uint32_t> image_sequence_frame_rate_den;
	std::string unsupported_render_family;
	std::string authenticated_plan_json;
};

[[nodiscard]] admitted_media_plan authenticate_media_plan(
	const std::filesystem::path& path,
	const std::string& expected_sha256
);

} // namespace framescaper::media
