/* SPDX-License-Identifier: AGPL-3.0-only */

#include "v12_output_file.hpp"

#include "v12_host_invocation.hpp"
#include "../../framescaper-media-host/src/sha256.hpp"

#include <algorithm>
#include <cerrno>
#include <cstddef>
#include <limits>
#include <system_error>

#ifdef _WIN32
#include <fcntl.h>
#include <io.h>
#include <sys/stat.h>
#else
#include <fcntl.h>
#include <unistd.h>
#endif

namespace framescaper::openfx {
namespace {

[[noreturn]] void failed(const std::string& message) {
	throw v12_invocation_error{"output-publication", message};
}

#ifdef _WIN32
int open_exclusive(const std::filesystem::path& path) {
	return ::_wopen(
		path.c_str(), _O_BINARY | _O_CREAT | _O_EXCL | _O_WRONLY,
		_S_IREAD | _S_IWRITE
	);
}
int write_bytes(int descriptor, const unsigned char* bytes, std::size_t length) {
	return ::_write(descriptor, bytes, static_cast<unsigned int>(length));
}
int sync_file(int descriptor) { return ::_commit(descriptor); }
int close_file(int descriptor) { return ::_close(descriptor); }
constexpr std::size_t kMaximumWriteBytes = std::numeric_limits<unsigned int>::max();
#else
int open_exclusive(const std::filesystem::path& path) {
	return ::open(path.c_str(), O_CLOEXEC | O_CREAT | O_EXCL | O_WRONLY, 0600);
}
ssize_t write_bytes(int descriptor, const unsigned char* bytes, std::size_t length) {
	return ::write(descriptor, bytes, length);
}
int sync_file(int descriptor) { return ::fsync(descriptor); }
int close_file(int descriptor) { return ::close(descriptor); }
constexpr std::size_t kMaximumWriteBytes = static_cast<std::size_t>(
	std::numeric_limits<ssize_t>::max()
);
#endif

} // namespace

void publish_v12_output_file(
	const std::filesystem::path& path,
	const std::vector<unsigned char>& bytes,
	const std::string& sha256
) {
	if (framescaper::media::sha256_bytes(bytes.data(), bytes.size()) != sha256) {
		failed("The rendered RGBA plane does not match its authenticated output digest.");
	}
	const int descriptor = open_exclusive(path);
	if (descriptor < 0) failed("The authenticated output path cannot be created exclusively.");
	bool complete = false;
	try {
		std::size_t offset = 0;
		while (offset < bytes.size()) {
			const auto requested = std::min(bytes.size() - offset, kMaximumWriteBytes);
			const auto written = write_bytes(descriptor, bytes.data() + offset, requested);
			if (written <= 0) failed("The authenticated RGBA output write failed.");
			offset += static_cast<std::size_t>(written);
		}
		if (sync_file(descriptor) != 0 || close_file(descriptor) != 0) {
			failed("The authenticated RGBA output could not be durably closed.");
		}
		complete = true;
	} catch (...) {
		if (!complete) static_cast<void>(close_file(descriptor));
		std::error_code ignored;
		std::filesystem::remove(path, ignored);
		throw;
	}
	if (std::filesystem::file_size(path) != bytes.size()
		|| framescaper::media::sha256_file(path) != sha256) {
		std::error_code ignored;
		std::filesystem::remove(path, ignored);
		failed("The published RGBA output failed its post-write authentication.");
	}
}

} // namespace framescaper::openfx
