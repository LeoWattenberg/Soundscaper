/* SPDX-License-Identifier: AGPL-3.0-only */

#include "delivery_fs_sha256.hpp"

#include <bit>
#include <iomanip>
#include <sstream>
#include <stdexcept>

namespace soundscaper::delivery_fs {
namespace {

constexpr std::array<std::uint32_t, 64> round_constants = {
	0x428a2f98U, 0x71374491U, 0xb5c0fbcfU, 0xe9b5dba5U, 0x3956c25bU, 0x59f111f1U,
	0x923f82a4U, 0xab1c5ed5U, 0xd807aa98U, 0x12835b01U, 0x243185beU, 0x550c7dc3U,
	0x72be5d74U, 0x80deb1feU, 0x9bdc06a7U, 0xc19bf174U, 0xe49b69c1U, 0xefbe4786U,
	0x0fc19dc6U, 0x240ca1ccU, 0x2de92c6fU, 0x4a7484aaU, 0x5cb0a9dcU, 0x76f988daU,
	0x983e5152U, 0xa831c66dU, 0xb00327c8U, 0xbf597fc7U, 0xc6e00bf3U, 0xd5a79147U,
	0x06ca6351U, 0x14292967U, 0x27b70a85U, 0x2e1b2138U, 0x4d2c6dfcU, 0x53380d13U,
	0x650a7354U, 0x766a0abbU, 0x81c2c92eU, 0x92722c85U, 0xa2bfe8a1U, 0xa81a664bU,
	0xc24b8b70U, 0xc76c51a3U, 0xd192e819U, 0xd6990624U, 0xf40e3585U, 0x106aa070U,
	0x19a4c116U, 0x1e376c08U, 0x2748774cU, 0x34b0bcb5U, 0x391c0cb3U, 0x4ed8aa4aU,
	0x5b9cca4fU, 0x682e6ff3U, 0x748f82eeU, 0x78a5636fU, 0x84c87814U, 0x8cc70208U,
	0x90befffaU, 0xa4506cebU, 0xbef9a3f7U, 0xc67178f2U,
};

std::uint32_t big_endian_word(const std::byte* value) {
	return (std::to_integer<std::uint32_t>(value[0]) << 24U)
		| (std::to_integer<std::uint32_t>(value[1]) << 16U)
		| (std::to_integer<std::uint32_t>(value[2]) << 8U)
		| std::to_integer<std::uint32_t>(value[3]);
}

} // namespace

sha256::sha256() : state_({
	0x6a09e667U, 0xbb67ae85U, 0x3c6ef372U, 0xa54ff53aU,
	0x510e527fU, 0x9b05688cU, 0x1f83d9abU, 0x5be0cd19U,
}) {}

void sha256::update(std::span<const std::byte> bytes) {
	if (finished_) throw std::logic_error("SHA-256 was already finalized.");
	if (bytes.size() > UINT64_MAX - total_bytes_) throw std::overflow_error("SHA-256 input is too large.");
	total_bytes_ += bytes.size();
	for (const auto value : bytes) {
		buffer_[buffered_bytes_++] = value;
		if (buffered_bytes_ == buffer_.size()) {
			transform(buffer_.data());
			buffered_bytes_ = 0;
		}
	}
}

std::string sha256::finish_hex() {
	if (finished_) throw std::logic_error("SHA-256 was already finalized.");
	const auto bit_length = total_bytes_ * 8U;
	buffer_[buffered_bytes_++] = std::byte{0x80};
	if (buffered_bytes_ > 56) {
		while (buffered_bytes_ < buffer_.size()) buffer_[buffered_bytes_++] = std::byte{0};
		transform(buffer_.data());
		buffered_bytes_ = 0;
	}
	while (buffered_bytes_ < 56) buffer_[buffered_bytes_++] = std::byte{0};
	for (int shift = 56; shift >= 0; shift -= 8) {
		buffer_[buffered_bytes_++] = static_cast<std::byte>((bit_length >> shift) & 0xffU);
	}
	transform(buffer_.data());
	finished_ = true;
	std::ostringstream output;
	output << std::hex << std::setfill('0');
	for (const auto value : state_) output << std::setw(8) << value;
	return output.str();
}

void sha256::transform(const std::byte* block) {
	std::array<std::uint32_t, 64> words{};
	for (std::size_t index = 0; index < 16; ++index) {
		words[index] = big_endian_word(block + index * 4);
	}
	for (std::size_t index = 16; index < words.size(); ++index) {
		const auto first = std::rotr(words[index - 15], 7) ^ std::rotr(words[index - 15], 18)
			^ (words[index - 15] >> 3U);
		const auto second = std::rotr(words[index - 2], 17) ^ std::rotr(words[index - 2], 19)
			^ (words[index - 2] >> 10U);
		words[index] = words[index - 16] + first + words[index - 7] + second;
	}
	auto [a, b, c, d, e, f, g, h] = state_;
	for (std::size_t index = 0; index < words.size(); ++index) {
		const auto sigma_one = std::rotr(e, 6) ^ std::rotr(e, 11) ^ std::rotr(e, 25);
		const auto choice = (e & f) ^ (~e & g);
		const auto temporary_one = h + sigma_one + choice + round_constants[index] + words[index];
		const auto sigma_zero = std::rotr(a, 2) ^ std::rotr(a, 13) ^ std::rotr(a, 22);
		const auto majority = (a & b) ^ (a & c) ^ (b & c);
		const auto temporary_two = sigma_zero + majority;
		h = g; g = f; f = e; e = d + temporary_one;
		d = c; c = b; b = a; a = temporary_one + temporary_two;
	}
	state_[0] += a; state_[1] += b; state_[2] += c; state_[3] += d;
	state_[4] += e; state_[5] += f; state_[6] += g; state_[7] += h;
}

} // namespace soundscaper::delivery_fs
