/* SPDX-License-Identifier: AGPL-3.0-only */

#include "delivery_fs_platform.hpp"
#include "delivery_fs_sha256.hpp"

#import <Foundation/Foundation.h>

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

bool unsupported(int value) { return value == ENOTSUP || value == EINVAL || value == EXDEV; }

[[noreturn]] void fail_errno(const char* code, const char* phase, bool retryable = false) {
	const auto saved = errno;
	throw protocol_error(code, phase, retryable, std::strerror(saved));
}

owned_fd open_authenticated_root(const std::string& path, const root_identity& expected) {
	owned_fd root(::open(path.c_str(), O_RDONLY | O_DIRECTORY | O_CLOEXEC | O_NOFOLLOW));
	if (root.get() < 0) fail_errno("destination-unavailable", "root-open", true);
	struct stat details {};
	if (::fstat(root.get(), &details) < 0) fail_errno("destination-unavailable", "root-stat", true);
	if (!S_ISDIR(details.st_mode) || !same(directory_identity(details), expected)) {
		throw protocol_error("destination-identity-mismatch", "root-stat", false,
			"The opened delivery root is not the authorized physical directory.");
	}
	return root;
}

std::string replacement_directory(const std::string& root_path) {
	@autoreleasepool {
		NSString* path = [NSString stringWithUTF8String:root_path.c_str()];
		if (path == nil) throw protocol_error("malformed-control", "stage-open", false,
			"The macOS delivery root is not UTF-8.");
		NSURL* root = [NSURL fileURLWithPath:path isDirectory:YES];
		NSError* error = nil;
		NSURL* replacement = [[NSFileManager defaultManager]
			URLForDirectory:NSItemReplacementDirectory
			inDomain:NSUserDomainMask
			appropriateForURL:root
			create:YES
			error:&error];
		if (replacement == nil) {
			throw protocol_error("unsupported-filesystem", "stage-open", false,
				"macOS could not allocate an item-replacement directory.");
		}
		const char* value = replacement.fileSystemRepresentation;
		if (value == nullptr || *value == '\0') throw protocol_error("unsupported-filesystem",
			"stage-open", false, "macOS returned no item-replacement directory path.");
		return value;
	}
}

std::string opaque_reference(const std::string& path) {
	static constexpr char digits[] = "0123456789abcdef";
	std::string output = "macos-replacement-v1:";
	output.reserve(output.size() + path.size() * 2);
	for (const auto value : path) {
		const auto byte = static_cast<unsigned char>(value);
		output.push_back(digits[byte >> 4U]);
		output.push_back(digits[byte & 0x0fU]);
	}
	return output;
}

std::string decode_reference(const std::string& reference) {
	const std::string prefix = "macos-replacement-v1:";
	if (!reference.starts_with(prefix) || (reference.size() - prefix.size()) % 2 != 0) {
		throw protocol_error("invalid-staging-reference", "recover", false,
			"The macOS staging reference is invalid.");
	}
	std::string output;
	output.reserve((reference.size() - prefix.size()) / 2);
	auto nibble = [](char value) -> unsigned {
		if (value >= '0' && value <= '9') return static_cast<unsigned>(value - '0');
		if (value >= 'a' && value <= 'f') return static_cast<unsigned>(value - 'a' + 10);
		throw protocol_error("invalid-staging-reference", "recover", false,
			"The macOS staging reference is invalid.");
	};
	for (std::size_t index = prefix.size(); index < reference.size(); index += 2) {
		output.push_back(static_cast<char>((nibble(reference[index]) << 4U)
			| nibble(reference[index + 1])));
	}
	if (output.empty() || output[0] != '/' || output.find('\0') != std::string::npos) {
		throw protocol_error("invalid-staging-reference", "recover", false,
			"The macOS staging reference is invalid.");
	}
	return output;
}

