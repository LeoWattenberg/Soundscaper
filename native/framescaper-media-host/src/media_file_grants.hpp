/* SPDX-License-Identifier: AGPL-3.0-only */

#pragma once

#include <cstdint>
#include <filesystem>
#include <stdexcept>
#include <string>
#include <string_view>

namespace framescaper::media {

class authentication_error final : public std::runtime_error {
public:
	using std::runtime_error::runtime_error;
};

class grant_error final : public std::runtime_error {
public:
	using std::runtime_error::runtime_error;
};

[[nodiscard]] std::filesystem::path authenticate_regular_file(
	const std::filesystem::path& path,
	const std::string& expected_sha256,
	std::string_view label,
	std::uintmax_t maximum_bytes
);
[[nodiscard]] std::filesystem::path authenticate_directory(
	const std::filesystem::path& path,
	std::string_view label
);
[[nodiscard]] std::filesystem::path authenticate_new_direct_child(
	const std::filesystem::path& path,
	const std::filesystem::path& authenticated_root,
	std::string_view label
);

} // namespace framescaper::media
