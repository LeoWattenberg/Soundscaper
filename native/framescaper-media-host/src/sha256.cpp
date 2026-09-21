/* SPDX-License-Identifier: AGPL-3.0-only */

#include "sha256.hpp"
#include "../../common/sha256.hpp"

#include <algorithm>
#include <array>
#include <cctype>
#include <cstddef>
#include <cstdint>
#include <fstream>
#include <limits>
#include <span>
#include <stdexcept>

namespace framescaper::media {
namespace {

using sha256 = scape::native_common::sha256;

std::span<const std::byte> as_bytes(const std::uint8_t* bytes, const std::size_t count) {
	return {reinterpret_cast<const std::byte*>(bytes), count};
}

} // namespace

bool is_sha256_hex(const std::string& value) {
	return value.size() == 64 && std::all_of(value.begin(), value.end(), [](const unsigned char character) {
		return std::isdigit(character) != 0 || (character >= 'a' && character <= 'f');
	});
}

std::string sha256_file(const std::filesystem::path& path) {
	std::ifstream input(path, std::ios::binary);
	if (!input) throw std::runtime_error("The authenticated media file cannot be opened.");
	sha256 digest;
	std::array<char, 64 * 1024> bytes{};
	while (input) {
		input.read(bytes.data(), static_cast<std::streamsize>(bytes.size()));
		const auto count = input.gcount();
		if (count > 0) digest.update(std::as_bytes(
			std::span(bytes.data(), static_cast<std::size_t>(count))
		));
	}
	if (!input.eof()) throw std::runtime_error("The authenticated media file could not be read completely.");
	return digest.finish_hex();
}

std::string sha256_file_range(
	const std::filesystem::path& path,
	const std::uint64_t offset,
	const std::uint64_t byte_length
) {
	std::ifstream input(path, std::ios::binary);
	if (!input || offset > static_cast<std::uint64_t>(std::numeric_limits<std::streamoff>::max())) {
		throw std::runtime_error("The authenticated media range cannot be opened.");
	}
	input.seekg(static_cast<std::streamoff>(offset));
	if (!input) throw std::runtime_error("The authenticated media range cannot be positioned.");
	sha256 digest;
	std::array<std::uint8_t, 64 * 1024> bytes{};
	auto remaining = byte_length;
	while (remaining > 0) {
		const auto count = static_cast<std::size_t>(std::min<std::uint64_t>(remaining, bytes.size()));
		input.read(reinterpret_cast<char*>(bytes.data()), static_cast<std::streamsize>(count));
		if (input.gcount() != static_cast<std::streamsize>(count)) {
			throw std::runtime_error("The authenticated media range is truncated.");
		}
		digest.update(as_bytes(bytes.data(), count));
		remaining -= count;
	}
	return digest.finish_hex();
}

std::string sha256_bytes(const std::uint8_t* bytes, const std::size_t byte_length) {
	if (bytes == nullptr && byte_length != 0) throw std::invalid_argument("SHA-256 bytes are null.");
	sha256 digest;
	digest.update(as_bytes(bytes, byte_length));
	return digest.finish_hex();
}

bool sha256_file_ranges_match(
	const std::filesystem::path& path,
	const std::size_t range_count,
	const std::function<sha256_range_identity(std::size_t)>& range_at
) {
	std::ifstream input(path, std::ios::binary);
	if (!input) throw std::runtime_error("The authenticated media ranges cannot be opened.");
	std::array<std::uint8_t, 64 * 1024> bytes{};
	std::uint64_t current_offset{};
	for (std::size_t index = 0; index < range_count; ++index) {
		const auto range = range_at(index);
		if (range.offset < current_offset
			|| range.offset > static_cast<std::uint64_t>(std::numeric_limits<std::streamoff>::max())) {
			throw std::runtime_error("The authenticated media range order is invalid.");
		}
		if (range.offset != current_offset) {
			input.seekg(static_cast<std::streamoff>(range.offset));
			if (!input) throw std::runtime_error("An authenticated media range cannot be positioned.");
		}
		sha256 digest;
		auto remaining = range.byte_length;
		while (remaining > 0) {
			const auto count = static_cast<std::size_t>(std::min<std::uint64_t>(remaining, bytes.size()));
			input.read(reinterpret_cast<char*>(bytes.data()), static_cast<std::streamsize>(count));
			if (input.gcount() != static_cast<std::streamsize>(count)) {
				throw std::runtime_error("An authenticated media range is truncated.");
			}
			digest.update(as_bytes(bytes.data(), count));
			remaining -= count;
		}
		if (digest.finish_hex() != range.sha256) return false;
		current_offset = range.offset + range.byte_length;
	}
	return true;
}

} // namespace framescaper::media