std::string digest_fd(int descriptor, std::uint64_t size) {
	sha256 digest;
	std::array<std::byte, 1024U * 1024U> buffer{};
	std::uint64_t offset = 0;
	while (offset < size) {
		const auto requested = static_cast<std::size_t>(
			std::min<std::uint64_t>(buffer.size(), size - offset));
		const auto count = ::pread(descriptor, buffer.data(), requested, static_cast<off_t>(offset));
		if (count < 0) { if (errno == EINTR) continue; fail_errno("staging-read-failed", "recover-read", true); }
		if (count == 0) throw protocol_error("staging-read-failed", "recover-read", true,
			"The macOS recovery file returned an early end of file.");
		digest.update(std::span(buffer).first(static_cast<std::size_t>(count)));
		offset += static_cast<std::size_t>(count);
	}
	return digest.finish_hex();
}

class macos_session final : public platform_session {
public:
	explicit macos_session(const init_request& request)
		: root_(open_authenticated_root(request.root_path, request.expected_root_identity)),
		root_identity_(request.expected_root_identity), final_name_(request.final_name),
		replacement_path_(replacement_directory(request.root_path)),
		stage_name_(".soundscaper-delivery-" + request.session_id + ".native-stage") {
		replacement_.reset(::open(replacement_path_.c_str(),
			O_RDONLY | O_DIRECTORY | O_CLOEXEC | O_NOFOLLOW));
		if (replacement_.get() < 0) fail_errno("staging-unavailable", "replacement-open", true);
		struct stat directory {};
		if (::fstat(replacement_.get(), &directory) < 0) fail_errno("staging-unavailable", "replacement-stat", true);
		if (!S_ISDIR(directory.st_mode) || directory.st_dev != root_device()
			|| directory.st_uid != geteuid() || (directory.st_mode & 0022) != 0) {
			throw protocol_error("unsupported-filesystem", "replacement-stat", false,
				"The macOS item-replacement directory is not private and same-volume.");
		}
		file_.reset(::openat(replacement_.get(), stage_name_.c_str(),
			O_CREAT | O_EXCL | O_RDWR | O_CLOEXEC | O_NOFOLLOW, 0600));
		if (file_.get() < 0) fail_errno("staging-unavailable", "stage-open", true);
		const auto details = file_stat("stage-stat");
		file_identity_ = regular_file_identity(details);
		staging_reference_ = opaque_reference(replacement_path_ + "/" + stage_name_);
	}

	~macos_session() override { abort(); }
	const root_identity& root() const noexcept override { return root_identity_; }
	const file_identity& file() const noexcept override { return file_identity_; }
	const std::string& staging_reference() const noexcept override { return staging_reference_; }

	void write_at(std::uint64_t offset, std::span<const std::byte> bytes) override {
		std::size_t written = 0;
		while (written < bytes.size()) {
			const auto count = ::pwrite(file_.get(), bytes.data() + written, bytes.size() - written,
				static_cast<off_t>(offset + written));
			if (count < 0) { if (errno == EINTR) continue; fail_errno("staging-write-failed", "write", true); }
			if (count == 0) throw protocol_error("staging-write-failed", "write", true,
				"The macOS delivery file accepted a zero-byte write.");
			written += static_cast<std::size_t>(count);
		}
	}

	std::size_t read_at(std::uint64_t offset, std::span<std::byte> bytes) override {
		for (;;) {
			const auto count = ::pread(file_.get(), bytes.data(), bytes.size(), static_cast<off_t>(offset));
			if (count >= 0) return static_cast<std::size_t>(count);
			if (errno != EINTR) fail_errno("staging-read-failed", "seal-read", true);
		}
	}

	std::uint64_t size() const override {
		return static_cast<std::uint64_t>(file_stat("stage-size").st_size);
	}

	void flush_file() override {
		if (::fsync(file_.get()) < 0) fail_errno("staging-sync-failed", "seal-sync", true);
	}

