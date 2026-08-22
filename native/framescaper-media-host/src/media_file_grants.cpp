/* SPDX-License-Identifier: AGPL-3.0-only */

#include "media_file_grants.hpp"
#include "sha256.hpp"

#include <system_error>

namespace framescaper::media {
namespace {

[[nodiscard]] std::filesystem::file_status status_without_following(
	const std::filesystem::path& path,
	const std::string_view label
) {
	std::error_code error;
	const auto status = std::filesystem::symlink_status(path, error);
	if (error) throw grant_error(std::string{label} + " identity could not be inspected.");
	return status;
}

[[nodiscard]] std::filesystem::path exact_canonical(
	const std::filesystem::path& path,
	const std::string_view label
) {
	if (!path.is_absolute() || path != path.lexically_normal()) {
		throw grant_error(std::string{label} + " is not an exact normalized absolute path.");
	}
	std::error_code error;
	const auto canonical = std::filesystem::canonical(path, error);
	if (error || canonical != path) {
		throw grant_error(std::string{label} + " identity is not canonical or crosses a link.");
	}
	return canonical;
}

} // namespace

std::filesystem::path authenticate_regular_file(
	const std::filesystem::path& path,
	const std::string& expected_sha256,
	const std::string_view label,
	const std::uintmax_t maximum_bytes
) {
	if (!is_sha256_hex(expected_sha256)) {
		throw authentication_error(std::string{label} + " SHA-256 identity is invalid.");
	}
	const auto status = status_without_following(path, label);
	if (std::filesystem::is_symlink(status) || !std::filesystem::is_regular_file(status)) {
		throw grant_error(std::string{label} + " must be a non-symlink regular file.");
	}
	const auto canonical = exact_canonical(path, label);
	std::error_code error;
	const auto size = std::filesystem::file_size(canonical, error);
	if (error || size > maximum_bytes) {
		throw grant_error(std::string{label} + " exceeds its authenticated byte ceiling.");
	}
	if (sha256_file(canonical) != expected_sha256) {
		throw authentication_error(std::string{label} + " digest did not authenticate.");
	}
	return canonical;
}

std::filesystem::path authenticate_directory(
	const std::filesystem::path& path,
	const std::string_view label
) {
	const auto status = status_without_following(path, label);
	if (std::filesystem::is_symlink(status) || !std::filesystem::is_directory(status)) {
		throw grant_error(std::string{label} + " must be a non-symlink directory.");
	}
	return exact_canonical(path, label);
}

std::filesystem::path authenticate_new_direct_child(
	const std::filesystem::path& path,
	const std::filesystem::path& authenticated_root,
	const std::string_view label
) {
	if (!path.is_absolute() || path != path.lexically_normal() || path.filename().empty()) {
		throw grant_error(std::string{label} + " must be an exact named absolute path.");
	}
	std::error_code error;
	const auto status = std::filesystem::symlink_status(path, error);
	if (error && error != std::errc::no_such_file_or_directory) {
		throw grant_error(std::string{label} + " identity could not be inspected.");
	}
	if (!error && status.type() != std::filesystem::file_type::not_found) {
		throw grant_error(std::string{label} + " must not exist before publication.");
	}
	const auto parent = authenticate_directory(path.parent_path(), std::string{label} + " parent");
	if (parent != authenticated_root) {
		throw grant_error(std::string{label} + " must be a direct child of its authenticated root.");
	}
	return parent / path.filename();
}

} // namespace framescaper::media
