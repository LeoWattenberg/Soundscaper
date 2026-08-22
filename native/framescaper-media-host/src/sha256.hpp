/* SPDX-License-Identifier: AGPL-3.0-only */

#pragma once

#include <filesystem>
#include <cstdint>
#include <functional>
#include <string>

namespace framescaper::media {

[[nodiscard]] bool is_sha256_hex(const std::string& value);
[[nodiscard]] std::string sha256_file(const std::filesystem::path& path);
[[nodiscard]] std::string sha256_file_range(
	const std::filesystem::path& path,
	std::uint64_t offset,
	std::uint64_t byte_length
);
[[nodiscard]] std::string sha256_bytes(const std::uint8_t* bytes, std::size_t byte_length);

struct sha256_range_identity final {
	std::uint64_t offset{};
	std::uint64_t byte_length{};
	std::string sha256;
};

[[nodiscard]] bool sha256_file_ranges_match(
	const std::filesystem::path& path,
	std::size_t range_count,
	const std::function<sha256_range_identity(std::size_t)>& range_at
);

} // namespace framescaper::media