	publication_result publish() override {
		assert_root_current();
		const auto retained_before = file_stat("publish-stage-stat");
		const auto named_before = named_stage_stat("publish-stage-name-stat");
		if (retained_before.st_nlink != 1 || named_before.st_nlink != 1) {
			throw protocol_error("staging-identity-mismatch", "publish-stage-link-count", false,
				"The authenticated macOS delivery stage already has an unexpected hard link.");
		}
		if (::linkat(replacement_.get(), stage_name_.c_str(), root_.get(), final_name_.c_str(), 0) < 0) {
			if (errno == EEXIST) fail_errno("publication-conflict", "publish-link");
			if (unsupported(errno)) fail_errno("unsupported-filesystem", "publish-link");
			fail_errno("publication-failed", "publish-link", true);
		}
		struct stat final_details {};
		if (::fstatat(root_.get(), final_name_.c_str(), &final_details, AT_SYMLINK_NOFOLLOW) < 0) {
			fail_errno("publication-verification-failed", "publish-stat", true);
		}
		const auto final_identity = regular_file_identity(final_details);
		const auto retained_linked = file_stat("publish-linked-stage-stat");
		const auto named_linked = named_stage_stat("publish-linked-stage-name-stat");
		if (!S_ISREG(final_details.st_mode) || !same(final_identity, file_identity_)
			|| final_details.st_nlink != 2 || retained_linked.st_nlink != 2
			|| named_linked.st_nlink != 2) {
			throw protocol_error("publication-verification-failed", "publish-stat", false,
				"The macOS exclusive hard link did not preserve the authenticated stage identity.");
		}
		if (::fsync(root_.get()) < 0) {
			fail_errno("publication-sync-failed", "publish-link-directory-sync", true);
		}
		const auto retained_before_unlink = file_stat("publish-pre-unlink-stage-stat");
		const auto named_before_unlink = named_stage_stat("publish-pre-unlink-stage-name-stat");
		if (retained_before_unlink.st_nlink != 2 || named_before_unlink.st_nlink != 2) {
			throw protocol_error("staging-identity-mismatch", "publish-pre-unlink", false,
				"The authenticated macOS delivery stage changed before retirement.");
		}
		if (::unlinkat(replacement_.get(), stage_name_.c_str(), 0) < 0) {
			fail_errno("publication-failed", "publish-stage-unlink", true);
		}
		published_ = true;
		const auto retained_published = file_stat("publish-retained-final-stat");
		struct stat published_details {};
		if (::fstatat(root_.get(), final_name_.c_str(), &published_details, AT_SYMLINK_NOFOLLOW) < 0) {
			fail_errno("publication-verification-failed", "publish-final-stat", true);
		}
		if (!S_ISREG(published_details.st_mode)
			|| !same(regular_file_identity(published_details), file_identity_)
			|| retained_published.st_nlink != 1 || published_details.st_nlink != 1) {
			throw protocol_error("publication-verification-failed", "publish-final-stat", false,
				"The published macOS delivery file did not retain sole authenticated identity.");
		}
		if (::fsync(replacement_.get()) < 0) {
			fail_errno("publication-sync-failed", "publish-stage-directory-sync", true);
		}
		if (::fsync(root_.get()) < 0) {
			fail_errno("publication-sync-failed", "publish-final-directory-sync", true);
		}
		return {final_identity};
	}

	void abort() noexcept override {
		if (!published_ && replacement_.get() >= 0 && !stage_name_.empty()) {
			struct stat leaf {};
			if (::fstatat(replacement_.get(), stage_name_.c_str(), &leaf, AT_SYMLINK_NOFOLLOW) == 0
				&& S_ISREG(leaf.st_mode) && same(regular_file_identity(leaf), file_identity_)) {
				(void)::unlinkat(replacement_.get(), stage_name_.c_str(), 0);
				(void)::fsync(replacement_.get());
			}
		}
		file_.reset();
		replacement_.reset();
		if (!replacement_path_.empty()) (void)::rmdir(replacement_path_.c_str());
		root_.reset();
	}

private:
	dev_t root_device() const {
		struct stat details {};
		if (::fstat(root_.get(), &details) < 0) fail_errno("destination-unavailable", "root-stat", true);
		return details.st_dev;
	}

