/* SPDX-License-Identifier: AGPL-3.0-only */

#ifndef _GNU_SOURCE
#define _GNU_SOURCE
#endif

#include "delivery_fs_posix.hpp"

#include <cerrno>
#include <cstring>
#include <fcntl.h>
#include <unistd.h>

namespace soundscaper::delivery_fs {

owned_fd::owned_fd(int value) noexcept : value_(value) {}
owned_fd::~owned_fd() { reset(); }
owned_fd::owned_fd(owned_fd&& other) noexcept : value_(other.release()) {}
owned_fd& owned_fd::operator=(owned_fd&& other) noexcept {
	if (this != &other) reset(other.release());
	return *this;
}

int owned_fd::get() const noexcept { return value_; }

int owned_fd::release() noexcept {
	const auto output = value_;
	value_ = -1;
	return output;
}

void owned_fd::reset(int value) noexcept {
	if (value_ >= 0) while (::close(value_) < 0 && errno == EINTR) {}
	value_ = value;
}

root_identity directory_identity(const struct stat& details) {
	const auto volume = "device:" + hex_value(static_cast<std::uint64_t>(details.st_dev));
	return {volume, volume + ":inode:" + hex_value(static_cast<std::uint64_t>(details.st_ino))};
}

file_identity regular_file_identity(const struct stat& details) {
	return {"device:" + hex_value(static_cast<std::uint64_t>(details.st_dev)),
		"inode:" + hex_value(static_cast<std::uint64_t>(details.st_ino))};
}

bool same(const root_identity& left, const root_identity& right) {
	return left.volume_identity == right.volume_identity
		&& left.directory_identity == right.directory_identity;
}

bool same(const file_identity& left, const file_identity& right) {
	return left.volume_identity == right.volume_identity
		&& left.file_identity_value == right.file_identity_value;
}

[[noreturn]] void fail_errno(const char* code, const char* phase, bool retryable) {
	const auto saved = errno;
	throw protocol_error(code, phase, retryable, std::strerror(saved));
}

owned_fd open_authenticated_root(
	const std::string& path,
	const root_identity& expected,
	root_non_directory_error non_directory_error) {
	owned_fd root(::open(path.c_str(), O_RDONLY | O_DIRECTORY | O_CLOEXEC | O_NOFOLLOW));
	if (root.get() < 0) fail_errno("destination-unavailable", "root-open", true);
	struct stat details {};
	if (::fstat(root.get(), &details) < 0) fail_errno("destination-unavailable", "root-stat", true);
	if (!S_ISDIR(details.st_mode)) {
		if (non_directory_error == root_non_directory_error::destination_unavailable) {
			throw protocol_error("destination-unavailable", "root-stat", false,
				"The authorized delivery root is not a directory.");
		}
		throw protocol_error("destination-identity-mismatch", "root-stat", false,
			"The opened delivery root is not the authorized physical directory.");
	}
	if (!same(directory_identity(details), expected)) {
		throw protocol_error("destination-identity-mismatch", "root-stat", false,
			"The opened delivery root is not the authorized physical directory.");
	}
	return root;
}

} // namespace soundscaper::delivery_fs
