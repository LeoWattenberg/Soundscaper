/* SPDX-License-Identifier: AGPL-3.0-only */

#pragma once

#include "delivery_fs_protocol.hpp"

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
bool same(const root_identity& left, const root_identity& right);
bool same(const file_identity& left, const file_identity& right);

[[noreturn]] void fail_errno(const char* code, const char* phase, bool retryable = false);

owned_fd open_authenticated_root(
	const std::string& path,
	const root_identity& expected,
	root_non_directory_error non_directory_error);

} // namespace soundscaper::delivery_fs