	struct stat file_stat(const char* phase) const {
		struct stat details {};
		if (::fstat(file_.get(), &details) < 0) fail_errno("staging-unavailable", phase, true);
		if (!S_ISREG(details.st_mode)
			|| (!file_identity_.file_identity_value.empty()
				&& !same(regular_file_identity(details), file_identity_))) {
			throw protocol_error("staging-identity-mismatch", phase, false,
				"The retained macOS delivery handle changed identity.");
		}
		return details;
	}

	struct stat named_stage_stat(const char* phase) const {
		struct stat details {};
		if (::fstatat(replacement_.get(), stage_name_.c_str(), &details, AT_SYMLINK_NOFOLLOW) < 0) {
			fail_errno("staging-unavailable", phase, true);
		}
		if (!S_ISREG(details.st_mode) || !same(regular_file_identity(details), file_identity_)) {
			throw protocol_error("staging-identity-mismatch", phase, false,
				"The named macOS delivery stage no longer identifies the retained file.");
		}
		return details;
	}

	void assert_root_current() const {
		struct stat details {};
		if (::fstat(root_.get(), &details) < 0) fail_errno("destination-unavailable", "publish-root-stat", true);
		if (!same(directory_identity(details), root_identity_)) {
			throw protocol_error("destination-identity-mismatch", "publish-root-stat", false,
				"The retained macOS destination handle changed identity.");
		}
	}

	owned_fd root_;
	owned_fd replacement_;
	owned_fd file_;
	root_identity root_identity_;
	file_identity file_identity_;
	std::string final_name_;
	std::string replacement_path_;
	std::string stage_name_;
	std::string staging_reference_;
	bool published_ = false;
};

} // namespace

std::unique_ptr<platform_session> create_platform_session(const init_request& request) {
	return std::make_unique<macos_session>(request);
}

