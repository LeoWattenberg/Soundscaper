/* SPDX-License-Identifier: AGPL-3.0-only */

#include "sha256.hpp"

#include <algorithm>
#include <array>
#include <bit>
#include <cctype>
#include <cstdint>
#include <fstream>
#include <iomanip>
#include <limits>
#include <sstream>
#include <stdexcept>

namespace framescaper::media {
namespace {

constexpr std::array<std::uint32_t, 64> round_constants{
	0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
	0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
	0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
	0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
	0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
	0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
	0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
	0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
};

class sha256 final {
public:
	void update(const std::uint8_t* bytes, std::size_t count) {
		bit_count_ += static_cast<std::uint64_t>(count) * 8U;
		while (count > 0) {
			const auto copied = std::min(count, block_.size() - used_);
			std::copy_n(bytes, copied, block_.begin() + static_cast<std::ptrdiff_t>(used_));
			used_ += copied;
			bytes += copied;
			count -= copied;
			if (used_ == block_.size()) { transform(); used_ = 0; }
		}
	}

	[[nodiscard]] std::string finish() {
		const auto original_bits = bit_count_;
		const std::uint8_t one = 0x80;
		update(&one, 1);
		const std::uint8_t zero = 0;
		while (used_ != 56) update(&zero, 1);
		std::array<std::uint8_t, 8> length{};
		for (std::size_t index = 0; index < length.size(); ++index) {
			length[7 - index] = static_cast<std::uint8_t>(original_bits >> (index * 8));
		}
		update(length.data(), length.size());
		std::ostringstream output;
		output << std::hex << std::setfill('0');
		for (const auto word : state_) output << std::setw(8) << word;
		return output.str();
	}

private:
	void transform() {
		std::array<std::uint32_t, 64> words{};
		for (std::size_t index = 0; index < 16; ++index) {
			const auto offset = index * 4;
			words[index] = (static_cast<std::uint32_t>(block_[offset]) << 24)
				| (static_cast<std::uint32_t>(block_[offset + 1]) << 16)
				| (static_cast<std::uint32_t>(block_[offset + 2]) << 8)
				| static_cast<std::uint32_t>(block_[offset + 3]);
		}
		for (std::size_t index = 16; index < words.size(); ++index) {
			const auto s0 = std::rotr(words[index - 15], 7) ^ std::rotr(words[index - 15], 18)
				^ (words[index - 15] >> 3);
			const auto s1 = std::rotr(words[index - 2], 17) ^ std::rotr(words[index - 2], 19)
				^ (words[index - 2] >> 10);
			words[index] = words[index - 16] + s0 + words[index - 7] + s1;
		}
		auto [a, b, c, d, e, f, g, h] = state_;
		for (std::size_t index = 0; index < words.size(); ++index) {
			const auto sigma1 = std::rotr(e, 6) ^ std::rotr(e, 11) ^ std::rotr(e, 25);
			const auto choice = (e & f) ^ (~e & g);
			const auto first = h + sigma1 + choice + round_constants[index] + words[index];
			const auto sigma0 = std::rotr(a, 2) ^ std::rotr(a, 13) ^ std::rotr(a, 22);
			const auto majority = (a & b) ^ (a & c) ^ (b & c);
			const auto second = sigma0 + majority;
			h = g; g = f; f = e; e = d + first; d = c; c = b; b = a; a = first + second;
		}
		state_[0] += a; state_[1] += b; state_[2] += c; state_[3] += d;
		state_[4] += e; state_[5] += f; state_[6] += g; state_[7] += h;
	}

	std::array<std::uint32_t, 8> state_{
		0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a,
		0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19,
	};
	std::array<std::uint8_t, 64> block_{};
	std::size_t used_{};
	std::uint64_t bit_count_{};
};

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
		if (count > 0) digest.update(
			reinterpret_cast<const std::uint8_t*>(bytes.data()), static_cast<std::size_t>(count)
		);
	}
	if (!input.eof()) throw std::runtime_error("The authenticated media file could not be read completely.");
	return digest.finish();
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
		digest.update(bytes.data(), count);
		remaining -= count;
	}
	return digest.finish();
}

std::string sha256_bytes(const std::uint8_t* bytes, const std::size_t byte_length) {
	if (bytes == nullptr && byte_length != 0) throw std::invalid_argument("SHA-256 bytes are null.");
	sha256 digest;
	digest.update(bytes, byte_length);
	return digest.finish();
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
			digest.update(bytes.data(), count);
			remaining -= count;
		}
		if (digest.finish() != range.sha256) return false;
		current_offset = range.offset + range.byte_length;
	}
	return true;
}

} // namespace framescaper::media
