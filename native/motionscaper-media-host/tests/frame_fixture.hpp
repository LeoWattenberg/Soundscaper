/* SPDX-License-Identifier: AGPL-3.0-only */
#pragma once
#include "../../common/sha256.hpp"
#include <bit>
#include <cstdint>
#include <span>
#include <string>

namespace motionscaper::media::fixture {
template<typename Integer> void integer(std::string& output, const Integer value) {
	for (std::size_t byte = 0; byte < sizeof(Integer); ++byte) output.push_back(static_cast<char>((value >> (8U * byte)) & 255U));
}
inline std::string frames() {
	const std::string header = "{\"identity\":{\"projectId\":\"p\",\"revisionDigest\":\"" + std::string(64, 'a')
		+ "\",\"compositionId\":\"c\"},\"width\":32,\"height\":16,\"frameRate\":{\"num\":30000,\"den\":1001},\"firstFrame\":123,\"frameCount\":2,\"format\":\"motionscaper-linear-rgba-frame-pack\",\"version\":1,\"pixelFormat\":\"rgba-f32le\",\"colorSpace\":\"linear-rec709-d65\",\"alphaMode\":\"premultiplied\"}";
	std::string result = "motionscaper-linear-rgba-frame-pack-v1\n";
	integer(result, static_cast<std::uint32_t>(header.size())); result += header;
	std::string pixels;
	for (std::uint32_t y = 0; y < 16; ++y) for (std::uint32_t x = 0; x < 32; ++x) {
		const float alpha = x < 8 ? 0 : x < 24 ? 0.2345678F : 1;
		for (const float sample : {0.3456789F * alpha, 0.1234567F * alpha, 0.7891234F * alpha, alpha}) integer(pixels, std::bit_cast<std::uint32_t>(sample));
	}
	scape::native_common::sha256 digest;
	digest.update(std::as_bytes(std::span{pixels.data(), pixels.size()})); const auto hex = digest.finish_hex();
	std::string hash;
	for (std::size_t offset = 0; offset < hex.size(); offset += 2) hash.push_back(static_cast<char>(std::stoul(hex.substr(offset, 2), nullptr, 16)));
	for (std::uint64_t index = 0; index < 2; ++index) { integer(result, index); integer(result, static_cast<std::uint64_t>(pixels.size())); result += pixels; result += hash; }
	return result;
}
} // namespace motionscaper::media::fixture