recovery_result recover_platform_session(const recovery_request& request) {
	auto root = open_authenticated_root(request.root_path, request.expected_root_identity);
	const auto stage_path = decode_reference(request.staging_reference);
	const auto separator = stage_path.find_last_of('/');
	if (separator == std::string::npos || separator == 0 || separator + 1 == stage_path.size()) {
		throw protocol_error("invalid-staging-reference", "recover", false,
			"The macOS staging reference is not one private leaf.");
	}
	const auto parent_path = stage_path.substr(0, separator);
	const auto leaf = stage_path.substr(separator + 1);
	if (!leaf.starts_with(".soundscaper-delivery-") || !leaf.ends_with(".native-stage")) {
		throw protocol_error("invalid-staging-reference", "recover", false,
			"The macOS staging reference has the wrong leaf contract.");
	}
	owned_fd parent(::open(parent_path.c_str(), O_RDONLY | O_DIRECTORY | O_CLOEXEC | O_NOFOLLOW));
	if (parent.get() < 0) {
		if (errno == ENOENT) return {.status = "missing", .byte_length = 0, .sha256 = {}, .identity = std::nullopt};
		fail_errno("staging-unavailable", "recover-directory-open", true);
	}
	struct stat parent_details {};
	if (::fstat(parent.get(), &parent_details) < 0) fail_errno("staging-unavailable", "recover-directory-stat", true);
	struct stat root_details {};
	if (::fstat(root.get(), &root_details) < 0) fail_errno("destination-unavailable", "recover-root-stat", true);
	if (!S_ISDIR(parent_details.st_mode) || parent_details.st_dev != root_details.st_dev
		|| parent_details.st_uid != geteuid() || (parent_details.st_mode & 0022) != 0) {
		throw protocol_error("invalid-staging-reference", "recover-directory-stat", false,
			"The macOS recovery directory is not private and same-volume.");
	}
	owned_fd file(::openat(parent.get(), leaf.c_str(), O_RDONLY | O_CLOEXEC | O_NOFOLLOW));
	if (file.get() < 0) {
		if (errno == ENOENT) return {.status = "missing", .byte_length = 0, .sha256 = {}, .identity = std::nullopt};
		fail_errno("staging-unavailable", "recover-file-open", true);
	}
	struct stat details {};
	if (::fstat(file.get(), &details) < 0) fail_errno("staging-unavailable", "recover-file-stat", true);
	const auto identity = regular_file_identity(details);
	if (!S_ISREG(details.st_mode) || !same(identity, request.expected_file_identity)) {
		return {.status = "foreign", .byte_length = 0, .sha256 = {}, .identity = std::nullopt};
	}
	const auto length = static_cast<std::uint64_t>(details.st_size);
	const auto digest = digest_fd(file.get(), length);
	struct stat after {};
	if (::fstat(file.get(), &after) < 0 || after.st_size != details.st_size
		|| !same(regular_file_identity(after), identity)) {
		throw protocol_error("staging-identity-mismatch", "recover-file-stat", false,
			"The macOS recovery file changed while it was inspected.");
	}
	if (request.expected_inspection
		&& (request.expected_inspection->byte_length != length
			|| request.expected_inspection->sha256 != digest)) {
		return {.status = "foreign", .byte_length = 0, .sha256 = {}, .identity = std::nullopt};
	}
	if (request.action == recovery_action::inspect) {
		return {.status = "inspection", .byte_length = length, .sha256 = digest, .identity = identity};
	}
	struct stat named {};
	if (::fstatat(parent.get(), leaf.c_str(), &named, AT_SYMLINK_NOFOLLOW) < 0) {
		if (errno == ENOENT) return {.status = "missing", .byte_length = 0, .sha256 = {}, .identity = std::nullopt};
		fail_errno("staging-unavailable", "recover-remove-stat", true);
	}
	if (!same(regular_file_identity(named), identity)) {
		return {.status = "foreign", .byte_length = 0, .sha256 = {}, .identity = std::nullopt};
	}
	if (::unlinkat(parent.get(), leaf.c_str(), 0) < 0) fail_errno("staging-remove-failed", "recover-remove", true);
	if (::fsync(parent.get()) < 0) fail_errno("staging-remove-failed", "recover-remove-sync", true);
	return {.status = "removed", .byte_length = 0, .sha256 = {}, .identity = std::nullopt};
}

recovery_result inspect_platform_final(const final_inspection_request& request) {
	auto root = open_authenticated_root(request.root_path, request.expected_root_identity);
	owned_fd file(::openat(root.get(), request.final_name.c_str(), O_RDONLY | O_CLOEXEC | O_NOFOLLOW));
	if (file.get() < 0) {
		if (errno == ENOENT) return {.status = "missing", .byte_length = 0, .sha256 = {}, .identity = std::nullopt};
		if (errno == ELOOP) return {.status = "foreign", .byte_length = 0, .sha256 = {}, .identity = std::nullopt};
		fail_errno("final-inspection-failed", "inspect-final-open", true);
	}
	struct stat before {};
	if (::fstat(file.get(), &before) < 0) fail_errno("final-inspection-failed", "inspect-final-stat", true);
	const auto identity = regular_file_identity(before);
	if (!S_ISREG(before.st_mode) || before.st_size < 0
		|| identity.volume_identity != request.expected_root_identity.volume_identity) {
		return {.status = "foreign", .byte_length = 0, .sha256 = {}, .identity = std::nullopt};
	}
	const auto length = static_cast<std::uint64_t>(before.st_size);
	const auto digest = digest_fd(file.get(), length);
	struct stat after {};
	if (::fstat(file.get(), &after) < 0 || after.st_size != before.st_size
		|| !same(regular_file_identity(after), identity)) {
		throw protocol_error("final-identity-mismatch", "inspect-final-stat", false,
			"The final delivery file changed while it was inspected.");
	}
	return {.status = "inspection", .byte_length = length, .sha256 = digest, .identity = identity};
}

} // namespace soundscaper::delivery_fs
