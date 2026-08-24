// SPDX-License-Identifier: AGPL-3.0-only
#pragma once

#include "media_host_contract.hpp"
#include "media_plan.hpp"
#include "image_sequence_pack.hpp"

#include <cstdint>
#include <filesystem>
#include <optional>
#include <string>
#include <vector>

namespace framescaper::media {

struct invocation final {
	operation kind{};
	std::filesystem::path plan;
	std::string plan_sha256;
	admitted_media_plan admitted_plan;
	std::vector<std::filesystem::path> sources;
	std::vector<std::string> source_sha256;
	std::vector<std::uint64_t> source_byte_lengths;
	std::vector<std::string> source_roles;
	std::vector<int> source_stream_fds;
	std::filesystem::path temporary_output;
	std::filesystem::path decode_output;
	std::filesystem::path destination_root;
	std::filesystem::path scratch_root;
	std::string backend;
	std::string proxy_recipe;
	std::uint32_t proxy_width{};
	std::uint32_t proxy_height{};
	std::uint64_t maximum_output_bytes{};
	std::optional<admitted_image_sequence> image_sequence;
};

struct engine_result final {
	int exit_code{};
	std::string control_json;
};

/** Verifies the exact FFmpeg ABI closure linked into this executable. */
[[nodiscard]] engine_result self_test_ffmpeg();

/** Executes only one admitted closed operation; no raw FFmpeg argument seam. */
[[nodiscard]] engine_result execute_ffmpeg_job(const invocation& job);

/** Shared cancellation observation installed by the process dispatcher. */
[[nodiscard]] bool media_cancellation_requested() noexcept;

} // namespace framescaper::media
