/* SPDX-License-Identifier: AGPL-3.0-only */

#ifndef _GNU_SOURCE
#define _GNU_SOURCE
#endif

#include "delivery_fs_platform.hpp"
#include "delivery_fs_sha256.hpp"

#include <algorithm>
#include <array>
#include <cerrno>
#include <cstring>
#include <fcntl.h>
#include <memory>
#include <span>
#include <string>
#include <sys/stat.h>
#include <sys/types.h>
#include <unistd.h>

namespace soundscaper::delivery_fs {
namespace {

class owned_fd final {
public:
	explicit owned_fd(int value = -1) noexcept : value_(value) {}
	~owned_fd() { reset(); }
	owned_fd(const owned_fd&) = delete;
	owned_fd& operator=(const owned_fd&) = delete;
	owned_fd(owned_fd&& other) noexcept : value_(other.release()) {}
	owned_fd& operator=(owned_fd&& other) noexcept {
		if (this != &other) reset(other.release());
		return *this;
	}
	int get() const noexcept { return value_; }
	int release() noexcept { const auto output = value_; value_ = -1; return output; }
	void reset(int value = -1) noexcept {
		if (value_ >= 0) while (::close(value_) < 0 && errno == EINTR) {}
		value_ = value;
	}
private:
	int value_;
};

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

bool unsupported(int value) {
	return value == EOPNOTSUPP || value == ENOTSUP || value == EINVAL || value == EISDIR;
}

[[noreturn]] void fail_errno(const char* code, const char* phase, bool retryable = false) {
	const auto saved = errno;
	throw protocol_error(code, phase, retryable, std::strerror(saved));
}

owned_fd open_authenticated_root(const std::string& path, const root_identity& expected) {
	owned_fd root(::open(path.c_str(), O_RDONLY | O_DIRECTORY | O_CLOEXEC | O_NOFOLLOW));
	if (root.get() < 0) fail_errno("destination-unavailable", "root-open", true);
	struct stat details {};
	if (::fstat(root.get(), &details) < 0) fail_errno("destination-unavailable", "root-stat", true);
	if (!S_ISDIR(details.st_mode)) {
		throw protocol_error("destination-unavailable", "root-stat", false,
			"The authorized delivery root is not a directory.");
	}
	if (!same(directory_identity(details), expected)) {
		throw protocol_error("destination-identity-mismatch", "root-stat", false,
			"The opened delivery root is not the authorized physical directory.");
	}
	return root;
}

recovery_result inspect_relative_file(int root, const std::string& name) {
	owned_fd file(::openat(root, name.c_str(), O_RDONLY | O_CLOEXEC | O_NOFOLLOW));
	if (file.get() < 0) {
		if (errno == ENOENT) return {.status = "missing", .byte_length = 0, .sha256 = {}, .identity = std::nullopt};
		if (errno == ELOOP) return {.status = "foreign", .byte_length = 0, .sha256 = {}, .identity = std::nullopt};
		fail_errno("final-inspection-failed", "inspect-final-open", true);
	}
	struct stat before {};
	if (::fstat(file.get(), &before) < 0) fail_errno("final-inspection-failed", "inspect-final-stat", true);
	if (!S_ISREG(before.st_mode) || before.st_size < 0) {
		return {.status = "foreign", .byte_length = 0, .sha256 = {}, .identity = std::nullopt};
	}
	const auto identity = regular_file_identity(before);
	sha256 digest;
	std::array<std::byte, 1024U * 1024U> buffer{};
	std::uint64_t offset = 0;
	const auto length = static_cast<std::uint64_t>(before.st_size);
	while (offset < length) {
		const auto amount = static_cast<std::size_t>(
			std::min<std::uint64_t>(buffer.size(), length - offset));
		const auto count = ::pread(file.get(), buffer.data(), amount, static_cast<off_t>(offset));
		if (count < 0) { if (errno == EINTR) continue; fail_errno("final-inspection-failed", "inspect-final-read", true); }
		if (count == 0) throw protocol_error("final-inspection-failed", "inspect-final-read", true,
			"The final delivery file returned an early end of file.");
		digest.update(std::span(buffer).first(static_cast<std::size_t>(count)));
		offset += static_cast<std::size_t>(count);
	}
	struct stat after {};
	if (::fstat(file.get(), &after) < 0 || after.st_size != before.st_size
		|| !same(regular_file_identity(after), identity)) {
		throw protocol_error("final-identity-mismatch", "inspect-final-stat", false,
			"The final delivery file changed while it was inspected.");
	}
	return {.status = "inspection", .byte_length = length,
		.sha256 = digest.finish_hex(), .identity = identity};
}

class linux_session final : public platform_session {
public:
	explicit linux_session(const init_request& request)
		: root_fd_(open_authenticated_root(request.root_path, request.expected_root_identity)),
		root_identity_(request.expected_root_identity), final_name_(request.final_name),
		staging_reference_("linux-otmpfile-v1:" + request.session_id) {
		const auto descriptor = ::openat(root_fd_.get(), ".", O_TMPFILE | O_RDWR | O_CLOEXEC, 0600);
		if (descriptor < 0) {
			if (unsupported(errno)) fail_errno("unsupported-filesystem", "stage-open");
			fail_errno("staging-unavailable", "stage-open", true);
		}
		file_fd_.reset(descriptor);
		struct stat details {};
		if (::fstat(file_fd_.get(), &details) < 0) fail_errno("staging-unavailable", "stage-stat", true);
		if (!S_ISREG(details.st_mode) || details.st_dev != root_device()) {
			throw protocol_error("unsupported-filesystem", "stage-stat", false,
				"The filesystem did not create one same-volume anonymous regular file.");
		}
		file_identity_ = regular_file_identity(details);
	}

