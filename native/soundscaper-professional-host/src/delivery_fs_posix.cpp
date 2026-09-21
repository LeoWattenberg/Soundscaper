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

[[noreturn]] void fail_errno(const char* code, const char* phase, bool retryable) {
	const auto saved = errno;
	throw protocol_error(code, phase, retryable, std::strerror(saved));
}

void write_posix_staging_fd(
	int descriptor,
	std::uint64_t offset,
	std::span<const std::byte> bytes,
	const char* zero_write_detail) {
	std::size_t written = 0;
	while (written < bytes.size()) {
		const auto result = ::pwrite(descriptor, bytes.data() + written, bytes.size() - written,
			static_cast<off_t>(offset + written));
		if (result < 0) {
			if (errno == EINTR) continue;
			fail_errno("staging-write-failed", "write", true);
		}
		if (result == 0) throw protocol_error("staging-write-failed", "write", true,
			zero_write_detail);
		written += static_cast<std::size_t>(result);
	}
}

std::size_t read_posix_staging_fd(int descriptor, std::uint64_t offset, std::span<std::byte> bytes) {
	for (;;) {
		const auto result = ::pread(descriptor, bytes.data(), bytes.size(), static_cast<off_t>(offset));
		if (result >= 0) return static_cast<std::size_t>(result);
		if (errno != EINTR) fail_errno("staging-read-failed", "seal-read", true);
	}
}

void sync_posix_staging_fd(int descriptor) {
	if (::fsync(descriptor) < 0) fail_errno("staging-sync-failed", "seal-sync", true);
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
