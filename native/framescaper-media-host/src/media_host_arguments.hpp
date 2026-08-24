// SPDX-License-Identifier: AGPL-3.0-only

#pragma once

#include "media_host_contract.hpp"

#include <cstdint>
#include <filesystem>
#include <optional>
#include <stdexcept>
#include <string>
#include <vector>

namespace framescaper::media {

inline constexpr std::uint64_t maximum_native_file_bytes =
	16ULL * 1024ULL * 1024ULL * 1024ULL * 1024ULL;

class admission_error final : public std::runtime_error {
public:
	using std::runtime_error::runtime_error;
};

struct parsed_arguments final {
	bool self_test{};
	bool capabilities{};
	std::optional<std::string> self_test_operation;
	std::optional<operation> kind;
	std::optional<std::filesystem::path> plan;
	std::optional<std::string> plan_sha256;
	std::vector<std::filesystem::path> sources;
	std::vector<std::string> source_sha256;
	std::vector<std::uint64_t> source_byte_lengths;
	std::vector<std::string> source_roles;
	std::vector<int> source_stream_fds;
	std::vector<std::filesystem::path> video_timing_assets;
	std::vector<std::string> video_timing_sha256;
	std::vector<std::uint64_t> video_timing_byte_lengths;
	std::optional<std::filesystem::path> temporary_output;
	std::optional<std::filesystem::path> decode_output;
	std::optional<std::filesystem::path> destination_root;
	std::optional<std::filesystem::path> scratch_root;
	std::optional<std::string> backend;
	std::optional<std::string> proxy_recipe;
	std::optional<std::uint64_t> proxy_width;
	std::optional<std::uint64_t> proxy_height;
	std::optional<std::uint64_t> maximum_output_bytes;
	std::optional<std::string> sequence_profile;
	std::optional<std::uint64_t> sequence_rate_num;
	std::optional<std::uint64_t> sequence_rate_den;
};

[[nodiscard]] parsed_arguments parse_arguments(int argc, char** argv);

} // namespace framescaper::media
