/* SPDX-License-Identifier: AGPL-3.0-only */

#pragma once

#include "delivery_fs_protocol.hpp"

#include <cstddef>
#include <cstdint>
#include <span>
#include <string>
#include <sys/stat.h>

namespace soundscaper::delivery_fs {

class owned_fd final {
public:
	explicit owned_fd(int value = -1) noexcept;
	~owned_fd();
	owned_fd(const owned_fd&) = delete;
	owned_fd& operator=(const owned_fd&) = delete;
	owned_fd(owned_fd&& other) noexcept;
	owned_fd& operator=(owned_fd&& other) noexcept;

	int get() const noexcept;
	int release() noexcept;
	void reset(int value = -1) noexcept;

private:
	int value_;
};

enum class root_non_directory_error {
	destination_unavailable,
	identity_mismatch,
};

root_identity directory_identity(const struct stat& details);
file_identity regular_file_identity(const struct stat& details);

[[noreturn]] void fail_errno(const char* code, const char* phase, bool retryable = false);

void write_posix_staging_fd(
	int descriptor,
	std::uint64_t offset,
	std::span<const std::byte> bytes,
	const char* zero_write_detail);
std::size_t read_posix_staging_fd(int descriptor, std::uint64_t offset, std::span<std::byte> bytes);
void sync_posix_staging_fd(int descriptor);

owned_fd open_authenticated_root(
	const std::string& path,
	const root_identity& expected,
	root_non_directory_error non_directory_error);

} // namespace soundscaper::delivery_fs
