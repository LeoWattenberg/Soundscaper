/* SPDX-License-Identifier: AGPL-3.0-only */

#include "../../native/soundscaper-professional-host/src/delivery_fs_posix.hpp"

#include <array>
#include <cstddef>
#include <cstdint>
#include <fcntl.h>
#include <span>
#include <string>
#include <sys/stat.h>
#include <unistd.h>

using namespace soundscaper::delivery_fs;

template <typename Action>
bool fails_as(Action action, const char* code, const char* phase) {
	try { action(); }
	catch (const protocol_error& error) {
		return error.code == code && error.phase == phase && error.retryable;
	}
	return false;
}

int main(int argc, char** argv) {
	if (argc != 2) return 1;
	const owned_fd file(::open(argv[1], O_CREAT | O_EXCL | O_RDWR | O_CLOEXEC, 0600));
	if (file.get() < 0) return 2;
	const std::array<std::byte, 4> source {
		std::byte {0x11}, std::byte {0x22}, std::byte {0x33}, std::byte {0x44},
	};
	write_posix_staging_fd(file.get(), 3, source, "caller-owned zero-write detail");
	std::array<std::byte, 4> output {};
	if (read_posix_staging_fd(file.get(), 3, output) != output.size() || output != source) return 3;
	if (read_posix_staging_fd(file.get(), 7, output) != 0) return 4;
	sync_posix_staging_fd(file.get());
	struct stat details {};
	if (::fstat(file.get(), &details) != 0 || details.st_size != 7) return 5;
	const auto identity = regular_file_identity(details);
	if (!same(identity, identity)
		|| same(identity, file_identity {identity.volume_identity, "inode:other"})
		|| same(identity, file_identity {"device:other", identity.file_identity_value})) return 6;
	const root_identity root {"device:1", "device:1:inode:2"};
	if (!same(root, root)
		|| same(root, root_identity {"device:1", "device:1:inode:3"})
		|| same(root, root_identity {"device:2", root.directory_identity})) return 7;
	if (!fails_as([] { write_posix_staging_fd(-1, 0,
		std::array<std::byte, 1> {std::byte {0x01}}, "no bytes"); },
		"staging-write-failed", "write")) return 8;
	if (!fails_as([] { std::array<std::byte, 1> destination {};
		(void)read_posix_staging_fd(-1, 0, destination); },
		"staging-read-failed", "seal-read")) return 9;
	if (!fails_as([] { sync_posix_staging_fd(-1); },
		"staging-sync-failed", "seal-sync")) return 10;
	return 0;
}
