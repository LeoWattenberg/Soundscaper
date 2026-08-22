// SPDX-License-Identifier: AGPL-3.0-only
#pragma once

#include <cstdint>
#include <filesystem>
#include <string>
#include <string_view>
#include <vector>

namespace framescaper::media {

inline constexpr std::uint64_t image_sequence_maximum_inventory_bytes = 512ULL * 1024ULL * 1024ULL;
inline constexpr std::uint64_t image_sequence_maximum_frame_bytes = 512ULL * 1024ULL * 1024ULL;
inline constexpr std::uint64_t image_sequence_maximum_pack_bytes = 16ULL * 1024ULL * 1024ULL * 1024ULL * 1024ULL;
inline constexpr std::uint32_t image_sequence_maximum_frames = 2'000'000;

enum class image_sequence_profile { png, tiff, openexr };

struct admitted_image_sequence_frame final {
	std::uint32_t frame_number{};
	std::uint64_t offset{};
	std::uint64_t byte_length{};
	std::string sha256;
};

struct admitted_image_sequence final {
	image_sequence_profile profile{};
	std::filesystem::path pack_path;
	std::filesystem::path inventory_path;
	std::string pack_sha256;
	std::string inventory_sha256;
	std::uint64_t pack_byte_length{};
	std::uint64_t inventory_byte_length{};
	std::uint32_t frame_rate_num{};
	std::uint32_t frame_rate_den{};
	std::vector<admitted_image_sequence_frame> frames;
};

[[nodiscard]] image_sequence_profile parse_image_sequence_profile(std::string_view value);

/**
 * Authenticates the fixed header/index and the canonical external inventory.
 * Frame payloads are range-hashed before this function returns. The pack itself
 * is never allocated as one value.
 */
[[nodiscard]] admitted_image_sequence authenticate_image_sequence_pack(
	image_sequence_profile profile,
	const std::filesystem::path& pack_path,
	const std::string& pack_sha256,
	std::uint64_t pack_byte_length,
	const std::filesystem::path& inventory_path,
	const std::string& inventory_sha256,
	std::uint64_t inventory_byte_length,
	std::uint32_t frame_rate_num,
	std::uint32_t frame_rate_den
);

} // namespace framescaper::media