	~linux_session() override { abort(); }
	const root_identity& root() const noexcept override { return root_identity_; }
	const file_identity& file() const noexcept override { return file_identity_; }
	const std::string& staging_reference() const noexcept override { return staging_reference_; }

	void write_at(std::uint64_t offset, std::span<const std::byte> bytes) override {
		std::size_t written = 0;
		while (written < bytes.size()) {
			const auto result = ::pwrite(file_fd_.get(), bytes.data() + written, bytes.size() - written,
				static_cast<off_t>(offset + written));
			if (result < 0) {
				if (errno == EINTR) continue;
				fail_errno("staging-write-failed", "write", true);
			}
			if (result == 0) throw protocol_error("staging-write-failed", "write", true,
				"The anonymous delivery file accepted a zero-byte write.");
			written += static_cast<std::size_t>(result);
		}
	}

	std::size_t read_at(std::uint64_t offset, std::span<std::byte> bytes) override {
		for (;;) {
			const auto result = ::pread(file_fd_.get(), bytes.data(), bytes.size(), static_cast<off_t>(offset));
			if (result >= 0) return static_cast<std::size_t>(result);
			if (errno != EINTR) fail_errno("staging-read-failed", "seal-read", true);
		}
	}

	std::uint64_t size() const override {
		const auto details = current_file_stat("stage-stat");
		return static_cast<std::uint64_t>(details.st_size);
	}

	void flush_file() override {
		if (::fsync(file_fd_.get()) < 0) fail_errno("staging-sync-failed", "seal-sync", true);
	}

	publication_result publish() override {
		if (published_) throw protocol_error("invalid-state", "publish", false,
			"The delivery session was already published.");
		assert_root_current();
		if (::linkat(file_fd_.get(), "", root_fd_.get(), final_name_.c_str(), AT_EMPTY_PATH) < 0) {
			const auto direct_error = errno;
			if (direct_error == EPERM || direct_error == ENOENT) {
				const auto proc_reference = "/proc/self/fd/" + std::to_string(file_fd_.get());
				if (::linkat(AT_FDCWD, proc_reference.c_str(), root_fd_.get(), final_name_.c_str(),
					AT_SYMLINK_FOLLOW) < 0) publication_failure();
			} else publication_failure();
		}
		published_ = true;
		struct stat final_details {};
		if (::fstatat(root_fd_.get(), final_name_.c_str(), &final_details, AT_SYMLINK_NOFOLLOW) < 0) {
			fail_errno("publication-verification-failed", "publish-stat", true);
		}
		const auto final_identity = regular_file_identity(final_details);
		if (!S_ISREG(final_details.st_mode) || !same(final_identity, file_identity_)) {
			throw protocol_error("publication-verification-failed", "publish-stat", false,
				"The no-clobber publication did not preserve the staged file identity.");
		}
		if (::fsync(root_fd_.get()) < 0) {
			if (unsupported(errno)) fail_errno("unsupported-filesystem", "publish-directory-sync");
			fail_errno("publication-sync-failed", "publish-directory-sync", true);
		}
		return {final_identity};
	}

	void abort() noexcept override {
		file_fd_.reset();
		root_fd_.reset();
	}

private:
	dev_t root_device() const {
		struct stat details {};
		if (::fstat(root_fd_.get(), &details) < 0) fail_errno("destination-unavailable", "root-stat", true);
		return details.st_dev;
	}

	struct stat current_file_stat(const char* phase) const {
		struct stat details {};
		if (::fstat(file_fd_.get(), &details) < 0) fail_errno("staging-unavailable", phase, true);
		if (!S_ISREG(details.st_mode) || !same(regular_file_identity(details), file_identity_)) {
			throw protocol_error("staging-identity-mismatch", phase, false,
				"The retained delivery handle changed identity.");
		}
		return details;
	}

	void assert_root_current() const {
		struct stat details {};
		if (::fstat(root_fd_.get(), &details) < 0) fail_errno("destination-unavailable", "publish-root-stat", true);
		if (!same(directory_identity(details), root_identity_)) {
			throw protocol_error("destination-identity-mismatch", "publish-root-stat", false,
				"The retained delivery root handle changed identity.");
		}
	}

	[[noreturn]] static void publication_failure() {
		if (errno == EEXIST) fail_errno("publication-conflict", "publish-link");
		if (unsupported(errno)) fail_errno("unsupported-filesystem", "publish-link");
		fail_errno("publication-failed", "publish-link", true);
	}

	owned_fd root_fd_;
	owned_fd file_fd_;
	root_identity root_identity_;
	file_identity file_identity_;
	std::string final_name_;
	std::string staging_reference_;
	bool published_ = false;
};

} // namespace

std::unique_ptr<platform_session> create_platform_session(const init_request& request) {
	return std::make_unique<linux_session>(request);
}

recovery_result recover_platform_session(const recovery_request& request) {
	auto root = open_authenticated_root(request.root_path, request.expected_root_identity);
	(void)root;
	return {.status = "missing", .byte_length = 0, .sha256 = {}, .identity = std::nullopt};
}

recovery_result inspect_platform_final(const final_inspection_request& request) {
	auto root = open_authenticated_root(request.root_path, request.expected_root_identity);
	return inspect_relative_file(root.get(), request.final_name);
}

} // namespace soundscaper::delivery_fs
